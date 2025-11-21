const config = require('../../config/config');
const logger = require('./logger');

/**
 * Generar deep link para Yape
 * Formato: yape://pay?amount=XX&phone=YYY&concept=ZZZ
 */
function generateYapeLink(amount, phoneNumber, concept = '') {
  try {
    const yapePhone = config.payment.yape.number;
    const amountFormatted = parseFloat(amount).toFixed(2);
    
    // Deep link para Yape (formato estándar)
    // Nota: El formato exacto puede variar según la versión de Yape
    const deepLink = `yape://pay?amount=${amountFormatted}&phone=${yapePhone}&concept=${encodeURIComponent(concept)}`;
    
    // URL web como fallback (si Yape tiene web)
    const webLink = `https://yape.pe/pay?amount=${amountFormatted}&phone=${yapePhone}`;
    
    logger.debug('Deep link Yape generado', { amount, deepLink, webLink });
    
    return {
      deepLink,
      webLink,
      phone: yapePhone,
      amount: amountFormatted,
      concept
    };
  } catch (error) {
    logger.error('Error al generar link de Yape', error);
    return null;
  }
}

/**
 * Generar deep link para Plin
 * Formato: plin://pay?amount=XX&phone=YYY&concept=ZZZ
 */
function generatePlinLink(amount, phoneNumber, concept = '') {
  try {
    const plinPhone = config.payment.plin.number;
    const amountFormatted = parseFloat(amount).toFixed(2);
    
    // Deep link para Plin (formato estándar)
    const deepLink = `plin://pay?amount=${amountFormatted}&phone=${plinPhone}&concept=${encodeURIComponent(concept)}`;
    
    // URL web como fallback
    const webLink = `https://plin.pe/pay?amount=${amountFormatted}&phone=${plinPhone}`;
    
    logger.debug('Deep link Plin generado', { amount, deepLink, webLink });
    
    return {
      deepLink,
      webLink,
      phone: plinPhone,
      amount: amountFormatted,
      concept
    };
  } catch (error) {
    logger.error('Error al generar link de Plin', error);
    return null;
  }
}

module.exports = {
  generateYapeLink,
  generatePlinLink
};

