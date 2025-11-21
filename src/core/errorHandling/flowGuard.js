const logger = require('../../utils/logger');

/**
 * Guardián de flujo
 * 
 * Este módulo previene problemas en el flujo de conversación:
 * - Prevenir loops infinitos
 * - Garantizar rutas de retorno
 * - Manejar desconexiones y reintentos
 * - Timeout en operaciones largas
 * 
 * @module core/errorHandling/flowGuard
 */

class FlowGuard {
  constructor() {
    this.maxRetries = 3;
    this.maxLoops = 5;
    this.operationTimeouts = new Map();
    this.defaultTimeout = 30000; // 30 segundos
    this.stateHistory = new Map(); // phoneNumber -> array de estados recientes
    this.maxHistorySize = 10;
  }

  /**
   * Verificar si hay loop infinito en el flujo
   * 
   * @param {string} phoneNumber - Número de teléfono
   * @param {string} currentState - Estado actual
   * @returns {boolean} true si hay loop detectado
   */
  detectInfiniteLoop(phoneNumber, currentState) {
    try {
      if (!this.stateHistory.has(phoneNumber)) {
        this.stateHistory.set(phoneNumber, []);
      }

      const history = this.stateHistory.get(phoneNumber);
      history.push({
        state: currentState,
        timestamp: Date.now()
      });

      // Limitar tamaño del historial
      if (history.length > this.maxHistorySize) {
        history.shift();
      }

      // Verificar si el mismo estado se repite muchas veces
      const recentStates = history.slice(-this.maxLoops);
      const stateCounts = {};
      
      for (const item of recentStates) {
        stateCounts[item.state] = (stateCounts[item.state] || 0) + 1;
      }

      // Si un estado aparece más de maxLoops veces, hay loop
      for (const [state, count] of Object.entries(stateCounts)) {
        if (count >= this.maxLoops) {
          logger.warn(`⚠️ Loop infinito detectado para ${phoneNumber}: estado "${state}" repetido ${count} veces`);
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error en detectInfiniteLoop:', error);
      return false;
    }
  }

  /**
   * Obtener ruta de retorno segura
   * 
   * @param {string} phoneNumber - Número de teléfono
   * @param {string} currentState - Estado actual
   * @returns {string} Estado de retorno seguro
   */
  getSafeReturnRoute(phoneNumber, currentState) {
    try {
      // Estados que permiten retorno seguro
      const safeStates = ['idle', 'awaiting_phone', 'awaiting_client_confirmation'];
      
      // Si el estado actual es seguro, quedarse ahí
      if (safeStates.includes(currentState)) {
        return currentState;
      }

      // Obtener historial de estados
      const history = this.stateHistory.get(phoneNumber) || [];
      
      // Buscar el último estado seguro
      for (let i = history.length - 1; i >= 0; i--) {
        if (safeStates.includes(history[i].state)) {
          return history[i].state;
        }
      }

      // Si no hay estado seguro en historial, retornar idle
      return 'idle';
    } catch (error) {
      logger.error('Error en getSafeReturnRoute:', error);
      return 'idle';
    }
  }

  /**
   * Ejecutar operación con timeout
   * 
   * @param {Function} fn - Función a ejecutar
   * @param {number} timeoutMs - Timeout en milisegundos
   * @param {string} operationName - Nombre de la operación
   * @returns {Promise<any>} Resultado de la función
   */
  async executeWithTimeout(fn, timeoutMs = null, operationName = 'operation') {
    const timeout = timeoutMs || this.defaultTimeout;
    
    return Promise.race([
      fn(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timeout: La operación "${operationName}" tardó más de ${timeout}ms`));
        }, timeout);
      })
    ]);
  }

  /**
   * Ejecutar operación con reintentos
   * 
   * @param {Function} fn - Función a ejecutar
   * @param {number} maxRetries - Número máximo de reintentos
   * @param {number} delayMs - Delay entre reintentos en ms
   * @returns {Promise<any>} Resultado de la función
   */
  async executeWithRetry(fn, maxRetries = null, delayMs = 1000) {
    const retries = maxRetries || this.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < retries) {
          logger.warn(`Intento ${attempt + 1}/${retries} falló, reintentando en ${delayMs}ms...`, error.message);
          await this._delay(delayMs);
        }
      }
    }

    throw lastError;
  }

  /**
   * Verificar si hay desconexión
   * 
   * @param {string} phoneNumber - Número de teléfono
   * @param {number} maxInactivityMs - Máximo tiempo de inactividad en ms
   * @returns {boolean} true si hay desconexión
   */
  detectDisconnection(phoneNumber, maxInactivityMs = 10 * 60 * 1000) {
    try {
      const history = this.stateHistory.get(phoneNumber);
      
      if (!history || history.length === 0) {
        return false;
      }

      const lastActivity = history[history.length - 1].timestamp;
      const timeSinceLastActivity = Date.now() - lastActivity;

      return timeSinceLastActivity > maxInactivityMs;
    } catch (error) {
      logger.error('Error en detectDisconnection:', error);
      return false;
    }
  }

  /**
   * Limpiar historial de un número
   * 
   * @param {string} phoneNumber - Número de teléfono
   */
  clearHistory(phoneNumber) {
    if (this.stateHistory.has(phoneNumber)) {
      this.stateHistory.delete(phoneNumber);
    }
  }

  /**
   * Limpiar todo el historial
   */
  clearAllHistory() {
    this.stateHistory.clear();
    logger.info('✅ Historial de estados limpiado');
  }

  /**
   * Delay helper
   * 
   * @param {number} ms - Milisegundos
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validar transición de estado
   * 
   * @param {string} fromState - Estado origen
   * @param {string} toState - Estado destino
   * @returns {boolean} true si la transición es válida
   */
  validateStateTransition(fromState, toState) {
    // Transiciones siempre válidas (retorno seguro)
    const alwaysValidTo = ['idle', 'awaiting_client_confirmation'];
    if (alwaysValidTo.includes(toState)) {
      return true;
    }

    // Transiciones inválidas (volver a estados de entrada después de avanzar)
    const invalidFromTo = {
      'awaiting_password': ['awaiting_phone'],
      'awaiting_reg_name': ['awaiting_phone'],
      'awaiting_reg_dni': ['awaiting_phone'],
      'pedido_en_proceso': ['awaiting_phone']
    };

    if (invalidFromTo[fromState] && invalidFromTo[fromState].includes(toState)) {
      logger.warn(`⚠️ Transición inválida detectada: ${fromState} -> ${toState}`);
      return false;
    }

    return true;
  }

  /**
   * Obtener estadísticas de flujo
   * 
   * @param {string} phoneNumber - Número de teléfono
   * @returns {object} Estadísticas
   */
  getFlowStats(phoneNumber) {
    const history = this.stateHistory.get(phoneNumber) || [];
    
    return {
      totalTransitions: history.length,
      currentState: history.length > 0 ? history[history.length - 1].state : null,
      lastActivity: history.length > 0 ? new Date(history[history.length - 1].timestamp) : null,
      stateCounts: history.reduce((acc, item) => {
        acc[item.state] = (acc[item.state] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

module.exports = new FlowGuard();
