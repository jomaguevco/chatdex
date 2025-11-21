const QRCode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class YapeQRGenerator {
  /**
   * Generar QR de Yape para pago
   * @param {string} phoneNumber - Número de teléfono de Yape
   * @param {number} amount - Monto a pagar
   * @param {string} message - Mensaje opcional
   * @returns {Promise<string>} - Ruta del archivo QR generado
   */
  async generateYapeQR(phoneNumber, amount, message = '') {
    try {
      // Formato de URL de Yape: yape://payment?phone=51999999999&amount=100.00&message=Pedido
      const yapeUrl = `yape://payment?phone=${phoneNumber}&amount=${amount.toFixed(2)}${message ? `&message=${encodeURIComponent(message)}` : ''}`;
      
      logger.info(`Generando QR de Yape: ${phoneNumber} - S/. ${amount.toFixed(2)}`);
      
      // Crear directorio si no existe
      const qrDir = path.join(__dirname, '..', '..', 'qr');
      await fs.mkdir(qrDir, { recursive: true });
      
      // Generar nombre único para el QR
      const timestamp = Date.now();
      const qrFileName = `yape_${timestamp}.png`;
      const qrPath = path.join(qrDir, qrFileName);
      
      // Generar QR code
      await QRCode.toFile(qrPath, yapeUrl, {
        type: 'png',
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      logger.success(`✅ QR de Yape generado: ${qrPath}`);
      
      return qrPath;
    } catch (error) {
      logger.error('Error al generar QR de Yape', error);
      throw error;
    }
  }

  /**
   * Generar QR de Yape como base64 para enviar por WhatsApp
   * @param {string} phoneNumber - Número de teléfono de Yape
   * @param {number} amount - Monto a pagar
   * @param {string} message - Mensaje opcional
   * @returns {Promise<string>} - Base64 del QR
   */
  async generateYapeQRBase64(phoneNumber, amount, message = '') {
    try {
      const yapeUrl = `yape://payment?phone=${phoneNumber}&amount=${amount.toFixed(2)}${message ? `&message=${encodeURIComponent(message)}` : ''}`;
      
      const qrBase64 = await QRCode.toDataURL(yapeUrl, {
        type: 'png',
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      return qrBase64;
    } catch (error) {
      logger.error('Error al generar QR de Yape en base64', error);
      throw error;
    }
  }
}

module.exports = new YapeQRGenerator();


