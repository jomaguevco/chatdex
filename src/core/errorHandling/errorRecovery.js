const logger = require('../../utils/logger');

/**
 * Sistema de recuperación de errores
 * 
 * Este módulo proporciona manejo robusto de errores con:
 * - Try-catch en puntos críticos
 * - Recuperación inteligente cuando hay errores
 * - Mensajes claros y útiles
 * - Nunca romper el flujo
 * 
 * @module core/errorHandling/errorRecovery
 */

class ErrorRecovery {
  constructor() {
    this.errorHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Ejecutar función con manejo de errores y recuperación
   * 
   * @param {Function} fn - Función a ejecutar
   * @param {object} context - Contexto {operation, phoneNumber, sessionState}
   * @param {Function} fallbackFn - Función de fallback (opcional)
   * @returns {Promise<any>} Resultado de la función o fallback
   */
  async executeWithRecovery(fn, context = {}, fallbackFn = null) {
    try {
      return await fn();
    } catch (error) {
      logger.error(`Error en ${context.operation || 'operación'}:`, error);
      
      // Registrar error en historial
      this._recordError(error, context);
      
      // Intentar recuperación inteligente
      const recoveryResult = await this._attemptRecovery(error, context);
      
      if (recoveryResult.recovered && recoveryResult.data) {
        logger.info(`✅ Error recuperado con éxito`);
        return recoveryResult.data;
      }

      // Si hay fallback, usarlo
      if (fallbackFn) {
        try {
          logger.info(`🔄 Intentando fallback...`);
          return await fallbackFn(error);
        } catch (fallbackError) {
          logger.error('Error en fallback:', fallbackError);
        }
      }

      // Retornar mensaje de error amigable
      return {
        success: false,
        error: this._generateFriendlyErrorMessage(error, context),
        recoveryAttempted: recoveryResult.recovered
      };
    }
  }

  /**
   * Intentar recuperación inteligente
   * 
   * @param {Error} error - Error capturado
   * @param {object} context - Contexto
   * @returns {Promise<object>} {recovered: boolean, data: any}
   */
  async _attemptRecovery(error, context = {}) {
    try {
      const errorMessage = error.message || error.toString();
      
      // Recuperación para errores de BD
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('pool')) {
        logger.warn('Error de conexión BD detectado, usando API como fallback');
        return { recovered: false, data: null, message: 'Error de conexión. Se intentará usar API.' };
      }

      // Recuperación para errores de timeout
      if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        logger.warn('Timeout detectado, sugerir reintento');
        return { 
          recovered: false, 
          data: null, 
          message: 'La operación tardó demasiado. Por favor, intenta de nuevo.' 
        };
      }

      // Recuperación para errores de validación
      if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
        return { 
          recovered: false, 
          data: null, 
          message: 'Los datos ingresados no son válidos. Por favor, verifica e intenta de nuevo.' 
        };
      }

      // Recuperación para errores de stock
      if (errorMessage.includes('stock') || errorMessage.includes('disponible')) {
        return { 
          recovered: false, 
          data: null, 
          message: 'No hay stock suficiente. Te mostraré productos similares disponibles.' 
        };
      }

      return { recovered: false, data: null };
    } catch (recoveryError) {
      logger.error('Error en recuperación:', recoveryError);
      return { recovered: false, data: null };
    }
  }

  /**
   * Generar mensaje de error amigable
   * 
   * @param {Error} error - Error
   * @param {object} context - Contexto
   * @returns {string} Mensaje amigable
   */
  _generateFriendlyErrorMessage(error, context = {}) {
    const errorMessage = error.message || error.toString();

    // Mensajes específicos según el tipo de error
    if (errorMessage.includes('No entendí')) {
      return 'No entendí esa parte, ¿quizás quisiste decir ___? Por favor, intenta ser más específico.';
    }

    if (errorMessage.includes('no existe') || errorMessage.includes('not found')) {
      return 'Esa opción no existe. Te mostraré las opciones válidas disponibles.';
    }

    if (errorMessage.includes('número') || errorMessage.includes('number')) {
      return 'Por favor ingresa solo el número de opción o el texto correspondiente.';
    }

    if (errorMessage.includes('dos cosas') || errorMessage.includes('multiple')) {
      return 'Parece que me dijiste dos cosas a la vez. ¿Cuál deseas confirmar primero?';
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('tardó')) {
      return 'La operación tardó demasiado. Por favor, intenta de nuevo.';
    }

    // Mensaje genérico
    return 'Hubo un error al procesar tu solicitud. Por favor, intenta de nuevo o escribe "AYUDA" para ver las opciones disponibles.';
  }

  /**
   * Registrar error en historial
   * 
   * @param {Error} error - Error
   * @param {object} context - Contexto
   */
  _recordError(error, context = {}) {
    this.errorHistory.push({
      timestamp: new Date(),
      error: error.message || error.toString(),
      stack: error.stack,
      operation: context.operation,
      phoneNumber: context.phoneNumber,
      sessionState: context.sessionState
    });

    // Limitar tamaño del historial
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Obtener historial de errores
   * 
   * @param {number} limit - Límite de errores
   * @returns {array} Historial de errores
   */
  getErrorHistory(limit = 10) {
    return this.errorHistory.slice(-limit);
  }

  /**
   * Limpiar historial de errores
   */
  clearErrorHistory() {
    this.errorHistory = [];
    logger.info('✅ Historial de errores limpiado');
  }

  /**
   * Manejar error de opción no válida
   * 
   * @param {string} userInput - Input del usuario
   * @param {array} validOptions - Opciones válidas
   * @returns {string} Mensaje de error amigable
   */
  handleInvalidOption(userInput, validOptions = []) {
    let message = `❌ La opción "${userInput}" no es válida.\n\n`;
    
    if (validOptions && validOptions.length > 0) {
      message += `✅ *Opciones válidas:*\n\n`;
      validOptions.forEach((opt, idx) => {
        message += `${idx + 1}. ${opt}\n`;
      });
      message += `\n💬 Por favor, responde con el número o el texto de la opción.`;
    } else {
      message += `💬 Por favor, intenta de nuevo o escribe "AYUDA" para ver las opciones disponibles.`;
    }

    return message;
  }

  /**
   * Manejar error de entrada ambigua
   * 
   * @param {string} userInput - Input del usuario
   * @param {array} possibleIntents - Intenciones posibles
   * @returns {string} Mensaje para aclarar
   */
  handleAmbiguousInput(userInput, possibleIntents = []) {
    let message = `🤔 No estoy seguro de lo que quieres hacer.\n\n`;
    
    if (possibleIntents && possibleIntents.length > 0) {
      message += `¿Te refieres a alguna de estas opciones?\n\n`;
      possibleIntents.forEach((intent, idx) => {
        message += `${idx + 1}. ${intent}\n`;
      });
      message += `\n💬 Responde con el número o el texto correspondiente.`;
    } else {
      message += `💬 Por favor, sé más específico o escribe "AYUDA" para ver las opciones disponibles.`;
    }

    return message;
  }
}

module.exports = new ErrorRecovery();
