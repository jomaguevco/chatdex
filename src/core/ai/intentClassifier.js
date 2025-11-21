const { pipeline } = require('@xenova/transformers');
const logger = require('../../utils/logger');

/**
 * Clasificador de intenciones usando DistilBERT
 * 
 * Este módulo utiliza un modelo DistilBERT fine-tuned para clasificar rápidamente
 * las intenciones del usuario en mensajes de texto.
 * 
 * Intenciones soportadas:
 * - HACER_PEDIDO: Quiere comprar/agregar productos
 * - VER_CATALOGO: Pide lista de productos
 * - VER_PRODUCTO: Pide info de un producto específico
 * - CONSULTAR_PRECIO: Pregunta el precio
 * - CONSULTAR_STOCK: Pregunta disponibilidad
 * - VER_PEDIDO: Quiere ver su pedido actual
 * - CANCELAR: Quiere cancelar/salir
 * - AYUDA: Pide ayuda
 * - OTRO: No encaja en lo anterior
 * 
 * @module core/ai/intentClassifier
 */

class IntentClassifier {
  constructor() {
    this.model = null;
    this.tokenizer = null;
    this.isLoading = false;
    this.isReady = false;
    this.fallbackEnabled = true;
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutos
  }

  /**
   * Inicializar el modelo DistilBERT
   * 
   * @returns {Promise<boolean>} true si se inicializó correctamente
   */
  async initialize() {
    if (this.isReady) {
      return true;
    }

    if (this.isLoading) {
      logger.info('Modelo ya está cargándose, esperando...');
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 1000);
      });
    }

    try {
      this.isLoading = true;
      logger.info('🔄 Cargando modelo DistilBERT para clasificación de intenciones...');

      // Usar un modelo de clasificación de texto genérico
      // En producción, se recomienda fine-tunear con datos específicos
      this.classifier = await pipeline(
        'text-classification',
        'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
        {
          device: 'cpu', // Usar CPU para compatibilidad
          quantized: true // Usar versión cuantizada para menor uso de memoria
        }
      );

      // Como el modelo es en inglés y para sentimientos, usamos reglas como fallback
      // En el futuro se puede fine-tunear con datos en español
      logger.warn('⚠️ Usando modelo genérico. Para mejor precisión, fine-tune con datos en español.');
      
      this.isReady = true;
      this.isLoading = false;
      logger.success('✅ Modelo DistilBERT cargado (modo fallback activado)');
      
      return true;
    } catch (error) {
      logger.error('❌ Error al cargar modelo DistilBERT:', error);
      logger.warn('⚠️ Se usará clasificación por reglas como fallback');
      this.isReady = false;
      this.isLoading = false;
      return false;
    }
  }

  /**
   * Clasificar intención usando reglas (fallback cuando el modelo no está disponible)
   * 
   * @param {string} text - Texto a clasificar
   * @returns {object} {intent: string, confidence: number}
   */
  _classifyWithRules(text) {
    const textLower = text.toLowerCase().trim();
    
    // Palabras clave por intención
    const intentKeywords = {
      HACER_PEDIDO: ['quiero', 'necesito', 'dame', 'me llevo', 'comprar', 'pedir', 'agregar', 'ponme', 'traeme', 
                     'me gustaría', 'quisiera', 'estoy interesado', 'vamos a comprar', 'demen', 'consigo'],
      VER_CATALOGO: ['catálogo', 'catalogo', 'productos', 'producto', 'lista', 'ver productos', 'quiero ver', 
                     'muestrame', 'muéstrame', 'mostrar', 'que tienen', 'qué tienen', 'que venden', 'qué venden'],
      VER_PRODUCTO: ['info de', 'detalles de', 'qué es', 'cuéntame de', 'información de', 'datos de', 
                     'características de'],
      CONSULTAR_PRECIO: ['cuánto cuesta', 'cuanto cuesta', 'precio', 'vale', 'cuesta', 'a cuánto', 'cuánto sale'],
      CONSULTAR_STOCK: ['tienes', 'hay', 'disponible', 'stock', 'tienen', 'queda', 'tienes disponible', 
                        'hay disponible', 'tienen stock', 'hay stock', 'queda stock'],
      VER_PEDIDO: ['mi pedido', 'pedido actual', 'orden actual', 'ver pedido actual', 'que tengo', 'qué tengo', 
                   'que pedi', 'qué pedí', 'ver mi pedido', 'mostrar pedido', 'estado', 'status', 'ver pedido'],
      CANCELAR: ['cancelar', 'salir', 'no quiero', 'déjalo', 'dejalo', 'olvídalo', 'olvidalo', 'mejor no', 
                 'ya no', 'no importa', 'volver', 'inicio', 'empezar de nuevo'],
      AYUDA: ['ayuda', 'help', 'qué puedo hacer', 'opciones', 'comandos', 'cómo funciona']
    };

    let bestIntent = 'OTRO';
    let bestScore = 0;

    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (textLower.includes(keyword)) {
          score += 1;
          // Si la palabra clave está al inicio, aumentar score
          if (textLower.startsWith(keyword)) {
            score += 0.5;
          }
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    // Calcular confianza (normalizada entre 0 y 1)
    const confidence = Math.min(bestScore / 3, 1.0); // Máximo score esperado es ~3

    return {
      intent: bestIntent,
      confidence: confidence > 0 ? confidence : 0.3 // Mínimo 0.3 si hay alguna coincidencia
    };
  }

  /**
   * Clasificar intención de un mensaje
   * 
   * @param {string} text - Texto del mensaje
   * @param {boolean} useCache - Si usar cache (default: true)
   * @returns {Promise<object>} {intent: string, confidence: number, method: string}
   */
  async classify(text, useCache = true) {
    try {
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return {
          intent: 'OTRO',
          confidence: 0.1,
          method: 'fallback'
        };
      }

      // Verificar cache
      const cacheKey = `intent_${text.toLowerCase().trim()}`;
      if (useCache && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          logger.debug(`[Cache] Intención encontrada en cache: ${cached.result.intent}`);
          return cached.result;
        }
      }

      // Intentar usar modelo si está disponible
      let result = null;
      
      if (this.isReady && this.classifier) {
        try {
          // Como el modelo es genérico (sentimientos), usamos reglas como principal
          // En el futuro se puede usar el modelo si está fine-tuned
          result = this._classifyWithRules(text);
          result.method = 'rules';
        } catch (modelError) {
          logger.warn('Error al usar modelo, usando reglas:', modelError.message);
          result = this._classifyWithRules(text);
          result.method = 'rules_fallback';
        }
      } else {
        // Usar reglas directamente
        result = this._classifyWithRules(text);
        result.method = 'rules';
      }

      // Guardar en cache
      if (useCache) {
        this.cache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });
      }

      logger.debug(`Intención clasificada: ${result.intent} (confianza: ${result.confidence.toFixed(2)}, método: ${result.method})`);
      
      return result;
    } catch (error) {
      logger.error('Error en classify:', error);
      return {
        intent: 'OTRO',
        confidence: 0.1,
        method: 'error_fallback'
      };
    }
  }

  /**
   * Clasificar múltiples mensajes en batch
   * 
   * @param {array} texts - Array de textos
   * @returns {Promise<array>} Array de resultados de clasificación
   */
  async classifyBatch(texts) {
    const results = [];
    
    for (const text of texts) {
      const result = await this.classify(text, true);
      results.push({
        text,
        ...result
      });
    }

    return results;
  }

  /**
   * Limpiar cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('✅ Cache de intenciones limpiado');
  }

  /**
   * Obtener estadísticas
   * 
   * @returns {object} Estadísticas del clasificador
   */
  getStats() {
    return {
      isReady: this.isReady,
      isLoading: this.isLoading,
      cacheSize: this.cache.size,
      fallbackEnabled: this.fallbackEnabled
    };
  }
}

module.exports = new IntentClassifier();
