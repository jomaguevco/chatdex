const ollamaClient = require('./utils/ollamaClient');
const logger = require('./utils/logger');
const kardexApi = require('./kardexApi');
const kardexDb = require('./kardexDb');
const productExtractorAI = require('./productExtractorAI');

class ConversationalAI {
  constructor() {
    this.systemPrompt = `Eres un asistente de ventas inteligente de KARDEX. Cada cliente es único y se comunica de forma diferente.

TU MISIÓN:
Analizar CADA mensaje de forma individual, entendiendo:
- Qué quiere decir el cliente realmente
- Cuál es su necesidad específica
- Cómo se está comunicando (formal, informal, urgente, etc.)
- Qué información necesita en este momento exacto

PRINCIPIOS FUNDAMENTALES:
1. NO asumas que todos los clientes son iguales
2. NO uses respuestas genéricas o memorizadas
3. ANALIZA el contexto completo de cada mensaje
4. ADAPTA tu respuesta al estilo y necesidad del cliente
5. ENTIENDE antes de responder

CONTEXTO DE KARDEX:
- Vendemos productos tecnológicos y deportivos
- Los clientes pueden consultar productos, precios, stock y hacer pedidos
- Los mensajes pueden venir de transcripciones de voz (pueden tener errores)

CÓMO RESPONDER:
- Si el cliente pregunta por precio → Busca el producto y responde con precio específico
- Si el cliente saluda → Saluda de forma natural, adaptándote a su tono
- Si el cliente necesita ayuda → Analiza qué tipo de ayuda necesita y responde específicamente
- Si no entiendes → Pregunta de forma clara, sin asumir

IMPORTANTE:
- Cada cliente es diferente, analiza cada mensaje como si fuera la primera vez
- No memorices respuestas, piensa y analiza
- Responde de forma útil, natural y personalizada

Responde SIEMPRE en español.`;

    this.conversationContext = new Map(); // Para mantener contexto de conversaciones
  }

  /**
   * Generar respuesta conversacional usando IA
   * @param {string} userMessage - Mensaje del usuario
   * @param {object} sessionState - Estado de la sesión
   * @param {array} conversationHistory - Historial de conversación
   * @param {string} detectedIntent - Intención detectada (opcional)
   */
  async generateResponse(userMessage, sessionState = {}, conversationHistory = [], detectedIntent = null) {
    try {
      logger.info('🤖 Procesando mensaje con IA conversacional', {
        message: userMessage.substring(0, 50),
        intent: detectedIntent
      });

      // SIEMPRE usar IA para extraer información del producto primero
      const priceQueryPattern = /(?:cuánto|cuanto|precio|vale|cuesta|a cuánto|a cuanto|cuánto sale|cuanto sale|cuánto vale|cuanto vale|precio de|cuál es el precio|cual es el precio|cuánto está|cuanto esta|cuánto esta|cuanto está|quiero saber|necesito saber)/i;
      const productPattern = /(?:tienes|hay|disponible|stock|tienen|queda|producto|productos)/i;
      
      const isProductQuery = priceQueryPattern.test(userMessage) || productPattern.test(userMessage) || 
                            detectedIntent === 'CONSULTAR_PRECIO' || detectedIntent === 'CONSULTAR_STOCK' || detectedIntent === 'VER_PRODUCTO';
      
      if (isProductQuery) {
        logger.info('🔍 Consulta de producto detectada, usando IA para entender y buscar');
        
        try {
          // Usar IA para extraer información del producto (corrige errores de transcripción)
          const productInfo = await productExtractorAI.extractProductInfo(userMessage);
          
          logger.info('✅ Información extraída por IA', {
            producto: productInfo.producto,
            intencion: productInfo.intencion,
            marca: productInfo.marca,
            tipo: productInfo.tipo
          });
          
          if (productInfo && productInfo.producto && productInfo.producto.length > 2) {
            // Buscar producto usando la información extraída por IA
            const producto = await productExtractorAI.searchProduct(productInfo);
            
            if (producto) {
              const precio = typeof producto.precio_venta === 'number' 
                ? producto.precio_venta.toFixed(2) 
                : parseFloat(producto.precio_venta || 0).toFixed(2);
              
              const stock = producto.stock_actual || 0;
              const stockMsg = stock > 0 ? `✅ Disponible (${stock} unidades)` : '❌ Agotado';
              
              logger.success(`✅ Producto encontrado y respondiendo: ${producto.nombre} - S/ ${precio}`);
              
              return `💰 *${producto.nombre}*\n\n` +
                `Precio: *S/ ${precio}*\n` +
                `Stock: ${stockMsg}\n\n` +
                `💬 ¿Te interesa? Puedes pedirlo escribiendo el nombre o enviando una nota de voz.`;
            } else {
              logger.warn(`⚠️ No se encontró producto: "${productInfo.producto}"`);
              
              // Intentar búsqueda con términos más amplios
              const searchTerms = [
                productInfo.marca ? productInfo.marca : null,
                productInfo.tipo ? productInfo.tipo : null,
                productInfo.producto.split(' ').slice(-2).join(' ') // Últimas 2 palabras
              ].filter(Boolean);
              
              for (const term of searchTerms) {
                if (term.length < 2) continue;
                logger.info(`Buscando con término alternativo: "${term}"`);
                
                let productos = null;
                if (kardexDb.isConnected()) {
                  productos = await kardexDb.buscarProductos(term, 3);
                }
                if (!productos || productos.length === 0) {
                  productos = await kardexApi.buscarProductos(term);
                }
                
                if (productos && productos.length > 0) {
                  const producto = productos[0];
                  const precio = typeof producto.precio_venta === 'number' 
                    ? producto.precio_venta.toFixed(2) 
                    : parseFloat(producto.precio_venta || 0).toFixed(2);
                  
                  const stock = producto.stock_actual || 0;
                  const stockMsg = stock > 0 ? `✅ Disponible (${stock} unidades)` : '❌ Agotado';
                  
                  return `💰 *${producto.nombre}*\n\n` +
                    `Precio: *S/ ${precio}*\n` +
                    `Stock: ${stockMsg}\n\n` +
                    `💬 ¿Te interesa? Puedes pedirlo escribiendo el nombre o enviando una nota de voz.`;
                }
              }
              
              return `😅 No encontré "${productInfo.producto}" en nuestro catálogo.\n\n` +
                `💡 Puedo ayudarte a buscar productos similares. Escribe *CATALOGO* para ver todos nuestros productos.`;
            }
          } else {
            logger.warn(`⚠️ IA no pudo extraer producto del mensaje: "${userMessage}"`);
          }
        } catch (searchError) {
          logger.error('Error al buscar producto con IA', searchError);
        }
      }
      
      // Si no es consulta de producto, usar Ollama para respuesta conversacional
      const isAvailable = await ollamaClient.isAvailable();
      if (!isAvailable) {
        logger.warn('Ollama no disponible, usando respuesta básica');
        return this._generateBasicResponse(userMessage, detectedIntent);
      }

      // Construir contexto de la conversación
      const contextMessages = this._buildConversationContext(conversationHistory, sessionState);
      
      // Construir prompt analítico con contexto
      const userContext = this._buildUserContext(sessionState);
      const prompt = `Analiza este mensaje de forma individual. Este cliente es único y se comunica de forma específica.

CONTEXTO DEL CLIENTE:
${userContext}

HISTORIAL DE ESTA CONVERSACIÓN:
${contextMessages}

MENSAJE ACTUAL DE ESTE CLIENTE:
"${userMessage}"

${detectedIntent ? `Intención detectada: ${detectedIntent}\n\n` : ''}

ANÁLISIS REQUERIDO (piensa paso a paso):
1. ¿Qué está diciendo este cliente específicamente? (no asumas, analiza)
2. ¿Cómo se está comunicando? (formal, informal, urgente, relajado, etc.)
3. ¿Qué necesita este cliente en este momento exacto?
4. ¿Cuál es el contexto de esta conversación específica?
5. ¿Cómo puedo ayudarlo de forma útil y personalizada?

IMPORTANTE:
- Este cliente es diferente a otros, analiza su mensaje de forma única
- No uses respuestas genéricas
- Responde específicamente a lo que este cliente necesita ahora
- Piensa antes de responder, no memorices

Responde basándote en tu análisis individual de este cliente:`;

      logger.info('Generando respuesta conversacional con IA', {
        messageLength: userMessage.length,
        hasHistory: conversationHistory.length > 0,
        intent: detectedIntent
      });

      // Generar respuesta con Ollama - temperatura más alta para análisis creativo
      const response = await ollamaClient.generate(prompt, this.systemPrompt, {
        temperature: 0.8, // Más alta para análisis creativo, no memorización
        top_p: 0.95, // Mayor diversidad en respuestas
        top_k: 50 // Más opciones para elegir
      });

      if (response && response.trim().length > 0) {
        logger.success('Respuesta generada por IA', { 
          responseLength: response.length,
          preview: response.substring(0, 50) + '...'
        });
        return response.trim();
      }

      // Fallback a respuesta básica
      return this._generateBasicResponse(userMessage, detectedIntent);

    } catch (error) {
      logger.error('Error al generar respuesta conversacional', error);
      return this._generateBasicResponse(userMessage, detectedIntent);
    }
  }
  
  /**
   * Extraer nombre del producto del mensaje
   */
  _extractProductName(text) {
    if (!text || text.trim().length === 0) return null;
    
    // Normalizar texto pero mantener estructura
    const original = text.trim();
    const normalized = original.toLowerCase();
    
    logger.info(`Extrayendo producto de: "${original}"`);
    
    // Patrones mejorados para extraer producto después de palabras clave
    const patterns = [
      // "¿Cuánto está una pelota adidas?" -> "pelota adidas"
      /(?:cuánto|cuanto|precio|vale|cuesta|a cuánto|a cuanto|cuánto sale|cuanto sale|cuánto vale|cuanto vale|precio de|cuál es el precio|cual es el precio|cuánto está|cuanto esta|cuánto esta|cuanto está)\s+(?:de|del|la|el)?\s*(?:un|una|unos|unas)?\s*([a-záéíóúñ0-9\s]+?)(?:\?|$)/i,
      // "¿Tienes pelota adidas?" -> "pelota adidas"
      /(?:tienes|hay|disponible|stock|tienen|queda)\s+(?:de|del|la|el)?\s*(?:un|una|unos|unas)?\s*([a-záéíóúñ0-9\s]+?)(?:\?|$)/i,
      // "una pelota adidas" -> "pelota adidas"
      /(?:un|una|unos|unas|el|la|los|las)\s+([a-záéíóúñ0-9\s]{3,}?)(?:\?|$)/i
    ];
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match && match[1]) {
        let productName = match[1].trim()
          .replace(/\b(estaba|está|es|ser|fue|están|son|pregunta|una pregunta)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Remover palabras vacías al inicio
        productName = productName.replace(/^(de|del|la|el|un|una|unos|unas)\s+/i, '').trim();
        
        if (productName.length >= 3) {
          logger.info(`✅ Producto extraído (patrón): "${productName}"`);
          return productName;
        }
      }
    }
    
    // Fallback mejorado: buscar después de palabras clave y antes del signo de interrogación
    const fallbackPattern = /(?:cuánto|cuanto|precio|vale|cuesta|está|esta|es)\s+(?:de|del|la|el)?\s*(?:un|una)?\s*([^?]+)/i;
    const fallbackMatch = normalized.match(fallbackPattern);
    if (fallbackMatch && fallbackMatch[1]) {
      let productName = fallbackMatch[1].trim()
        .replace(/\b(estaba|está|es|ser|fue|están|son|pregunta|una pregunta|hola|por favor)\b/gi, '')
        .replace(/[¿?¡!.,;:"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (productName.length >= 3) {
        logger.info(`✅ Producto extraído (fallback pattern): "${productName}"`);
        return productName;
      }
    }
    
    // Último fallback: remover palabras comunes y tomar lo restante
    const cleaned = normalized
      .replace(/(?:cuánto|cuanto|precio|vale|cuesta|a cuánto|a cuanto|cuánto sale|cuanto sale|cuánto vale|cuanto vale|precio de|cuál es el precio|cual es el precio|tienes|hay|disponible|stock|tienen|queda|un|una|el|la|los|las|estaba|está|es|ser|fue|están|son|pregunta|una pregunta|hola|por favor)/gi, '')
      .replace(/[¿?¡!.,;:"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Tomar todas las palabras significativas (no solo las últimas 3)
    const words = cleaned.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
      const productName = words.join(' '); // Tomar todas las palabras significativas
      logger.info(`✅ Producto extraído (último fallback): "${productName}"`);
      return productName;
    }
    
    logger.warn(`⚠️ No se pudo extraer nombre de producto de: "${text}"`);
    return null;
  }

  /**
   * Construir contexto del usuario
   */
  _buildUserContext(sessionState) {
    let context = '';
    
    if (sessionState.cliente && sessionState.cliente.nombre) {
      context += `Cliente: ${sessionState.cliente.nombre}\n`;
    }
    
    if (sessionState.authenticated) {
      context += 'Estado: Cliente autenticado\n';
    } else {
      context += 'Estado: Cliente no autenticado\n';
    }

    if (sessionState.state) {
      context += `Estado de sesión: ${sessionState.state}\n`;
    }

    return context;
  }

  /**
   * Construir contexto de la conversación
   */
  _buildConversationContext(conversationHistory, sessionState) {
    if (!conversationHistory || conversationHistory.length === 0) {
      return '';
    }

    // Tomar últimos 5 mensajes para contexto
    const recentHistory = conversationHistory.slice(-5);
    let context = 'Historial reciente:\n';
    
    for (const msg of recentHistory) {
      if (msg.type === 'user') {
        context += `Usuario: ${msg.content}\n`;
      } else if (msg.type === 'bot') {
        context += `Bot: ${msg.content}\n`;
      }
    }

    return context;
  }

  /**
   * Generar respuesta básica cuando la IA no está disponible
   */
  _generateBasicResponse(userMessage, detectedIntent) {
    const message = userMessage.toLowerCase().trim();
    
    // Saludos
    if (message.match(/^(hola|hi|hello|buenos días|buen dia|buenas tardes|buenas noches)/)) {
      return '¡Hola! 😊 ¿En qué puedo ayudarte hoy?';
    }

    // Preguntas sobre cómo está
    if (message.match(/(cómo estás|como estas|como estas|qué tal|que tal)/)) {
      return '¡Muy bien, gracias por preguntar! 😊 ¿En qué puedo ayudarte?';
    }

    // Necesita ayuda
    if (message.match(/(necesito ayuda|ayuda|help|qué puedo hacer|que puedo hacer)/)) {
      return '¡Por supuesto! Puedo ayudarte con:\n\n' +
        '🛍️ Ver productos\n' +
        '💰 Consultar precios\n' +
        '🛒 Hacer pedidos\n' +
        '📊 Ver estado de pedidos\n\n' +
        '¿Qué te gustaría hacer?';
    }

    // Respuesta genérica amigable
    return 'Entiendo. ¿En qué puedo ayudarte? Puedo mostrarte productos, ayudarte con pedidos o responder tus consultas. 😊';
  }

  /**
   * Generar respuesta contextual para intenciones específicas
   */
  async generateContextualResponse(intent, userMessage, sessionState, conversationHistory) {
    try {
      const isAvailable = await ollamaClient.isAvailable();
      if (!isAvailable) {
        return null; // Dejar que el bot básico maneje
      }

      let contextPrompt = '';
      
      switch (intent) {
        case 'SALUDO':
          contextPrompt = `El usuario te saludó: "${userMessage}". Responde de forma amigable y natural, y ofrécete a ayudar.`;
          break;
        case 'AYUDA':
          contextPrompt = `El usuario pidió ayuda: "${userMessage}". Explica de forma amigable qué puedes hacer, sin ser muy extenso.`;
          break;
        case 'VER_CATALOGO':
          contextPrompt = `El usuario quiere ver productos: "${userMessage}". Responde de forma entusiasta y ofrécete a mostrar el catálogo.`;
          break;
        default:
          return null; // Dejar que el bot básico maneje
      }

      const response = await ollamaClient.generate(contextPrompt, this.systemPrompt, {
        temperature: 0.7,
        max_tokens: 150
      });

      return response ? response.trim() : null;

    } catch (error) {
      logger.error('Error al generar respuesta contextual', error);
      return null;
    }
  }
}

module.exports = new ConversationalAI();

