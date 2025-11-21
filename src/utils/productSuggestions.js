const logger = require('./logger');
const kardexApi = require('../kardexApi');
const kardexDb = require('../kardexDb');
const { normalize: normalizePhon, soundexEs } = require('./phonetics');

class ProductSuggestions {
  /**
   * Obtener sugerencias de productos similares
   */
  async getSimilarProducts(productName, limit = 5) {
    try {
      // Obtener todos los productos disponibles
      let productos = null;
      if (kardexDb.isConnected()) {
        productos = await kardexDb.getProductos({ activo: true, limit: 100 });
      }
      if (!productos || productos.length === 0) {
        productos = await kardexApi.getProductos({ activo: true, limit: 100 });
      }

      if (!productos || productos.length === 0) {
        return [];
      }

      // Normalizar nombre del producto buscado
      const nombreNormalizado = normalizePhon(productName.toLowerCase());
      const soundexBuscado = soundexEs(productName);

      // Calcular similitud para cada producto
      const productosConSimilitud = productos.map(producto => {
        const nombreProducto = producto.nombre || '';
        const nombreProductoNormalizado = normalizePhon(nombreProducto.toLowerCase());
        
        // Calcular similitud fonética
        const soundexProducto = soundexEs(nombreProducto);
        const similitudFonetica = soundexBuscado === soundexProducto ? 1 : 0;

        // Calcular similitud por palabras comunes
        const palabrasBuscadas = nombreNormalizado.split(/\s+/).filter(Boolean);
        const palabrasProducto = nombreProductoNormalizado.split(/\s+/).filter(Boolean);
        const palabrasComunes = palabrasBuscadas.filter(p => palabrasProducto.includes(p));
        const similitudPalabras = palabrasComunes.length / Math.max(palabrasBuscadas.length, 1);

        // Calcular similitud por subcadena
        let similitudSubcadena = 0;
        if (nombreProductoNormalizado.includes(nombreNormalizado) || 
            nombreNormalizado.includes(nombreProductoNormalizado)) {
          similitudSubcadena = 0.7;
        }

        // Similitud total (ponderada)
        const similitudTotal = (similitudFonetica * 0.4) + (similitudPalabras * 0.4) + (similitudSubcadena * 0.2);

        return {
          producto,
          similitud: similitudTotal
        };
      });

      // Ordenar por similitud y retornar los mejores
      return productosConSimilitud
        .filter(item => item.similitud > 0.1) // Filtrar productos con muy poca similitud
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, limit)
        .map(item => item.producto);
    } catch (error) {
      logger.error('Error al obtener productos similares', error);
      return [];
    }
  }

  /**
   * Obtener productos populares (más vendidos o con más stock)
   */
  async getPopularProducts(limit = 5) {
    try {
      let productos = null;
      if (kardexDb.isConnected()) {
        productos = await kardexDb.getProductos({ activo: true, limit: 50 });
      }
      if (!productos || productos.length === 0) {
        productos = await kardexApi.getProductos({ activo: true, limit: 50 });
      }

      if (!productos || productos.length === 0) {
        return [];
      }

      // Ordenar por stock (productos con más stock suelen ser más populares)
      // O por precio (productos más baratos suelen ser más populares)
      return productos
        .filter(p => p.stock_actual > 0)
        .sort((a, b) => {
          // Priorizar productos con stock
          if (a.stock_actual > 0 && b.stock_actual === 0) return -1;
          if (a.stock_actual === 0 && b.stock_actual > 0) return 1;
          
          // Luego por precio (más baratos primero)
          const precioA = parseFloat(a.precio_venta || 0);
          const precioB = parseFloat(b.precio_venta || 0);
          return precioA - precioB;
        })
        .slice(0, limit);
    } catch (error) {
      logger.error('Error al obtener productos populares', error);
      return [];
    }
  }

  /**
   * Obtener productos relacionados (misma categoría o tipo)
   */
  async getRelatedProducts(productName, limit = 5) {
    try {
      // Primero buscar el producto original
      let productos = null;
      if (kardexDb.isConnected()) {
        productos = await kardexDb.getProductos({ activo: true, limit: 100 });
      }
      if (!productos || productos.length === 0) {
        productos = await kardexApi.getProductos({ activo: true, limit: 100 });
      }

      if (!productos || productos.length === 0) {
        return [];
      }

      // Buscar productos con palabras clave similares
      const palabrasClave = productName.toLowerCase().split(/\s+/).filter(Boolean);
      const productosRelacionados = productos
        .filter(p => {
          const nombreProducto = (p.nombre || '').toLowerCase();
          return palabrasClave.some(palabra => nombreProducto.includes(palabra));
        })
        .slice(0, limit);

      return productosRelacionados;
    } catch (error) {
      logger.error('Error al obtener productos relacionados', error);
      return [];
    }
  }

  /**
   * Generar mensaje de sugerencias
   */
  formatSuggestions(sugerencias, mensajeBase = 'No encontré ese producto') {
    if (!sugerencias || sugerencias.length === 0) {
      return mensajeBase + '. ¿Podrías ser más específico?';
    }

    let mensaje = mensajeBase + ', pero te sugiero estos productos similares:\n\n';
    
    sugerencias.forEach((producto, index) => {
      const precio = typeof producto.precio_venta === 'number' 
        ? producto.precio_venta.toFixed(2) 
        : parseFloat(producto.precio_venta || 0).toFixed(2);
      
      mensaje += `${index + 1}. *${producto.nombre}*\n`;
      mensaje += `   Precio: S/ ${precio}`;
      if (producto.stock_actual !== undefined) {
        mensaje += ` | Stock: ${producto.stock_actual > 0 ? '✅ Disponible' : '❌ Agotado'}`;
      }
      mensaje += '\n\n';
    });

    mensaje += '💡 *Para pedir alguno de estos productos, escribe su nombre o envíalo por voz.*';

    return mensaje;
  }
}

module.exports = new ProductSuggestions();

