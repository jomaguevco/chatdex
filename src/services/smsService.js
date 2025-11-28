const logger = require('../utils/logger');
const config = require('../../config/config');

/**
 * Servicio para envío de SMS
 * Actualmente usa logging para desarrollo
 * En producción se puede integrar con Twilio, AWS SNS, u otro servicio SMS
 */
class SMSService {
  constructor() {
    this.enabled = process.env.SMS_ENABLED === 'true';
    // Si tienes Twilio configurado, puedes usar:
    // this.twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
    logger.info('SMS Service inicializado', { enabled: this.enabled });
  }

  /**
   * Generar código de verificación aleatorio (6 dígitos)
   */
  generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Enviar código de verificación por SMS
   * @param {string} phoneNumber - Número de teléfono (con código de país)
   * @param {string} code - Código de verificación
   * @returns {Promise<boolean>}
   */
  async sendVerificationCode(phoneNumber, code, whatsappHandler = null, jidToUse = null) {
    try {
      const message = `Tu código de verificación KARDEX es: ${code}\n\nEste código expira en 10 minutos. No lo compartas con nadie.`;

      if (this.enabled && process.env.TWILIO_SID) {
        // Integración con Twilio
        return await this.sendWithTwilio(phoneNumber, message);
      } else {
        // Modo desarrollo: enviar por WhatsApp como fallback
        logger.info('📱 SMS (Simulado - Enviando por WhatsApp)', {
          to: phoneNumber,
          code: code
        });
        
        // En desarrollo, enviar el código por WhatsApp directamente
        if (whatsappHandler && jidToUse) {
          try {
            await whatsappHandler.sendMessage(jidToUse,
              `🔐 *Código de Verificación KARDEX*\n\n` +
              `Tu código es: *${code}*\n\n` +
              `⏰ Este código expira en 10 minutos.\n` +
              `🔒 No lo compartas con nadie.`
            );
            logger.success(`✅ Código enviado por WhatsApp: ${code}`);
            return true;
          } catch (whatsappError) {
            logger.error('Error al enviar código por WhatsApp', whatsappError);
            // Continuar y retornar true de todas formas para que el flujo continúe
            return true;
          }
        }
        
        // Si no hay whatsappHandler, solo loguear
        logger.warn('⚠️ WhatsApp handler no disponible, código generado pero no enviado:', code);
        return true; // Retornar true para que el flujo continúe
      }
    } catch (error) {
      logger.error('Error al enviar SMS de verificación', error);
      return false;
    }
  }

  /**
   * Enviar SMS usando Twilio (si está configurado)
   */
  async sendWithTwilio(phoneNumber, message) {
    try {
      // Formatear número para Twilio (debe incluir código de país)
      let formattedNumber = phoneNumber;
      if (!formattedNumber.startsWith('+')) {
        formattedNumber = '+' + formattedNumber;
      }

      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

      const result = await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedNumber
      });

      logger.success(`✅ SMS enviado vía Twilio: ${result.sid}`);
      return true;
    } catch (error) {
      logger.error('Error al enviar SMS con Twilio', error);
      return false;
    }
  }

  /**
   * Validar formato de número de teléfono para SMS
   */
  validatePhoneNumber(phoneNumber) {
    // Debe ser un número válido con código de país
    const cleaned = phoneNumber.replace(/[^0-9+]/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  }
}

module.exports = new SMSService();

