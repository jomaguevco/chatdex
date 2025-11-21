const databaseManager = require('../database/databaseManager');
const promotionsManager = require('../database/promotionsManager');
const logger = require('../../utils/logger');

/**
 * Validador de pedidos
 * 
 * Este módulo valida pedidos contra la base de datos:
 * - Validar que productos existan en BD
 * - Verificar stock disponible
 * - Detectar inconsistencias (cantidad > stock)
 * - Validar precios contra BD
 * - Verificar promociones activas
 * 
 * @module core/salesFlow/orderValidator
 */

class OrderValidator {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 2 * 60 * 1000; // 2 minutos
  }

  /**
   * Validar un pedido completo
   * 
   * @param {array} productos - Array de {producto_id, cantidad, precio_unitario, nombre}
   * @returns {Promise<object>} {valid: boolean, validatedProducts: array, errors: array, message: string}
   */
  async validateOrder(productos = []) {
    try {
      if (!productos || productos.length === 0) {
        return {
          valid: false,
          validatedProducts: [],
          errors: ['No hay productos en el pedido'],
          message: 'El pedido está vacío. Agrega productos para continuar.'
        };
      }

      const validatedProducts = [];
      const errors = [];
      const warnings = [];

      for (const item of productos) {
        const validation = await this.validateProduct(item);

        if (validation.valid) {
          validatedProducts.push(validation.producto);
        } else {
          errors.push(...validation.errors);
          warnings.push(...(validation.warnings || []));
        }
      }

      if (errors.length > 0) {
        return {
          valid: false,
          validatedProducts,
          errors,
          warnings,
          message: this._formatErrorMessage(errors)
        };
      }

      return {
        valid: true,
        validatedProducts,
        errors: [],
        warnings,
        message: 'Pedido validado correctamente'
      };
    } catch (error) {
      logger.error('Error en validateOrder:', error);
      return {
        valid: false,
        validatedProducts: [],
        errors: [error.message],
        message: 'Error al validar el pedido'
      };
    }
  }

  /**
   * Validar un producto individual
   * 
   * @param {object} item - {producto_id, cantidad, precio_unitario, nombre}
   * @returns {Promise<object>} {valid: boolean, producto: object, errors: array}
   */
  async validateProduct(item) {
    try {
      const errors = [];
      const warnings = [];

      // Validar estructura básica
      if (!item.producto_id && !item.nombre) {
        return {
          valid: false,
          producto: null,
          errors: ['Producto no especificado']
        };
      }

      // Obtener producto desde BD
      let producto = null;
      
      if (item.producto_id) {
        producto = await databaseManager.getProductoById(item.producto_id);
      } else if (item.nombre) {
        const productos = await databaseManager.buscarProductos(item.nombre, { limit: 1 });
        producto = productos && productos.length > 0 ? productos[0] : null;
      }

      if (!producto) {
        return {
          valid: false,
          producto: null,
          errors: [`Producto "${item.nombre || item.producto_id}" no encontrado en el catálogo`]
        };
      }

      // Validar cantidad
      const cantidad = parseInt(item.cantidad || 1);
      if (isNaN(cantidad) || cantidad < 1) {
        errors.push(`Cantidad inválida para producto "${producto.nombre}"`);
      }

      // Validar stock
      const stockDisponible = parseInt(producto.stock_actual || 0);
      if (stockDisponible < cantidad) {
        errors.push(
          `Stock insuficiente para "${producto.nombre}". ` +
          `Solicitado: ${cantidad}, Disponible: ${stockDisponible}`
        );
      } else if (stockDisponible === cantidad) {
        warnings.push(`⚠️ Solo queda ${stockDisponible} unidad${stockDisponible > 1 ? 'es' : ''} de "${producto.nombre}"`);
      }

      // Validar precio (comparar con precio en BD)
      const precioBD = parseFloat(producto.precio_venta || 0);
      const precioSolicitado = parseFloat(item.precio_unitario || precioBD);
      
      if (precioSolicitado !== precioBD) {
        warnings.push(
          `Precio de "${producto.nombre}" ha cambiado. ` +
          `Nuevo precio: S/. ${precioBD.toFixed(2)} (anterior: S/. ${precioSolicitado.toFixed(2)})`
        );
      }

      // Obtener precio final con promociones
      const descuentoInfo = await promotionsManager.aplicarDescuento(
        producto.id,
        precioBD,
        cantidad,
        producto
      );

      const precioFinal = descuentoInfo.precioFinal;
      const subtotal = precioFinal * cantidad;

      // Construir objeto de producto validado
      const productoValidado = {
        producto_id: producto.id,
        nombre: producto.nombre,
        cantidad,
        precio_unitario: precioBD,
        precio_final: precioFinal,
        precio_original: precioBD,
        descuento: descuentoInfo.descuento,
        descuentoPorcentaje: descuentoInfo.descuentoPorcentaje,
        subtotal: parseFloat(subtotal.toFixed(2)),
        stock_disponible: stockDisponible,
        producto: producto, // Objeto completo del producto
        promocion: descuentoInfo.promocion || null
      };

      if (errors.length > 0) {
        return {
          valid: false,
          producto: null,
          errors
        };
      }

      return {
        valid: true,
        producto: productoValidado,
        errors: [],
        warnings
      };
    } catch (error) {
      logger.error(`Error en validateProduct(${item.producto_id || item.nombre}):`, error);
      return {
        valid: false,
        producto: null,
        errors: [`Error al validar producto: ${error.message}`]
      };
    }
  }

  /**
   * Verificar stock de un producto
   * 
   * @param {number} productoId - ID del producto
   * @param {number} cantidad - Cantidad requerida
   * @returns {Promise<object>} {disponible: boolean, stock_actual: number, error: string|null}
   */
  async verifyStock(productoId, cantidad) {
    try {
      return await databaseManager.verificarStock(productoId, cantidad);
    } catch (error) {
      logger.error(`Error en verifyStock(${productoId}, ${cantidad}):`, error);
      return {
        disponible: false,
        stock_actual: 0,
        error: error.message
      };
    }
  }

  /**
   * Validar que un producto exista en BD
   * 
   * @param {number|string} productoIdOrName - ID o nombre del producto
   * @returns {Promise<object|null>} Producto si existe, null si no
   */
  async validateProductExists(productoIdOrName) {
    try {
      let producto = null;

      if (typeof productoIdOrName === 'number') {
        producto = await databaseManager.getProductoById(productoIdOrName);
      } else {
        const productos = await databaseManager.buscarProductos(productoIdOrName, { limit: 1 });
        producto = productos && productos.length > 0 ? productos[0] : null;
      }

      return producto;
    } catch (error) {
      logger.error(`Error en validateProductExists(${productoIdOrName}):`, error);
      return null;
    }
  }

  /**
   * Validar precio contra BD
   * 
   * @param {number} productoId - ID del producto
   * @param {number} precio - Precio a validar
   * @returns {Promise<object>} {valid: boolean, precio_bd: number, diferencia: number}
   */
  async validatePrice(productoId, precio) {
    try {
      const producto = await databaseManager.getProductoById(productoId);
      
      if (!producto) {
        return {
          valid: false,
          precio_bd: 0,
          diferencia: precio,
          error: 'Producto no encontrado'
        };
      }

      const precioBD = parseFloat(producto.precio_venta || 0);
      const diferencia = Math.abs(precio - precioBD);
      const tolerancia = 0.01; // Tolerancia de 1 céntimo

      return {
        valid: diferencia <= tolerancia,
        precio_bd: precioBD,
        precio_solicitado: precio,
        diferencia: parseFloat(diferencia.toFixed(2)),
        mensaje: diferencia > tolerancia 
          ? `Precio ha cambiado. Nuevo precio: S/. ${precioBD.toFixed(2)}`
          : 'Precio válido'
      };
    } catch (error) {
      logger.error(`Error en validatePrice(${productoId}, ${precio}):`, error);
      return {
        valid: false,
        precio_bd: 0,
        diferencia: precio,
        error: error.message
      };
    }
  }

  /**
   * Validar promociones activas para productos
   * 
   * @param {array} productos - Array de {producto_id, cantidad}
   * @returns {Promise<array>} Array de promociones aplicadas
   */
  async validatePromotions(productos = []) {
    try {
      const promocionesAplicadas = [];

      for (const item of productos) {
        const producto = await databaseManager.getProductoById(item.producto_id);
        
        if (producto) {
          const promociones = await promotionsManager.getPromocionesParaProducto(
            producto.id,
            producto
          );

          if (promociones && promociones.length > 0) {
            promocionesAplicadas.push({
              producto_id: producto.id,
              nombre: producto.nombre,
              promociones
            });
          }
        }
      }

      return promocionesAplicadas;
    } catch (error) {
      logger.error('Error en validatePromotions:', error);
      return [];
    }
  }

  /**
   * Formatear mensaje de errores
   * 
   * @param {array} errors - Array de mensajes de error
   * @returns {string} Mensaje formateado
   */
  _formatErrorMessage(errors) {
    if (!errors || errors.length === 0) {
      return '';
    }

    if (errors.length === 1) {
      return `❌ ${errors[0]}`;
    }

    let message = `❌ *Se encontraron ${errors.length} errores:*\n\n`;
    errors.forEach((error, idx) => {
      message += `${idx + 1}. ${error}\n`;
    });

    return message;
  }

  /**
   * Calcular total del pedido validado
   * 
   * @param {array} validatedProducts - Array de productos validados
   * @returns {object} {total: number, subtotal: number, descuento_total: number}
   */
  calculateTotal(validatedProducts = []) {
    let subtotal = 0;
    let descuentoTotal = 0;

    for (const item of validatedProducts) {
      subtotal += parseFloat(item.subtotal || 0);
      descuentoTotal += parseFloat(item.descuento || 0) * (item.cantidad || 1);
    }

    const total = subtotal;

    return {
      total: parseFloat(total.toFixed(2)),
      subtotal: parseFloat(subtotal.toFixed(2)),
      descuento_total: parseFloat(descuentoTotal.toFixed(2))
    };
  }
}

module.exports = new OrderValidator();
