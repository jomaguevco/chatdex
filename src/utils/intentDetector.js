const logger = require('./logger');
const textCorrector = require('./textCorrector');
const basicBot = require('../basicBot');

/**
 * Detector de intenciones mejorado con múltiples estrategias de fallback
 */
class IntentDetector {
  constructor() {
    this.confidenceThreshold = 0.6;
    this.maxAttempts = 3;
  }

  /**
   * Detectar intención con múltiples estrategias y fallbacks
   */
  async detectIntent(text, sessionState = {}, conversationHistory = []) {
    try {
      // Estrategia 1: Corrección de texto primero
      const correctedText = textCorrector.correctText(text || '');
      logger.info(`[IntentDetector] Texto original: "${text}" -> Corregido: "${correctedText}"`);

      // Estrategia 2: Detección básica (rápida)
      let intent = this._detectBasicIntent(correctedText);
      let confidence = this._calculateConfidence(correctedText, intent);

      logger.info(`[IntentDetector] Intención básica: ${intent} (confianza: ${confidence})`);

      // Si la confianza es alta, usar resultado básico
      if (confidence >= this.confidenceThreshold && intent !== 'unknown') {
        return { intent, confidence, text: correctedText, strategy: 'basic' };
      }

      // Estrategia 3: Detección contextual (considera el estado de la sesión)
      const contextualIntent = this._detectContextualIntent(correctedText, sessionState);
      const contextualConfidence = this._calculateContextualConfidence(correctedText, contextualIntent, sessionState);

      logger.info(`[IntentDetector] Intención contextual: ${contextualIntent} (confianza: ${contextualConfidence})`);

      // Usar la mejor estrategia
      if (contextualConfidence > confidence) {
        intent = contextualIntent;
        confidence = contextualConfidence;
      }

      // Estrategia 4: Detección fonética (para errores de pronunciación)
      if (confidence < this.confidenceThreshold) {
        const phoneticIntent = this._detectPhoneticIntent(correctedText);
        const phoneticConfidence = this._calculateConfidence(correctedText, phoneticIntent);

        if (phoneticConfidence > confidence) {
          intent = phoneticIntent;
          confidence = phoneticConfidence;
          logger.info(`[IntentDetector] Intención fonética: ${intent} (confianza: ${confidence})`);
        }
      }

      // Si aún no tenemos suficiente confianza, intentar con basicBot
      if (confidence < this.confidenceThreshold) {
        try {
          const basicResult = basicBot._detectIntent(correctedText);
          if (basicResult && basicResult !== 'unknown') {
            intent = basicResult;
            confidence = 0.7; // Confianza media para basicBot
            logger.info(`[IntentDetector] Intención basicBot: ${intent}`);
          }
        } catch (botError) {
          logger.warn(`[IntentDetector] Error en basicBot._detectIntent: ${botError.message}`);
        }
      }

      return {
        intent: intent || 'unknown',
        confidence: Math.min(confidence, 1.0),
        text: correctedText,
        originalText: text,
        strategy: confidence >= this.confidenceThreshold ? 'detected' : 'fallback'
      };

    } catch (error) {
      logger.error('[IntentDetector] Error al detectar intención:', error);
      // Fallback seguro
      return {
        intent: 'unknown',
        confidence: 0.0,
        text: text || '',
        originalText: text || '',
        strategy: 'error_fallback'
      };
    }
  }

  /**
   * Detección básica de intenciones con palabras clave
   */
  _detectBasicIntent(text) {
    const normalized = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    
    // Mapeo de palabras clave a intenciones
    const intentKeywords = {
      greeting: ['hola', 'hi', 'hello', 'buenos', 'buenas', 'saludos', 'que tal', 'como estas'],
      catalog: ['catalogo', 'catalogo', 'productos', 'lista', 'ver productos', 'muestrame productos'],
      help: ['ayuda', 'help', 'comandos', 'que puedo hacer', 'opciones'],
      status: ['estado', 'mi pedido', 'pedido', 'ver pedido', 'que tengo'],
      order: ['quiero', 'necesito', 'dame', 'comprar', 'pedir', 'agregar', 'ponme', 'traeme'],
      cancel: ['cancelar', 'salir', 'volver', 'no quiero', 'déjalo', 'olvídalo'],
      price: ['precio', 'cuesta', 'vale', 'cuanto', 'cuánto', 'a cuanto'],
      stock: ['tienes', 'hay', 'disponible', 'stock', 'queda'],
      yes: ['si', 'sí', 'ok', 'okey', 'acepto', 'confirmo', 'correcto'],
      no: ['no', 'n', 'tampoco', 'no quiero', 'mejor no', 'no gracias'],
      register: ['registrar', 'registro', 'crear cuenta', 'nueva cuenta'],
      temp_order: ['pedido', 'orden temporal', 'sin registro']
    };

    // Buscar intención con mayor coincidencia
    let bestIntent = 'unknown';
    let maxMatches = 0;

    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      const matches = keywords.filter(keyword => normalized.includes(keyword)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        bestIntent = intent;
      }
    }

    return maxMatches > 0 ? bestIntent : 'unknown';
  }

  /**
   * Detección contextual basada en el estado de la sesión
   */
  _detectContextualIntent(text, sessionState = {}) {
    const normalized = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const currentState = sessionState.state || sessionState._currentState || 'idle';

    // Si está esperando confirmación de cliente, priorizar sí/no
    if (currentState === 'awaiting_client_confirmation') {
      if (normalized.match(/^(si|sí|s|yes|y|cliente|registrado|tengo cuenta)$/)) {
        return 'yes';
      }
      if (normalized.match(/^(no|n|tampoco|no soy|no estoy)$/)) {
        return 'no';
      }
    }

    // Si está esperando teléfono, detectar si es un número
    if (currentState === 'awaiting_phone') {
      const phonePattern = /^[\d\s\+\-\(\)]+$/;
      if (phonePattern.test(normalized.replace(/\s/g, ''))) {
        return 'phone_input';
      }
    }

    // Si está esperando contraseña
    if (currentState === 'awaiting_password') {
      if (normalized.includes('olvid') || normalized.includes('no recuerdo') || normalized.includes('recuperar')) {
        return 'forgot_password';
      }
      // Cualquier otra cosa se considera contraseña
      if (normalized.length >= 4) {
        return 'password_input';
      }
    }

    // Si está autenticado y menciona pedido/compra
    if (sessionState._authenticated && (normalized.includes('pedido') || normalized.includes('compra'))) {
      return 'order_status';
    }

    return 'unknown';
  }

  /**
   * Detección fonética para manejar errores de pronunciación
   */
  _detectPhoneticIntent(text) {
    // Similitudes fonéticas comunes
    const phoneticMap = {
      'quiero': ['qero', 'kero', 'kiero', 'quiero', 'quier'],
      'necesito': ['nesesito', 'nesito', 'neces', 'nesito'],
      'producto': ['produkto', 'produk', 'produto'],
      'catalogo': ['katalogo', 'katalo', 'catalo'],
      'precio': ['presio', 'precio', 'preci'],
      'disponible': ['disponibl', 'dispon', 'disponibl']
    };

    const normalized = (text || '').toLowerCase().trim();

    // Buscar coincidencias fonéticas
    for (const [correct, variants] of Object.entries(phoneticMap)) {
      for (const variant of variants) {
        if (normalized.includes(variant)) {
          return this._detectBasicIntent(normalized.replace(variant, correct));
        }
      }
    }

    return 'unknown';
  }

  /**
   * Calcular confianza en la detección
   */
  _calculateConfidence(text, intent) {
    if (!text || intent === 'unknown') {
      return 0.0;
    }

    const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    
    // Mapeo de palabras clave con pesos
    const keywordWeights = {
      greeting: { 'hola': 1.0, 'hi': 0.9, 'hello': 0.9, 'buenos': 0.8 },
      catalog: { 'catalogo': 1.0, 'productos': 0.9, 'lista': 0.8 },
      order: { 'quiero': 0.9, 'necesito': 0.9, 'dame': 0.8, 'comprar': 0.8 },
      price: { 'precio': 1.0, 'cuesta': 0.9, 'cuanto': 0.9, 'vale': 0.8 }
    };

    const weights = keywordWeights[intent] || {};
    let totalWeight = 0;
    let matches = 0;

    for (const [keyword, weight] of Object.entries(weights)) {
      if (normalized.includes(keyword)) {
        totalWeight += weight;
        matches++;
      }
    }

    // Calcular confianza basada en coincidencias
    if (matches === 0) {
      return 0.3; // Confianza baja si no hay coincidencias directas
    }

    const avgWeight = totalWeight / matches;
    return Math.min(avgWeight, 1.0);
  }

  /**
   * Calcular confianza contextual
   */
  _calculateContextualConfidence(text, intent, sessionState) {
    let baseConfidence = this._calculateConfidence(text, intent);
    
    // Aumentar confianza si la intención es coherente con el estado
    const currentState = sessionState.state || sessionState._currentState || 'idle';
    
    const stateIntentMap = {
      'awaiting_client_confirmation': ['yes', 'no'],
      'awaiting_phone': ['phone_input'],
      'awaiting_password': ['password_input', 'forgot_password']
    };

    const validIntents = stateIntentMap[currentState];
    if (validIntents && validIntents.includes(intent)) {
      baseConfidence += 0.3; // Bonus de confianza contextual
    }

    return Math.min(baseConfidence, 1.0);
  }

  /**
   * Validar transición de estado
   */
  isValidStateTransition(currentState, intent, sessionState = {}) {
    const validTransitions = {
      'idle': ['greeting', 'catalog', 'help', 'order', 'register'],
      'awaiting_client_confirmation': ['yes', 'no'],
      'awaiting_phone': ['phone_input'],
      'awaiting_password': ['password_input', 'forgot_password', 'cancel'],
      'awaiting_reg_name': ['text_input', 'cancel'],
      'awaiting_reg_dni': ['text_input', 'cancel'],
      'awaiting_reg_email': ['email_input', 'cancel'],
      'awaiting_reg_password': ['password_input', 'cancel']
    };

    const allowedIntents = validTransitions[currentState] || [];
    return allowedIntents.includes(intent);
  }
}

module.exports = new IntentDetector();
