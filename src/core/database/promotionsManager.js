const kardexDb = require('../../kardexDb');
const kardexApi = require('../../kardexApi');
const logger = require('../../utils/logger');

/**
 * Gestor de promociones y descuentos
 * 
 * Este módulo maneja todas las operaciones relacionadas con promociones:
 * - Consultar promociones activas desde BD
 * - Aplicar descuentos automáticos
 * - Sugerir bundles cuando corresponda
 * - Validar reglas de promociones
 * 
 * @module core/database/promotionsManager
 */

class PromotionsManager {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 2 * 60 * 1000; // 2 minutos (las promociones cambian más frecuentemente)
  }

  /**
   * Obtener promociones activas
   * 
   * @param {object} filters - Filtros {producto_id, categoria_id, fecha}
   * @returns {Promise<array>} Array de promociones activas
   */
  async getPromocionesActivas(filters = {}) {
    try {
      const cacheKey = `promociones_${JSON.stringify(filters)}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('[Cache] Promociones encontradas en cache');
        return cached.data;
      }

      const fechaActual = filters.fecha || new Date();
      let promociones = [];

      // Leer desde BD directa
      if (kardexDb.isConnected()) {
        try {
          let query = `
            SELECT 
              id,
              nombre,
              descripcion,
              descuento_porcentaje,
              descuento_fijo,
              producto_id,
              categoria_id,
              cantidad_minima,
              fecha_inicio,
              fecha_fin,
              activo
            FROM promociones
            WHERE activo = 1
              AND fecha_inicio <= ?
              AND fecha_fin >= ?
          `;

          const params = [fechaActual, fechaActual];

          if (filters.producto_id) {
            query += ` AND (producto_id = ? OR producto_id IS NULL)`;
            params.push(filters.producto_id);
          }

          if (filters.categoria_id) {
            query += ` AND (categoria_id = ? OR categoria_id IS NULL)`;
            params.push(filters.categoria_id);
          }

          query += ` ORDER BY descuento_porcentaje DESC, descuento_fijo DESC`;

          const [rows] = await kardexDb.pool.execute(query, params);
          promociones = rows || [];
        } catch (dbError) {
          logger.warn('Error al leer promociones desde BD:', dbError.message);
          promociones = [];
        }
      }

      // Filtrar promociones aplicables
      promociones = promociones.filter(p => {
        const inicio = new Date(p.fecha_inicio);
        const fin = new Date(p.fecha_fin);
        return fechaActual >= inicio && fechaActual <= fin && p.activo === 1;
      });

      // Guardar en cache
      this.cache.set(cacheKey, {
        data: promociones,
        timestamp: Date.now()
      });

      return promociones;
    } catch (error) {
      logger.error('Error en getPromocionesActivas:', error);
      return [];
    }
  }

  /**
   * Buscar promociones aplicables a un producto específico
   * 
   * @param {number} productoId - ID del producto
   * @param {object} producto - Objeto producto con categoria_id
   * @returns {Promise<array>} Promociones aplicables
   */
  async getPromocionesParaProducto(productoId, producto = null) {
    try {
      const filters = { producto_id: productoId };
      
      if (producto && producto.categoria_id) {
        filters.categoria_id = producto.categoria_id;
      }

      const promociones = await this.getPromocionesActivas(filters);
      
      // Filtrar las que aplican específicamente al producto
      return promociones.filter(p => 
        p.producto_id === productoId || 
        (producto && p.categoria_id === producto.categoria_id) ||
        (!p.producto_id && !p.categoria_id) // Promociones generales
      );
    } catch (error) {
      logger.error(`Error en getPromocionesParaProducto(${productoId}):`, error);
      return [];
    }
  }

  /**
   * Aplicar descuentos a un producto según promociones activas
   * 
   * @param {number} productoId - ID del producto
   * @param {number} precioOriginal - Precio original del producto
   * @param {number} cantidad - Cantidad a comprar
   * @param {object} producto - Objeto producto completo
   * @returns {object} {precioFinal: number, descuento: number, promocion: object|null}
   */
  async aplicarDescuento(productoId, precioOriginal, cantidad = 1, producto = null) {
    try {
      const promociones = await this.getPromocionesParaProducto(productoId, producto);
      
      if (promociones.length === 0) {
        return {
          precioFinal: precioOriginal,
          descuento: 0,
          descuentoPorcentaje: 0,
          promocion: null
        };
      }

      // Tomar la mejor promoción (mayor descuento)
      const mejorPromocion = promociones.reduce((best, current) => {
        const descActual = this._calcularDescuento(precioOriginal, current);
        const descBest = best ? this._calcularDescuento(precioOriginal, best) : 0;
        return descActual > descBest ? current : best;
      }, null);

      if (!mejorPromocion) {
        return {
          precioFinal: precioOriginal,
          descuento: 0,
          descuentoPorcentaje: 0,
          promocion: null
        };
      }

      // Verificar cantidad mínima si aplica
      if (mejorPromocion.cantidad_minima && cantidad < mejorPromocion.cantidad_minima) {
        return {
          precioFinal: precioOriginal,
          descuento: 0,
          descuentoPorcentaje: 0,
          promocion: null,
          mensaje: `Esta promoción requiere mínimo ${mejorPromocion.cantidad_minima} unidades`
        };
      }

      const descuento = this._calcularDescuento(precioOriginal, mejorPromocion);
      const precioFinal = Math.max(0, precioOriginal - descuento);
      const descuentoPorcentaje = precioOriginal > 0 
        ? (descuento / precioOriginal) * 100 
        : 0;

      return {
        precioFinal: parseFloat(precioFinal.toFixed(2)),
        descuento: parseFloat(descuento.toFixed(2)),
        descuentoPorcentaje: parseFloat(descuentoPorcentaje.toFixed(2)),
        promocion: mejorPromocion
      };
    } catch (error) {
      logger.error(`Error en aplicarDescuento(${productoId}):`, error);
      return {
        precioFinal: precioOriginal,
        descuento: 0,
        descuentoPorcentaje: 0,
        promocion: null
      };
    }
  }

  /**
   * Calcular descuento de una promoción
   * 
   * @param {number} precio - Precio original
   * @param {object} promocion - Objeto promoción
   * @returns {number} Descuento calculado
   */
  _calcularDescuento(precio, promocion) {
    let descuento = 0;

    // Descuento porcentual
    if (promocion.descuento_porcentaje) {
      descuento = precio * (parseFloat(promocion.descuento_porcentaje) / 100);
    }

    // Descuento fijo
    if (promocion.descuento_fijo) {
      descuento = Math.max(descuento, parseFloat(promocion.descuento_fijo));
    }

    return descuento;
  }

  /**
   * Aplicar descuentos a múltiples productos
   * 
   * @param {array} productos - Array de {producto_id, precio, cantidad, producto}
   * @returns {Promise<array>} Array de productos con descuentos aplicados
   */
  async aplicarDescuentosMultiple(productos) {
    const resultados = [];

    for (const item of productos) {
      const descuentoInfo = await this.aplicarDescuento(
        item.producto_id,
        item.precio,
        item.cantidad,
        item.producto
      );

      resultados.push({
        ...item,
        precioOriginal: item.precio,
        precioFinal: descuentoInfo.precioFinal,
        descuento: descuentoInfo.descuento,
        descuentoPorcentaje: descuentoInfo.descuentoPorcentaje,
        promocion: descuentoInfo.promocion,
        subtotal: descuentoInfo.precioFinal * item.cantidad
      });
    }

    return resultados;
  }

  /**
   * Buscar bundles o combos disponibles
   * 
   * @param {array} productosEnCarrito - Productos en el carrito
   * @returns {Promise<array>} Bundles sugeridos
   */
  async buscarBundles(productosEnCarrito = []) {
    try {
      // Buscar promociones que incluyan múltiples productos
      const todasPromociones = await this.getPromocionesActivas();
      
      // Filtrar bundles (promociones con nombre que sugiere combo/pack)
      const bundles = todasPromociones.filter(p => {
        const nombre = (p.nombre || '').toLowerCase();
        return nombre.includes('combo') || 
               nombre.includes('pack') || 
               nombre.includes('bundle') ||
               nombre.includes('kit') ||
               (p.descripcion && (
                 p.descripcion.includes('combo') ||
                 p.descripcion.includes('pack')
               ));
      });

      // Verificar si alguno de los bundles aplica a los productos del carrito
      const bundlesAplicables = [];

      for (const bundle of bundles) {
        // Si tiene productos específicos, verificar que estén en el carrito
        if (bundle.productos_ids) {
          const productosBundle = JSON.parse(bundle.productos_ids || '[]');
          const tieneTodos = productosBundle.every(id => 
            productosEnCarrito.some(p => p.producto_id === id)
          );
          
          if (tieneTodos) {
            bundlesAplicables.push(bundle);
          }
        } else if (bundle.categoria_id) {
          // Si es por categoría, verificar que haya productos de esa categoría
          const tieneProductosCategoria = productosEnCarrito.some(p => 
            p.producto && p.producto.categoria_id === bundle.categoria_id
          );
          
          if (tieneProductosCategoria) {
            bundlesAplicables.push(bundle);
          }
        }
      }

      return bundlesAplicables;
    } catch (error) {
      logger.error('Error en buscarBundles:', error);
      return [];
    }
  }

  /**
   * Obtener mensaje de promoción para mostrar al usuario
   * 
   * @param {object} promocion - Objeto promoción
   * @returns {string} Mensaje formateado
   */
  getMensajePromocion(promocion) {
    if (!promocion) {
      return '';
    }

    let mensaje = `🎉 *${promocion.nombre}*\n`;

    if (promocion.descripcion) {
      mensaje += `${promocion.descripcion}\n`;
    }

    if (promocion.descuento_porcentaje) {
      mensaje += `💰 Descuento: ${promocion.descuento_porcentaje}%`;
    } else if (promocion.descuento_fijo) {
      mensaje += `💰 Descuento: S/. ${parseFloat(promocion.descuento_fijo).toFixed(2)}`;
    }

    if (promocion.cantidad_minima) {
      mensaje += `\n📦 Mínimo: ${promocion.cantidad_minima} unidades`;
    }

    const fin = new Date(promocion.fecha_fin);
    const diasRestantes = Math.ceil((fin - new Date()) / (1000 * 60 * 60 * 24));
    
    if (diasRestantes > 0) {
      mensaje += `\n⏰ Válido hasta: ${diasRestantes} día${diasRestantes > 1 ? 's' : ''}`;
    }

    return mensaje;
  }

  /**
   * Limpiar cache de promociones
   */
  clearCache() {
    this.cache.clear();
    logger.info('✅ Cache de promociones limpiado');
  }
}

module.exports = new PromotionsManager();
