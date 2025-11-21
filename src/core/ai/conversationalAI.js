const ollamaClient = require('../../utils/ollamaClient');
const logger = require('../../utils/logger');

/**
 * IA Conversacional usando Ollama
 * 
 * Este módulo utiliza Ollama para comprensión profunda de mensajes complejos:
 * - Entender mensajes largos, confusos o mal redactados
 * - Extraer intenciones complejas y ambiguas
 * - Abstraer intención real aunque no esté expresada literalmente
 * - Procesar lenguaje coloquial y variaciones
 * 
 * @module core/ai/conversationalAI
 */

class ConversationalAI {
  constructor() {
    this.systemPrompt = `Eres un asistente de ventas conversacional, amigable y muy comprensivo de KARDEX.
Tu función es entender la intención real del cliente, incluso si:
- Escribe con errores ortográficos
- Usa lenguaje coloquial o informal
- Expresa su intención de forma indirecta o confusa
- Mezcla múltiples intenciones en un solo mensaje

Debes:
1. Entender el mensaje completo, no solo palabras clave
2. Identificar la intención principal aunque esté expresada indirectamente
3. Ser tolerante con errores de escritura y pronunciación
4. Abstraer la intención real aunque no esté explícita

INTENCIONES POSIBLES:
- "HACER_PEDIDO": Quiere comprar/agregar productos. Incluye: "quiero", "necesito", "dame", "me llevo", "comprar", "pedir", "agregar", "ponme", "traeme", "me gustaría", "quisiera", "estoy interesado", "vamos a comprar", "necesito comprar", "me interesa", "demen", "consigo", "me llevo"
- "VER_CATALOGO": Pide la lista de productos. Incluye: "catálogo", "catalogo", "productos", "producto", "lista", "ver productos", "quiero ver", "muestrame", "muéstrame", "mostrar", "ver catálogo", "ver catalogo", "que tienen", "qué tienen", "que venden", "qué venden"
- "VER_PRODUCTO": Pide info de un producto particular. Incluye: "info de", "detalles de", "qué es", "cuéntame de", "información de", "datos de", "características de"
- "CONSULTAR_PRECIO": Pregunta el precio. Incluye: "cuánto cuesta", "cuanto cuesta", "precio", "vale", "cuesta", "a cuánto", "cuánto sale"
- "CONSULTAR_STOCK": Pregunta disponibilidad. Incluye: "tienes", "hay", "disponible", "stock", "tienen", "queda", "tienes disponible", "hay disponible", "tienen stock", "hay stock", "queda stock", "tienes en stock", "hay en stock"
- "VER_PEDIDO": Quiere ver su pedido actual. Incluye: "mi pedido", "pedido actual", "orden actual", "ver pedido actual", "que tengo", "qué tengo", "que pedi", "qué pedí", "ver mi pedido", "mostrar pedido", "listar pedido", "productos del pedido", "qué tengo en el pedido", "estado", "status", "ver pedido", "ver mi orden"
- "CANCELAR": Quiere cancelar, salir, volver al inicio, empezar de nuevo, terminar. Incluye: "cancelar", "salir", "no quiero", "déjalo", "dejalo", "olvídalo", "olvidalo", "mejor no", "ya no", "no importa", "volver", "inicio", "empezar de nuevo"
- "SALIR": Quiere salir, cancelar, volver. Sinónimos de CANCELAR
- "VOLVER": Quiere volver al inicio, cancelar la operación actual. Sinónimos de CANCELAR
- "SALUDO": Es un saludo (hola, buenos días, buenas tardes, buenas noches, hi, hello, qué tal, cómo estás)
- "AYUDA": Pide ayuda o comandos disponibles. Incluye: "ayuda", "help", "qué puedo hacer", "opciones", "comandos", "cómo funciona"
- "BUSCAR": Búsqueda de productos con filtros. Incluye: "buscar", "filtrar", "productos baratos", "menos de X", "con stock", "disponibles", "productos económicos", "productos caros", "productos entre X y Y", "solo disponibles", "solo con stock"
- "OTRO": No encaja en lo anterior

Responde SOLO con un JSON válido con este formato:
{
  "intencion": "HACER_PEDIDO" | "VER_CATALOGO" | "VER_PRODUCTO" | "CONSULTAR_PRECIO" | "CONSULTAR_STOCK" | "VER_PEDIDO" | "CANCELAR" | "SALIR" | "VOLVER" | "SALUDO" | "AYUDA" | "BUSCAR" | "OTRO",
  "confianza": 0.0-1.0,
  "razonamiento": "Breve explicación de por qué clasificaste así",
  "productos_extraidos": ["lista de productos mencionados si hay"],
  "preguntas_detectadas": ["preguntas que el cliente hace si hay"]
}`;

    this.cache = new Map();
    this.cacheTTL = 2 * 60 * 1000; // 2 minutos
  }

  /**
   * Procesar mensaje con comprensión profunda
   * 
   * @param {string} text - Texto del mensaje
   * @param {array} conversationHistory - Historial de conversación (opcional)
   * @param {object} context - Contexto adicional (opcional)
   * @returns {Promise<object>} {intent, confidence, reasoning, products, questions}
   */
  async processMessage(text, conversationHistory = [], context = {}) {
    try {
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return {
          intent: 'OTRO',
          confidence: 0.1,
          reasoning: 'Mensaje vacío',
          products: [],
          questions: []
        };
      }

      // Verificar cache
      const cacheKey = `conv_${text.toLowerCase().trim().substring(0, 50)}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('[Cache] Resultado conversacional encontrado en cache');
        return cached.data;
      }

      // Construir prompt con contexto
      let prompt = `Usuario dice: "${text}"\n\n`;
      
      if (conversationHistory.length > 0) {
        prompt += `Contexto de conversación anterior:\n`;
        conversationHistory.slice(-3).forEach((msg, idx) => {
          prompt += `${idx + 1}. ${msg.role === 'user' ? 'Usuario' : 'Bot'}: ${msg.content.substring(0, 100)}\n`;
        });
        prompt += `\n`;
      }

      if (Object.keys(context).length > 0) {
        prompt += `Contexto adicional: ${JSON.stringify(context)}\n\n`;
      }

      prompt += `Analiza el mensaje del usuario y determina su intención principal.`;

      // Procesar con Ollama
      let result = null;
      
      try {
        const response = await ollamaClient.generate(
          prompt,
          this.systemPrompt,
          {
            temperature: 0.3, // Baja temperatura para más consistencia
            timeout: 8000 // 8 segundos timeout
          }
        );

        // Intentar parsear JSON de la respuesta
        result = this._parseResponse(response);
      } catch (ollamaError) {
        logger.warn('Error al procesar con Ollama, usando fallback:', ollamaError.message);
        result = this._fallbackClassification(text);
      }

      // Si no se pudo procesar, usar fallback
      if (!result || !result.intent) {
        result = this._fallbackClassification(text);
      }

      // Guardar en cache
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      logger.debug(`Intención conversacional: ${result.intent} (confianza: ${result.confidence || 0.5})`);
      
      return result;
    } catch (error) {
      logger.error('Error en processMessage:', error);
      return this._fallbackClassification(text);
    }
  }

  /**
   * Parsear respuesta de Ollama (extraer JSON)
   * 
   * @param {string} response - Respuesta de Ollama
   * @returns {object|null} Objeto parseado o null
   */
  _parseResponse(response) {
    try {
      // Intentar extraer JSON del texto
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validar estructura
        if (parsed.intencion) {
          return {
            intent: parsed.intencion.toUpperCase(),
            confidence: parsed.confianza || 0.7,
            reasoning: parsed.razonamiento || '',
            products: parsed.productos_extraidos || [],
            questions: parsed.preguntas_detectadas || []
          };
        }
      }

      // Si no hay JSON, intentar detectar intención desde el texto
      const textLower = response.toLowerCase();
      const intentMap = {
        'hacer_pedido': 'HACER_PEDIDO',
        'ver_catalogo': 'VER_CATALOGO',
        'ver_producto': 'VER_PRODUCTO',
        'consultar_precio': 'CONSULTAR_PRECIO',
        'consultar_stock': 'CONSULTAR_STOCK',
        'ver_pedido': 'VER_PEDIDO',
        'cancelar': 'CANCELAR',
        'salir': 'SALIR',
        'volver': 'VOLVER',
        'saludo': 'SALUDO',
        'ayuda': 'AYUDA',
        'buscar': 'BUSCAR'
      };

      for (const [key, intent] of Object.entries(intentMap)) {
        if (textLower.includes(key)) {
          return {
            intent,
            confidence: 0.6,
            reasoning: 'Detectado desde texto de respuesta',
            products: [],
            questions: []
          };
        }
      }

      return null;
    } catch (error) {
      logger.warn('Error al parsear respuesta de Ollama:', error.message);
      return null;
    }
  }

  /**
   * Clasificación de fallback cuando Ollama no está disponible
   * 
   * @param {string} text - Texto del mensaje
   * @returns {object} Resultado de clasificación básica
   */
  _fallbackClassification(text) {
    const textLower = text.toLowerCase().trim();
    
    // Clasificación básica por palabras clave
    if (textLower.match(/(quiero|necesito|dame|me llevo|comprar|pedir|agregar)/)) {
      return {
        intent: 'HACER_PEDIDO',
        confidence: 0.7,
        reasoning: 'Palabra clave de pedido detectada',
        products: [],
        questions: []
      };
    }
    
    if (textLower.match(/(catálogo|catalogo|productos|lista|muestrame|mostrar)/)) {
      return {
        intent: 'VER_CATALOGO',
        confidence: 0.7,
        reasoning: 'Palabra clave de catálogo detectada',
        products: [],
        questions: []
      };
    }
    
    if (textLower.match(/(cuánto|costo|precio|vale)/)) {
      return {
        intent: 'CONSULTAR_PRECIO',
        confidence: 0.7,
        reasoning: 'Palabra clave de precio detectada',
        products: [],
        questions: []
      };
    }
    
    if (textLower.match(/(cancelar|salir|no quiero|déjalo|volver)/)) {
      return {
        intent: 'CANCELAR',
        confidence: 0.7,
        reasoning: 'Palabra clave de cancelación detectada',
        products: [],
        questions: []
      };
    }
    
    if (textLower.match(/(hola|hi|hello|buenos|buenas|saludos)/)) {
      return {
        intent: 'SALUDO',
        confidence: 0.8,
        reasoning: 'Saludo detectado',
        products: [],
        questions: []
      };
    }

    return {
      intent: 'OTRO',
      confidence: 0.3,
      reasoning: 'No se pudo clasificar con certeza',
      products: [],
      questions: []
    };
  }

  /**
   * Limpiar cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('✅ Cache de IA conversacional limpiado');
  }
}

module.exports = new ConversationalAI();
