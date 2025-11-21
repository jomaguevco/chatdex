const logger = require('./utils/logger');
const basicBot = require('./basicBot');
const aiProcessor = require('./aiProcessor');
const textCorrector = require('./utils/textCorrector');

class NLU {
  constructor() {
    logger.info('NLU inicializado - usando sistema híbrido (bot básico + IA local)');
  }

  /**
   * Procesar mensaje del usuario
   * @param {string} text - Texto del mensaje
   * @param {object} sessionState - Estado de la sesión
   * @param {array} conversationHistory - Historial de conversación
   * @param {boolean} isFromVoice - Si el mensaje viene de transcripción de voz
   */
  async processMessage(text, sessionState = {}, conversationHistory = [], isFromVoice = false) {
    try {
      const originalInput = text;
      // Normalizar/corregir siempre (mejora comprensión de voz y texto)
      text = textCorrector.correctText(text);
      logger.info('Procesando mensaje NLU', { 
        text: (text || '').substring(0, 100), 
        sessionState, 
        isFromVoice,
        historyLength: conversationHistory.length 
      });

      // Ruta rápida: comandos simples (catálogo, ayuda, estado, yape/plin) siempre con bot básico
      const quick = (t) => {
        const s = (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        if (!s) return null;
        const simpleCommands = [
          'catalogo','catálogo','productos','producto','lista','ver productos',
          'ayuda','help','comandos',
          'estado','status','mi pedido','pedido','orden',
          'yape','pago yape','pagar con yape',
          'plin','pago plin','pagar con plin'
        ];
        for (const c of simpleCommands) {
          if (s === c || s.includes(c)) return true;
        }
        return false;
      };
      if (!isFromVoice && quick(text)) {
        const basicResult = await basicBot.processMessage(text, sessionState);
        return {
          intent: basicResult.intent || 'basic',
          originalText: originalInput,
          sessionState,
          response: basicResult
        };
      }

      // Si es mensaje de voz, primero verificar comandos simples conocidos
      if (isFromVoice) {
        // Expandir lista de comandos simples para voz (incluir variaciones coloquiales)
        const simpleVoiceCommands = [
          'salir', 'salirme', 'cancelar', 'cancel', 'volver', 'inicio', 'empezar de nuevo', 
          'ayuda', 'help', 'catálogo', 'catalogo', 'productos', 'hola', 'hi', 'hello', 
          'no', 'no quiero', 'mejor no', 'déjalo', 'dejalo', 'olvídalo', 'olvidalo',
          'quiero ver', 'muéstrame', 'mostrar', 'ver productos', 'ver catálogo',
          'cuánto cuesta', 'cuanto cuesta', 'precio', 'tienes', 'hay', 'disponible',
          'mi pedido', 'ver pedido', 'estado', 'mis pedidos', 'historial',
          'confirmo', 'confirmar', 'si', 'sí', 'ok', 'okay', 'acepto',
          'yape', 'plin', 'pago', 'pagar', 'pagado', 'ya pagué', 'ya pague'
        ];
        const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const isSimpleCommand = simpleVoiceCommands.some(cmd => textLower.includes(cmd));
        
        if (isSimpleCommand) {
          // Es un comando simple, usar bot básico directamente
          logger.info('Mensaje de voz con comando simple detectado, usando bot básico');
          const basicResult = await basicBot.processMessage(text, sessionState);
          return {
            intent: basicResult.intent || 'unknown',
            originalText: originalInput,
            sessionState,
            response: basicResult
          };
        }
        
        // Si no es comando simple, procesar con IA para entender mejor
        logger.info('Mensaje de voz procesado con IA para comprensión conversacional');
        
        try {
          // Usar IA para entender la intención general
          const aiResult = await aiProcessor.processOrder(text, conversationHistory);
          
          if (aiResult.success && aiResult.action === 'add_products_to_order') {
            // Es un pedido válido
            return {
              intent: 'order',
              originalText: originalInput,
              sessionState,
              response: aiResult
            };
          } else if (aiResult.intent) {
            // La IA detectó una intención específica (no pedido)
            logger.info(`IA detectó intención: ${aiResult.intent}`);
            
            // Si es cancelar o salir, manejarlo como cancelación
            if (aiResult.intent === 'CANCELAR' || aiResult.intent === 'SALIR' || aiResult.intent === 'VOLVER') {
              return {
                intent: 'cancel',
                originalText: originalInput,
                sessionState,
                response: { action: 'cancel_order', message: 'Entendido, operación cancelada.' }
              };
            }
            
            // Para otras intenciones, usar bot básico
            const basicResult = await basicBot.processMessage(text, sessionState);
            return {
              intent: basicResult.intent || aiResult.intent.toLowerCase(),
              originalText: originalInput,
              sessionState,
              response: basicResult
            };
          } else {
            // La IA no pudo determinar claramente, intentar con bot básico
            logger.info('IA no pudo determinar intención clara, usando bot básico como fallback');
            const basicResult = await basicBot.processMessage(text, sessionState);
            return {
              intent: basicResult.intent || 'unknown',
              originalText: originalInput,
              sessionState,
              response: basicResult
            };
          }
        } catch (aiError) {
          logger.warn('Error al procesar con IA, usando bot básico como fallback', aiError);
          // Si la IA falla, usar bot básico como fallback
          const basicResult = await basicBot.processMessage(text, sessionState);
          return {
            intent: basicResult.intent || 'unknown',
            originalText: originalInput,
            sessionState,
            response: basicResult
          };
        }
      } else {
        // Mensaje de texto: verificar si tiene intención de pedido
        // Primero verificar si es un comando simple que no necesita IA
        const textLowerForCommand = text.toLowerCase().trim();
        const quickCommands = ['si', 'sí', 'ok', 'okey', 'okay', 'confirmo', 'confirmar', 'acepto', 
          'ya pagué', 'ya pague', 'pagué', 'pague', 'pagado', 'listo', 'de acuerdo'];
        
        const isQuickCommand = quickCommands.some(cmd => textLowerForCommand === cmd || textLowerForCommand.includes(cmd));
        
        if (isQuickCommand) {
          logger.info('Comando rápido detectado en texto, usando bot básico');
          const basicResult = await basicBot.processMessage(text, sessionState);
          return {
            intent: basicResult.intent || 'unknown',
            originalText: originalInput,
            sessionState,
            response: basicResult
          };
        }
        
        const hasOrderIntent = basicBot.containsOrderIntent(text);
        
        if (hasOrderIntent) {
          logger.info('Mensaje de texto con intención de pedido detectada, usando IA');
          
          // Usar IA para procesar el pedido desde texto también
          const aiResult = await aiProcessor.processOrder(text, conversationHistory);
          
          if (aiResult.success) {
            return {
              intent: 'order',
              originalText: originalInput,
              sessionState,
              response: aiResult
            };
          } else if (aiResult.intent) {
            // Si la IA detectó otra intención, usar bot básico
            logger.info(`IA detectó intención: ${aiResult.intent}, usando bot básico`);
            const basicResult = await basicBot.processMessage(text, sessionState);
            return {
              intent: basicResult.intent || aiResult.intent,
              originalText: originalInput,
              sessionState,
              response: basicResult
            };
          } else {
            // Si la IA falla, usar bot básico como fallback
            logger.warn('IA falló al procesar pedido de texto, usando bot básico');
            const basicResult = await basicBot.processMessage(text, sessionState);
            
            return {
              intent: basicResult.intent || 'unknown',
              originalText: originalInput,
              sessionState,
              response: basicResult
            };
          }
        } else {
          // Mensaje de texto sin intención de pedido, usar bot básico
          logger.info('Mensaje de texto sin intención de pedido, usando bot básico');
          const basicResult = await basicBot.processMessage(text, sessionState);
          
          // Si el bot básico no entendió, intentar con IA para entender mejor
          if ((!basicResult || !basicResult.message || basicResult.intent === 'unknown') && !isFromVoice) {
            logger.info('Bot básico no entendió, intentando con IA para mejor comprensión...');
            try {
              const aiResult = await aiProcessor.processOrder(text, conversationHistory);
              
              // Si la IA detectó una intención, usar esa
              if (aiResult.intent && aiResult.intent !== 'OTRO') {
                logger.info(`IA detectó intención: ${aiResult.intent}`);
                const basicResultFromAI = await basicBot.processMessage(text, sessionState);
                return {
                  intent: basicResultFromAI.intent || aiResult.intent.toLowerCase(),
                  originalText: originalInput,
                  sessionState,
                  response: basicResultFromAI
                };
              }
            } catch (aiError) {
              logger.warn('Error al procesar con IA como fallback', aiError);
            }
          }
          
          return {
            intent: basicResult.intent || 'unknown',
            originalText: originalInput,
            sessionState,
            response: basicResult
          };
        }
      }
    } catch (error) {
      logger.error('Error en NLU', error);
      // En lugar de error genérico, dar respuesta útil
      return {
        intent: 'help',
        originalText: originalInput,
        sessionState,
        response: {
          message: '👋 *¡Hola!* 👋\n\n' +
            '📋 *¿En qué puedo ayudarte?*\n\n' +
            '🛍️ *Ver productos:* Escribe *CATALOGO*\n' +
            '🛒 *Hacer pedido:* Escribe lo que necesitas\n' +
            '💰 *Consultar precio:* "¿Cuánto cuesta X?"\n' +
            '📊 *Ver pedido:* Escribe *ESTADO*\n' +
            '❓ *Ayuda:* Escribe *AYUDA*\n\n' +
            '💡 También puedes enviarme una nota de voz.'
        }
      };
    }
  }
}

module.exports = new NLU();
