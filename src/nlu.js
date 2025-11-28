const logger = require('./utils/logger');
const unifiedAIProcessor = require('./core/ai/unifiedAIProcessor');
const textCorrector = require('./utils/textCorrector');
const conversationalAI = require('./conversationalAI');

class NLU {
  constructor() {
    logger.info('NLU inicializado - usando sistema unificado de IA');
  }

  /**
   * Procesar mensaje del usuario
   * @param {string} text - Texto del mensaje
   * @param {object} sessionState - Estado de la sesión
   * @param {array} conversationHistory - Historial de conversación
   * @param {boolean} isFromVoice - Si el mensaje viene de transcripción de voz
   */
  async processMessage(text, sessionState = {}, conversationHistory = [], isFromVoice = false) {
    const startTime = Date.now();
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('🧠 [NLU] Iniciando procesamiento de mensaje');
    logger.info(`🧠 [NLU] Texto: "${(text || '').substring(0, 100)}"`);
    logger.info(`🧠 [NLU] Estado: ${sessionState.state || 'idle'}`);
    logger.info(`🧠 [NLU] Es voz: ${isFromVoice}`);
    logger.info(`🧠 [NLU] Historial: ${conversationHistory.length} mensajes`);
    
    try {
      const originalInput = text;
      
      // Normalizar/corregir siempre (mejora comprensión de voz y texto)
      text = textCorrector.correctText(text);
      
      logger.info(`🧠 [NLU] Texto corregido: "${(text || '').substring(0, 100)}"`);

      // Procesar TODO con UnifiedAIProcessor con timeout
      logger.info(`🧠 [NLU] Llamando a unifiedAIProcessor...`);
      const processorPromise = unifiedAIProcessor.process(text, {
        sessionState,
        conversationHistory,
        isFromVoice
      });
      
      // Timeout de 25 segundos para el procesador
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('UnifiedAIProcessor timeout después de 25 segundos')), 25000)
      );
      
      const result = await Promise.race([processorPromise, timeoutPromise]);
      logger.info(`🧠 [NLU] unifiedAIProcessor completado en ${Date.now() - startTime}ms`);

      // Convertir resultado a formato esperado por el resto del sistema
      // Formato compatible con basicBot y orderHandler
      let response = {
        intent: result.intent,
        originalText: originalInput,
        sessionState,
        response: {
          action: result.action,
          message: result.message,
          data: result.data,
          productos: null,
          buttons: result.buttons
        }
      };

      // Si hay data con productos (pedidos), formatearlos correctamente
      if (result.data) {
        if (Array.isArray(result.data)) {
          // Es un array de productos (catálogo, búsqueda)
          response.response.productos = result.data;
        } else if (result.data.productos) {
          // Tiene estructura de pedido con productos
          response.response.productos = result.data.productos;
          response.response.total = result.data.total;
          response.response.productosNoEncontrados = result.data.productosNoEncontrados;
          response.response.productosSinStock = result.data.productosSinStock;
        } else if (result.action === 'add_products_to_order' && result.data) {
          // Es resultado de aiProcessor para pedidos
          response.response.productos = result.data.productos;
          response.response.total = result.data.total;
          response.response.productosNoEncontrados = result.data.productosNoEncontrados;
          response.response.productosSinStock = result.data.productosSinStock;
          response.response.direccion = result.data.direccion;
          response.response.fecha = result.data.fecha;
          response.response.hora = result.data.hora;
          response.response.metodoPago = result.data.metodoPago;
          }
        }

      // Si hay acción pero no mensaje, el mensaje se generará en el handler
      if (result.action && !result.message) {
        // Acciones que generan mensajes automáticamente (view_order, etc.)
        response.response.message = null;
      }

      const processingTime = Date.now() - startTime;
      logger.info(`🧠 [NLU] Procesamiento NLU completo en ${processingTime}ms`, {
        intent: response.intent,
        hasAction: !!result.action,
        hasMessage: !!result.message,
        action: result.action
      });
      logger.info('═══════════════════════════════════════════════════════════');

      return response;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('═══════════════════════════════════════════════════════════');
      logger.error('❌ [NLU] ERROR al procesar mensaje');
      logger.error(`❌ [NLU] Error: ${error.message}`);
      logger.error(`❌ [NLU] Stack: ${error.stack?.substring(0, 500)}`);
      logger.error(`❌ [NLU] Tiempo transcurrido: ${processingTime}ms`);
      logger.error(`❌ [NLU] Texto original: "${(text || '').substring(0, 100)}"`);
      logger.error('═══════════════════════════════════════════════════════════');
      
      // SIEMPRE devolver una respuesta válida, incluso en caso de error
      return {
        intent: 'error',
        originalText: text || '',
        sessionState,
        response: {
          message: '😅 Lo siento, hubo un error al procesar tu mensaje.\n\n' +
            '💡 Por favor intenta:\n' +
            '• Reformular tu mensaje\n' +
            '• Escribir *AYUDA* para ver opciones\n' +
            '• Intentar de nuevo en unos momentos\n\n' +
            '🔄 Si el problema persiste, escribe *HOLA* para comenzar de nuevo.'
        }
      };
    }
  }
}

module.exports = new NLU();
