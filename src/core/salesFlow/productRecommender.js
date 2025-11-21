const databaseManager = require('../database/databaseManager');
const logger = require('../../utils/logger');

/**
 * Recomendador de productos inteligente
 * 
 * Este módulo proporciona recomendaciones de productos basadas en:
 * - Historial de compras del cliente
 * - Productos similares (por nombre, categoría, precio)
 * - Productos populares (más vendidos)
 * - Productos relacionados por categoría
 * - Detección de dudas y preguntas del cliente
 * 
 * @module core/salesFlow/productRecommender
 */

class ProductRecommender {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10 minutos
  }

  /**
   * Obtener productos similares a uno dado
   * 
   * @param {string} productoNombre - Nombre del producto
   * @param {number} limit - Límite de resultados (default: 5)
   * @returns {Promise<array>} Array de productos similares
   */
  async getSimilarProducts(productoNombre, limit = 5) {
    try {
      const cacheKey = `similar_${productoNombre.toLowerCase().trim()}_${limit}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('[Cache] Productos similares encontrados en cache');
        return cached.data;
      }

      // Buscar productos que contengan palabras del nombre
      const palabras = productoNombre.toLowerCase().split(/\s+/).filter(p => p.length > 2);
      
      let productosSimilares = [];
      
      for (const palabra of palabras.slice(0, 3)) { // Tomar hasta 3 palabras clave
        const resultados = await databaseManager.buscarProductos(palabra, {
          limit: 20
        });
        
        if (resultados && resultados.length > 0) {
          productosSimilares.push(...resultados);
        }
      }

      // Eliminar duplicados y ordenar por relevancia
      const uniqueProducts = [];
      const seenIds = new Set();
      
      for (const producto of productosSimilares) {
        if (!seenIds.has(producto.id)) {
          seenIds.add(producto.id);
          
          // Calcular score de similitud
          const similarity = this._calculateSimilarity(productoNombre, producto.nombre);
          uniqueProducts.push({
            ...producto,
            similarity_score: similarity
          });
        }
      }

      // Ordenar por score de similitud y stock disponible
      uniqueProducts.sort((a, b) => {
        if (a.similarity_score !== b.similarity_score) {
          return b.similarity_score - a.similarity_score;
        }
        // Si mismo score, priorizar con stock
        const aStock = a.stock_actual || 0;
        const bStock = b.stock_actual || 0;
        return bStock - aStock;
      });

      const resultado = uniqueProducts.slice(0, limit);

      // Guardar en cache
      this.cache.set(cacheKey, {
        data: resultado,
        timestamp: Date.now()
      });

      return resultado;
    } catch (error) {
      logger.error(`Error en getSimilarProducts("${productoNombre}"):`, error);
      return [];
    }
  }

  /**
   * Obtener productos populares (más vendidos o con mayor stock)
   * 
   * @param {number} limit - Límite de resultados (default: 5)
   * @param {object} filters - Filtros {categoria_id, minStock}
   * @returns {Promise<array>} Array de productos populares
   */
  async getPopularProducts(limit = 5, filters = {}) {
    try {
      const cacheKey = `popular_${limit}_${JSON.stringify(filters)}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('[Cache] Productos populares encontrados en cache');
        return cached.data;
      }

      // Obtener productos con filtros
      const productos = await databaseManager.getProductos({
        limit: limit * 2, // Obtener más para filtrar
        ...filters,
        inStock: filters.minStock ? true : undefined
      });

      if (!productos || productos.length === 0) {
        return [];
      }

      // Ordenar por stock disponible (productos con más stock son más populares)
      const productosOrdenados = productos
        .filter(p => !filters.minStock || (p.stock_actual || 0) >= filters.minStock)
        .sort((a, b) => {
          const aStock = a.stock_actual || 0;
          const bStock = b.stock_actual || 0;
          return bStock - aStock;
        })
        .slice(0, limit);

      // Guardar en cache
      this.cache.set(cacheKey, {
        data: productosOrdenados,
        timestamp: Date.now()
      });

      return productosOrdenados;
    } catch (error) {
      logger.error(`Error en getPopularProducts(${limit}):`, error);
      return [];
    }
  }

  /**
   * Obtener productos relacionados por categoría
   * 
   * @param {number} categoriaId - ID de la categoría
   * @param {number} limit - Límite de resultados (default: 5)
   * @param {number} excludeProductId - ID de producto a excluir (opcional)
   * @returns {Promise<array>} Array de productos relacionados
   */
  async getRelatedProductsByCategory(categoriaId, limit = 5, excludeProductId = null) {
    try {
      const cacheKey = `related_cat_${categoriaId}_${limit}_${excludeProductId}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('[Cache] Productos relacionados encontrados en cache');
        return cached.data;
      }

      const productos = await databaseManager.getProductos({
        categoria_id: categoriaId,
        limit: limit + (excludeProductId ? 1 : 0),
        inStock: true
      });

      if (!productos || productos.length === 0) {
        return [];
      }

      // Filtrar producto excluido si existe
      let productosRelacionados = productos;
      if (excludeProductId) {
        productosRelacionados = productos.filter(p => p.id !== excludeProductId);
      }

      const resultado = productosRelacionados.slice(0, limit);

      // Guardar en cache
      this.cache.set(cacheKey, {
        data: resultado,
        timestamp: Date.now()
      });

      return resultado;
    } catch (error) {
      logger.error(`Error en getRelatedProductsByCategory(${categoriaId}):`, error);
      return [];
    }
  }

  /**
   * Detectar si el cliente tiene dudas o preguntas
   * 
   * @param {string} message - Mensaje del cliente
   * @returns {object} {hasDoubt: boolean, doubtType: string, message: string}
   */
  detectDoubt(message) {
    try {
      if (!message || typeof message !== 'string') {
        return { hasDoubt: false };
      }

      const textLower = message.toLowerCase().trim();

      // Patrones de dudas
      const doubtPatterns = {
        comparison: /cuál|cual|cuáles|cuales|mejor|diferencia|comparar|vs|versus/i,
        price: /cuánto|cuanto|precio|vale|cuesta|barato|caro|económico/i,
        stock: /tienes|hay|disponible|stock|queda|tienen/i,
        features: /características|especificaciones|detalles|info|información|qué tiene|que tiene/i,
        recommendation: /recomend|sugiere|mejor|opción|opciones|cuál elegir|cual elegir/i
      };

      for (const [type, pattern] of Object.entries(doubtPatterns)) {
        if (pattern.test(textLower)) {
          let doubtMessage = '';
          
          switch (type) {
            case 'comparison':
              doubtMessage = 'Te ayudo a comparar productos. ¿Qué características son importantes para ti?';
              break;
            case 'price':
              doubtMessage = 'Puedo ayudarte con precios. ¿Qué producto te interesa?';
              break;
            case 'stock':
              doubtMessage = 'Te puedo informar sobre disponibilidad. ¿Qué producto necesitas?';
              break;
            case 'features':
              doubtMessage = 'Puedo darte detalles técnicos. ¿Sobre qué producto quieres saber?';
              break;
            case 'recommendation':
              doubtMessage = 'Puedo recomendarte productos según tus necesidades. ¿Qué estás buscando?';
              break;
          }

          return {
            hasDoubt: true,
            doubtType: type,
            message: doubtMessage
          };
        }
      }

      // Detectar preguntas directas
      if (textLower.includes('?') || textLower.match(/^(cuál|cual|qué|que|dónde|donde|cuándo|cuando|por qué|porque|porque|como|quien|quién)/)) {
        return {
          hasDoubt: true,
          doubtType: 'general',
          message: 'Puedo ayudarte con información sobre productos. ¿Qué necesitas saber?'
        };
      }

      return { hasDoubt: false };
    } catch (error) {
      logger.error('Error en detectDoubt:', error);
      return { hasDoubt: false };
    }
  }

  /**
   * Recomendar productos basados en historial del cliente
   * 
   * @param {number} clienteId - ID del cliente
   * @param {number} limit - Límite de resultados (default: 5)
   * @returns {Promise<array>} Array de productos recomendados
   */
  async getRecommendationsByHistory(clienteId, limit = 5) {
    try {
      // En el futuro, se puede consultar historial de compras desde BD
      // Por ahora, retornar productos populares
      return await this.getPopularProducts(limit);
    } catch (error) {
      logger.error(`Error en getRecommendationsByHistory(${clienteId}):`, error);
      return [];
    }
  }

  /**
   * Formatear sugerencias para mostrar al usuario
   * 
   * @param {array} productos - Array de productos
   * @param {string} header - Encabezado del mensaje
   * @returns {string} Mensaje formateado
   */
  formatSuggestions(productos, header = '💡 *Productos sugeridos:*') {
    try {
      if (!productos || productos.length === 0) {
        return '';
      }

      let message = `${header}\n\n`;

      productos.forEach((p, idx) => {
        message += `${idx + 1}. *${p.nombre}*\n`;
        message += `   💰 Precio: S/. ${parseFloat(p.precio_venta || 0).toFixed(2)}\n`;
        
        if (p.stock_actual !== undefined) {
          if (p.stock_actual > 0) {
            message += `   📊 Stock: ${p.stock_actual} unidades\n`;
          } else {
            message += `   ⚠️ Sin stock disponible\n`;
          }
        }
        
        message += `\n`;
      });

      message += `💬 Responde con el número o el nombre del producto para agregarlo.`;

      return message;
    } catch (error) {
      logger.error('Error en formatSuggestions:', error);
      return '';
    }
  }

  /**
   * Calcular similitud entre dos strings (simple)
   * 
   * @param {string} str1 - Primer string
   * @param {string} str2 - Segundo string
   * @returns {number} Score de similitud entre 0 y 1
   */
  _calculateSimilarity(str1, str2) {
    if (!str1 || !str2) {
      return 0;
    }

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) {
      return 1;
    }

    // Verificar si uno contiene al otro
    if (s1.includes(s2) || s2.includes(s1)) {
      return 0.8;
    }

    // Verificar palabras en común
    const palabras1 = s1.split(/\s+/);
    const palabras2 = s2.split(/\s+/);
    const palabrasComunes = palabras1.filter(p => palabras2.includes(p));
    
    if (palabrasComunes.length > 0) {
      return palabrasComunes.length / Math.max(palabras1.length, palabras2.length);
    }

    return 0.1;
  }

  /**
   * Limpiar cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('✅ Cache de recomendaciones limpiado');
  }
}

module.exports = new ProductRecommender();
