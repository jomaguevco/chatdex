const kardexDb = require('../../kardexDb');
const kardexApi = require('../../kardexApi');
const logger = require('../../utils/logger');
const productCache = require('../../utils/productCache');

/**
 * Gestor híbrido de base de datos
 * 
 * Este módulo implementa la lógica híbrida de acceso a datos:
 * - LECTURA: Desde MySQL directa (kardexDb) para mejor performance
 * - ESCRITURA: Vía API REST (kardexApi) para garantizar consistencia
 * 
 * Funcionalidades:
 * - Leer productos, precios, categorías, stocks, especificaciones desde BD directa
 * - Validar consistencia de datos
 * - Cache inteligente para queries frecuentes
 * - Manejo de errores y fallbacks automáticos
 * 
 * @module core/database/databaseManager
 */

class DatabaseManager {
  constructor() {
    this.cacheEnabled = true;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutos
    this.queryCache = new Map();
    this.lastCleanup = Date.now();
    this.cleanupInterval = 10 * 60 * 1000; // 10 minutos
  }

  /**
   * Limpiar cache expirado
   */
  _cleanupCache() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }

    for (const [key, value] of this.queryCache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.queryCache.delete(key);
      }
    }

    this.lastCleanup = now;
  }

  /**
   * Obtener productos activos con filtros
   * 
   * @param {object} filters - Filtros de búsqueda {search, categoria_id, limit, minPrice, maxPrice, inStock}
   * @param {boolean} useCache - Si usar cache (default: true)
   * @returns {Promise<array|null>} Array de productos o null si hay error
   */
  async getProductos(filters = {}, useCache = true) {
    try {
      this._cleanupCache();

      // Generar clave de cache
      const cacheKey = `productos_${JSON.stringify(filters)}`;
      
      if (useCache && this.cacheEnabled) {
        const cached = this.queryCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
          logger.debug(`[Cache] Productos encontrados en cache`);
          return cached.data;
        }
      }

      // Intentar leer desde BD directa
      let productos = null;
      if (kardexDb.isConnected()) {
        try {
          productos = await kardexDb.getProductos(filters);
          
          // Aplicar filtros adicionales que no están en kardexDb
          if (productos && Array.isArray(productos)) {
            if (filters.minPrice !== undefined) {
              productos = productos.filter(p => 
                parseFloat(p.precio_venta || 0) >= parseFloat(filters.minPrice)
              );
            }
            
            if (filters.maxPrice !== undefined) {
              productos = productos.filter(p => 
                parseFloat(p.precio_venta || 0) <= parseFloat(filters.maxPrice)
              );
            }
            
            if (filters.inStock === true) {
              productos = productos.filter(p => 
                parseInt(p.stock_actual || 0) > 0
              );
            }
          }
        } catch (dbError) {
          logger.warn('Error al leer productos desde BD, intentando API:', dbError.message);
          productos = null;
        }
      }

      // Fallback a API si BD no funciona
      if (!productos) {
        try {
          productos = await kardexApi.buscarProductos(filters.search || '', filters);
        } catch (apiError) {
          logger.error('Error al leer productos desde API:', apiError.message);
          return null;
        }
      }

      // Guardar en cache
      if (productos && useCache && this.cacheEnabled) {
        this.queryCache.set(cacheKey, {
          data: productos,
          timestamp: Date.now()
        });
      }

      return productos;
    } catch (error) {
      logger.error('Error en getProductos:', error);
      return null;
    }
  }

  /**
   * Obtener un producto por ID
   * 
   * @param {number} productoId - ID del producto
   * @param {boolean} useCache - Si usar cache (default: true)
   * @returns {Promise<object|null>} Producto o null si no existe
   */
  async getProductoById(productoId, useCache = true) {
    try {
      const cacheKey = `producto_${productoId}`;
      
      if (useCache && this.cacheEnabled) {
        const cached = this.queryCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
          return cached.data;
        }
      }

      let producto = null;
      
      // Leer desde BD directa
      if (kardexDb.isConnected()) {
        try {
          producto = await kardexDb.getProducto(productoId);
        } catch (dbError) {
          logger.warn('Error al leer producto desde BD:', dbError.message);
        }
      }

      // Fallback a API
      if (!producto) {
        try {
          const productos = await kardexApi.buscarProductos(`id:${productoId}`);
          producto = productos && productos.length > 0 ? productos[0] : null;
        } catch (apiError) {
          logger.error('Error al leer producto desde API:', apiError.message);
        }
      }

      // Guardar en cache
      if (producto && useCache && this.cacheEnabled) {
        this.queryCache.set(cacheKey, {
          data: producto,
          timestamp: Date.now()
        });
      }

      return producto;
    } catch (error) {
      logger.error(`Error en getProductoById(${productoId}):`, error);
      return null;
    }
  }

  /**
   * Buscar productos por término de búsqueda
   * 
   * @param {string} searchTerm - Término de búsqueda
   * @param {object} options - Opciones {limit, filters}
   * @returns {Promise<array|null>} Array de productos encontrados
   */
  async buscarProductos(searchTerm, options = {}) {
    try {
      const limit = options.limit || 20;
      const filters = {
        search: searchTerm,
        limit,
        ...options.filters
      };

      return await this.getProductos(filters, true);
    } catch (error) {
      logger.error(`Error en buscarProductos("${searchTerm}"):`, error);
      return null;
    }
  }

  /**
   * Verificar stock de un producto
   * 
   * @param {number} productoId - ID del producto
   * @param {number} cantidad - Cantidad requerida
   * @returns {Promise<object|null>} {disponible: boolean, stock_actual: number, error: string|null}
   */
  async verificarStock(productoId, cantidad) {
    try {
      // Leer desde BD directa (más rápido)
      if (kardexDb.isConnected()) {
        try {
          const result = await kardexDb.verificarStock(productoId, cantidad);
          if (result) {
            return result;
          }
        } catch (dbError) {
          logger.warn('Error al verificar stock desde BD:', dbError.message);
        }
      }

      // Fallback: obtener producto y verificar stock
      const producto = await this.getProductoById(productoId, true);
      
      if (!producto) {
        return {
          disponible: false,
          stock_actual: 0,
          error: 'Producto no encontrado'
        };
      }

      const stockActual = parseInt(producto.stock_actual || 0);
      const disponible = stockActual >= cantidad;

      return {
        disponible,
        stock_actual: stockActual,
        nombre: producto.nombre,
        precio_venta: parseFloat(producto.precio_venta || 0),
        error: disponible ? null : `Stock insuficiente. Disponible: ${stockActual}`
      };
    } catch (error) {
      logger.error(`Error en verificarStock(${productoId}, ${cantidad}):`, error);
      return null;
    }
  }

  /**
   * Verificar stock de múltiples productos
   * 
   * @param {array} productos - Array de {producto_id, cantidad}
   * @returns {Promise<array>} Array de resultados de verificación
   */
  async verificarStockMultiple(productos) {
    const resultados = [];
    
    for (const item of productos) {
      const resultado = await this.verificarStock(item.producto_id, item.cantidad);
      resultados.push({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        ...resultado
      });
    }

    return resultados;
  }

  /**
   * Obtener categorías disponibles
   * 
   * @param {boolean} useCache - Si usar cache (default: true)
   * @returns {Promise<array|null>} Array de categorías
   */
  async getCategorias(useCache = true) {
    try {
      const cacheKey = 'categorias_all';
      
      if (useCache && this.cacheEnabled) {
        const cached = this.queryCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
          return cached.data;
        }
      }

      // Leer desde BD directa
      let categorias = null;
      if (kardexDb.isConnected()) {
        try {
          const [rows] = await kardexDb.pool.execute(
            `SELECT id, nombre, descripcion, activo 
             FROM categorias 
             WHERE activo = 1 
             ORDER BY nombre ASC`
          );
          categorias = rows;
        } catch (dbError) {
          logger.warn('Error al leer categorías desde BD:', dbError.message);
        }
      }

      // Fallback a API si es necesario
      if (!categorias) {
        try {
          categorias = await kardexApi.getCategorias?.() || [];
        } catch (apiError) {
          logger.error('Error al leer categorías desde API:', apiError.message);
          return [];
        }
      }

      // Guardar en cache
      if (categorias && useCache && this.cacheEnabled) {
        this.queryCache.set(cacheKey, {
          data: categorias,
          timestamp: Date.now()
        });
      }

      return categorias || [];
    } catch (error) {
      logger.error('Error en getCategorias:', error);
      return [];
    }
  }

  /**
   * Crear pedido (vía API)
   * 
   * @param {object} pedidoData - Datos del pedido {cliente_id, productos, total, etc.}
   * @returns {Promise<object|null>} Resultado de la creación {success, pedido_id, numero_pedido}
   */
  async crearPedido(pedidoData) {
    try {
      // Siempre escribir vía API para garantizar consistencia
      const result = await kardexApi.crearPedidoVacio(
        pedidoData.cliente_id,
        pedidoData.telefono || null
      );

      if (result && result.success) {
        // Invalidar cache de pedidos si existe
        this._invalidateCache('pedidos');
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Error en crearPedido:', error);
      return null;
    }
  }

  /**
   * Agregar producto a pedido (vía API)
   * 
   * @param {number} pedidoId - ID del pedido
   * @param {number} productoId - ID del producto
   * @param {number} cantidad - Cantidad
   * @returns {Promise<object|null>} Resultado de la operación
   */
  async agregarProductoAPedido(pedidoId, productoId, cantidad) {
    try {
      // Escribir vía API
      const result = await kardexApi.agregarProductoAPedido(pedidoId, productoId, cantidad);

      if (result && result.success) {
        // Invalidar cache relacionado
        this._invalidateCache(`pedido_${pedidoId}`);
        return result;
      }

      return null;
    } catch (error) {
      logger.error(`Error en agregarProductoAPedido(${pedidoId}, ${productoId}, ${cantidad}):`, error);
      return null;
    }
  }

  /**
   * Confirmar pedido (vía API)
   * 
   * @param {number} pedidoId - ID del pedido
   * @param {object} datosCliente - Datos adicionales si es necesario
   * @returns {Promise<object|null>} Resultado de la confirmación
   */
  async confirmarPedido(pedidoId, datosCliente = {}) {
    try {
      // Escribir vía API
      const result = await kardexApi.confirmarPedido?.(pedidoId, datosCliente);

      if (result) {
        // Invalidar cache
        this._invalidateCache(`pedido_${pedidoId}`);
        this._invalidateCache('pedidos');
        return result;
      }

      return null;
    } catch (error) {
      logger.error(`Error en confirmarPedido(${pedidoId}):`, error);
      return null;
    }
  }

  /**
   * Crear venta (vía API)
   * 
   * @param {object} ventaData - Datos de la venta
   * @returns {Promise<object|null>} Resultado de la creación
   */
  async crearVenta(ventaData) {
    try {
      // Escribir vía API
      const result = await kardexApi.crearVenta?.(ventaData);

      if (result) {
        // Invalidar cache relacionado
        this._invalidateCache('productos'); // Stock puede haber cambiado
        this._invalidateCache('ventas');
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Error en crearVenta:', error);
      return null;
    }
  }

  /**
   * Obtener pedido por ID (leer desde BD o API)
   * 
   * @param {number} pedidoId - ID del pedido
   * @returns {Promise<object|null>} Pedido con detalles
   */
  async getPedido(pedidoId) {
    try {
      // Leer desde API (tiene más información consolidada)
      const pedido = await kardexApi.getPedidoEnProceso?.(pedidoId);
      
      if (pedido) {
        return pedido;
      }

      // Si no funciona API, intentar desde BD (si existe tabla)
      if (kardexDb.isConnected()) {
        try {
          const [pedidos] = await kardexDb.pool.execute(
            `SELECT * FROM pedidos WHERE id = ?`,
            [pedidoId]
          );

          if (pedidos && pedidos.length > 0) {
            // Obtener detalles
            const [detalles] = await kardexDb.pool.execute(
              `SELECT dp.*, p.nombre as producto_nombre
               FROM detalle_pedidos dp
               JOIN productos p ON dp.producto_id = p.id
               WHERE dp.pedido_id = ?`,
              [pedidoId]
            );

            return {
              ...pedidos[0],
              detalles: detalles || []
            };
          }
        } catch (dbError) {
          logger.warn('Error al leer pedido desde BD:', dbError.message);
        }
      }

      return null;
    } catch (error) {
      logger.error(`Error en getPedido(${pedidoId}):`, error);
      return null;
    }
  }

  /**
   * Invalidar cache por patrón
   * 
   * @param {string} pattern - Patrón a buscar en las claves de cache
   */
  _invalidateCache(pattern) {
    for (const key of this.queryCache.keys()) {
      if (key.includes(pattern)) {
        this.queryCache.delete(key);
      }
    }
  }

  /**
   * Limpiar todo el cache
   */
  clearCache() {
    this.queryCache.clear();
    logger.info('✅ Cache limpiado');
  }

  /**
   * Obtener estadísticas del cache
   * 
   * @returns {object} Estadísticas del cache
   */
  getCacheStats() {
    return {
      size: this.queryCache.size,
      keys: Array.from(this.queryCache.keys())
    };
  }
}

module.exports = new DatabaseManager();
