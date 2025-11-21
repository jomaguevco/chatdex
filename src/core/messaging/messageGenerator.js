const logger = require('../../utils/logger');
const productRecommender = require('../salesFlow/productRecommender');

/**
 * Generador de mensajes profesionales
 * 
 * Genera mensajes como un vendedor real:
 * - Recomendar productos adecuados
 * - Detectar dudas y aclarar información técnica
 * - Guiar suavemente sin presionar
 * - Confirmar pasos críticos antes de avanzar
 * 
 * @module core/messaging/messageGenerator
 */

class MessageGenerator {
  constructor() {
    this.tone = 'friendly'; // friendly, professional, casual
  }

  /**
   * Generar mensaje de recomendación de productos
   * 
   * @param {array} productos - Productos a recomendar
   * @param {object} context - Contexto {cliente, query, reason}
   * @returns {string} Mensaje de recomendación
   */
  generateProductRecommendation(productos = [], context = {}) {
    try {
      if (!productos || productos.length === 0) {
        return 'No encontré productos para recomendarte en este momento. ¿Puedes ser más específico?';
      }

      let message = `💡 *Te recomiendo estos productos:*\n\n`;
      
      productos.forEach((p, idx) => {
        message += `${idx + 1}. *${p.nombre}*\n`;
        message += `   💰 Precio: S/. ${parseFloat(p.precio_venta || 0).toFixed(2)}\n`;
        
        if (p.stock_actual !== undefined) {
          if (p.stock_actual > 0) {
            message += `   📊 Stock: ${p.stock_actual} unidades disponibles\n`;
          } else {
            message += `   ⚠️ Sin stock en este momento\n`;
          }
        }
        
        if (p.descripcion) {
          message += `   📝 ${p.descripcion.substring(0, 100)}${p.descripcion.length > 100 ? '...' : ''}\n`;
        }
        
        message += `\n`;
      });

      message += `💬 Responde con el número o el nombre del producto para agregarlo a tu pedido.`;
      message += `\n\n💡 Si necesitas más información sobre algún producto, solo pregunta. 😊`;

      return message;
    } catch (error) {
      logger.error('Error en generateProductRecommendation:', error);
      return 'Hubo un error al generar las recomendaciones. Por favor, intenta de nuevo.';
    }
  }

  /**
   * Generar mensaje para aclarar dudas
   * 
   * @param {string} doubtType - Tipo de duda
   * @param {object} context - Contexto {producto, cliente}
   * @returns {string} Mensaje aclaratorio
   */
  generateDoubtClarification(doubtType, context = {}) {
    try {
      let message = '';

      switch (doubtType) {
        case 'comparison':
          message = `💬 *Comparación de productos*\n\n`;
          message += `Puedo ayudarte a comparar productos según:\n`;
          message += `• Precio\n`;
          message += `• Características técnicas\n`;
          message += `• Disponibilidad\n`;
          message += `• Opiniones de clientes\n\n`;
          message += `¿Qué características son más importantes para ti?`;
          break;

        case 'price':
          message = `💰 *Información de precios*\n\n`;
          if (context.producto) {
            message += `*${context.producto.nombre}*\n`;
            message += `Precio: S/. ${parseFloat(context.producto.precio_venta || 0).toFixed(2)}\n`;
            
            if (context.producto.promocion) {
              message += `🎉 *Promoción disponible*\n`;
              message += `${context.producto.promocion.descripcion}\n`;
            }
          } else {
            message += `¿Sobre qué producto quieres saber el precio?`;
          }
          break;

        case 'stock':
          message = `📊 *Disponibilidad*\n\n`;
          if (context.producto) {
            const stock = context.producto.stock_actual || 0;
            if (stock > 0) {
              message += `✅ *${context.producto.nombre}* está disponible.\n`;
              message += `Stock: ${stock} unidades\n`;
            } else {
              message += `❌ *${context.producto.nombre}* no tiene stock en este momento.\n\n`;
              message += `💡 Te puedo mostrar productos similares disponibles. ¿Te interesa?`;
            }
          } else {
            message += `¿Sobre qué producto quieres saber la disponibilidad?`;
          }
          break;

        case 'features':
          message = `📝 *Características del producto*\n\n`;
          if (context.producto) {
            message += `*${context.producto.nombre}*\n\n`;
            if (context.producto.descripcion) {
              message += `${context.producto.descripcion}\n\n`;
            }
            message += `💬 ¿Hay algo específico que te gustaría saber sobre este producto?`;
          } else {
            message += `¿Sobre qué producto quieres saber las características?`;
          }
          break;

        default:
          message = `💬 Puedo ayudarte con información sobre productos, precios, disponibilidad y características.\n\n`;
          message += `¿Qué necesitas saber?`;
      }

      return message;
    } catch (error) {
      logger.error('Error en generateDoubtClarification:', error);
      return 'Puedo ayudarte con información sobre nuestros productos. ¿Qué necesitas saber?';
    }
  }

  /**
   * Generar mensaje de confirmación antes de avanzar
   * 
   * @param {string} step - Paso a confirmar
   * @param {object} data - Datos a confirmar
   * @returns {string} Mensaje de confirmación
   */
  generateConfirmation(step, data = {}) {
    try {
      let message = '';

      switch (step) {
        case 'order':
          message = `✅ *Resumen de tu pedido:*\n\n`;
          
          if (data.productos && data.productos.length > 0) {
            data.productos.forEach((p, idx) => {
              message += `${idx + 1}. *${p.nombre}*\n`;
              message += `   ${p.cantidad} x S/. ${parseFloat(p.precio_final || p.precio_unitario || 0).toFixed(2)} = S/. ${parseFloat(p.subtotal || 0).toFixed(2)}\n`;
              
              if (p.promocion) {
                message += `   🎉 ${p.promocion.nombre}\n`;
              }
              
              message += `\n`;
            });
          }

          if (data.total) {
            message += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            message += `💰 *Total: S/. ${parseFloat(data.total).toFixed(2)}*\n\n`;
          }

          message += `💬 ¿Confirmas este pedido? (Responde "SÍ" o "NO")`;
          break;

        case 'payment':
          message = `💳 *Método de pago seleccionado:* ${data.metodo_pago || 'No especificado'}\n\n`;
          message += `💬 ¿Confirmas este método de pago? (Responde "SÍ" o "NO")`;
          break;

        default:
          message = `💬 ¿Confirmas esta acción? (Responde "SÍ" o "NO")`;
      }

      return message;
    } catch (error) {
      logger.error('Error en generateConfirmation:', error);
      return '¿Confirmas esta acción? (Responde "SÍ" o "NO")';
    }
  }

  /**
   * Generar mensaje de guía suave
   * 
   * @param {string} situation - Situación
   * @param {object} context - Contexto
   * @returns {string} Mensaje de guía
   */
  generateGuidance(situation, context = {}) {
    try {
      let message = '';

      switch (situation) {
        case 'stuck':
          message = `💡 Parece que no estás seguro de qué hacer.\n\n`;
          message += `Puedo ayudarte con:\n`;
          message += `• Ver productos disponibles (escribe "CATALOGO")\n`;
          message += `• Hacer un pedido (describe lo que necesitas)\n`;
          message += `• Consultar precios o disponibilidad\n`;
          message += `• Ver ayuda (escribe "AYUDA")\n\n`;
          message += `¿Qué te gustaría hacer?`;
          break;

        case 'empty_order':
          message = `📦 Tu pedido está vacío.\n\n`;
          message += `💡 Para agregar productos, puedes:\n`;
          message += `• Escribir el nombre del producto\n`;
          message += `• Enviar una nota de voz\n`;
          message += `• Escribir "CATALOGO" para ver productos disponibles\n\n`;
          message += `¿Qué te gustaría hacer?`;
          break;

        default:
          message = `💡 ¿Necesitas ayuda? Puedo guiarte en cada paso. Escribe "AYUDA" para ver las opciones disponibles.`;
      }

      return message;
    } catch (error) {
      logger.error('Error en generateGuidance:', error);
      return '¿Necesitas ayuda? Escribe "AYUDA" para ver las opciones disponibles.';
    }
  }
}

module.exports = new MessageGenerator();
