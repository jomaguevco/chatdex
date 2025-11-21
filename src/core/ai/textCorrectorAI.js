const textCorrector = require('../../utils/textCorrector');
const ollamaClient = require('../../utils/ollamaClient');
const logger = require('../../utils/logger');

/**
 * CorrectOR de texto mejorado con IA
 * 
 * Este módulo combina corrección basada en reglas con IA para:
 * - Corregir errores de escritura y transcripción de voz
 * - Manejar variaciones de pronunciación
 * - Normalizar texto antes de procesar
 * - Entender contexto para mejor corrección
 * 
 * Usa un enfoque híbrido:
 * 1. Corrección básica con reglas (rápida)
 * 2. Corrección con IA para casos complejos (más precisa)
 * 
 * @module core/ai/textCorrectorAI
 */

class TextCorrectorAI {
  constructor() {
    this.useAI = true;
    this.aiEnabled = true;
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10 minutos (las correcciones son más estables)
  }

  /**
   * Corregir texto usando reglas básicas primero, luego IA si es necesario
   * 
   * @param {string} text - Texto a corregir
   * @param {object} options - Opciones {useAI: boolean, isFromVoice: boolean, context: string}
   * @returns {Promise<string>} Texto corregido
   */
  async correct(text, options = {}) {
    try {
      if (!text || typeof text !== 'string') {
        return text || '';
      }

      const isFromVoice = options.isFromVoice || false;
      const useAI = options.useAI !== undefined ? options.useAI : this.useAI;
      const context = options.context || '';

      // Verificar cache
      const cacheKey = `correct_${text.toLowerCase().trim().substring(0, 50)}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('[Cache] Corrección encontrada en cache');
        return cached.result;
      }

      // Paso 1: Corrección básica con reglas (siempre aplicada)
      let corrected = textCorrector.correctText(text);
      
      // Si la corrección básica ya es buena, no usar IA
      const similarity = this._calculateSimilarity(text, corrected);
      
      // Si la similitud es alta (>0.9), no necesitamos IA
      if (similarity > 0.9 && !isFromVoice) {
        this.cache.set(cacheKey, {
          result: corrected,
          timestamp: Date.now()
        });
        return corrected;
      }

      // Paso 2: Corrección con IA para casos complejos o transcripciones de voz
      if (useAI && this.aiEnabled && (isFromVoice || similarity < 0.8)) {
        try {
          const aiCorrected = await this._correctWithAI(corrected, context);
          
          // Usar la corrección de IA si es mejor
          if (aiCorrected && aiCorrected !== corrected) {
            corrected = aiCorrected;
          }
        } catch (aiError) {
          logger.warn('Error en corrección con IA, usando corrección básica:', aiError.message);
        }
      }

      // Guardar en cache
      this.cache.set(cacheKey, {
        result: corrected,
        timestamp: Date.now()
      });

      return corrected;
    } catch (error) {
      logger.error('Error en correct:', error);
      // Fallback a corrección básica
      return textCorrector.correctText(text);
    }
  }

  /**
   * Corregir texto usando IA (Ollama)
   * 
   * @param {string} text - Texto a corregir
   * @param {string} context - Contexto adicional
   * @returns {Promise<string>} Texto corregido
   */
  async _correctWithAI(text, context = '') {
    try {
      const systemPrompt = `Eres un corrector de texto experto en español, especializado en:
1. Corregir errores ortográficos y de transcripción de voz
2. Normalizar variaciones coloquiales a forma estándar
3. Mantener la intención original del mensaje
4. Corregir errores comunes de transcripción de voz (ej: "kwero" -> "quiero")

INSTRUCCIONES:
- Solo corrige errores, no cambies el significado
- Mantén el tono original (formal/informal)
- Para productos y marcas, usa nombres estándar
- Corrige números y cantidades mal escritas
- Normaliza expresiones coloquiales a forma estándar

Responde SOLO con el texto corregido, sin explicaciones.`;

      let prompt = `Corrige este texto manteniendo su intención y significado:\n\n"${text}"\n\n`;
      
      if (context) {
        prompt += `Contexto: ${context}\n\n`;
      }

      prompt += `Texto corregido:`;

      const corrected = await ollamaClient.generate(
        prompt,
        systemPrompt,
        {
          temperature: 0.1, // Baja temperatura para más precisión
          timeout: 5000 // 5 segundos timeout
        }
      );

      // Limpiar respuesta (remover comillas, espacios extra)
      let cleaned = corrected.trim();
      cleaned = cleaned.replace(/^["']|["']$/g, ''); // Remover comillas al inicio/fin
      cleaned = cleaned.trim();

      // Si la respuesta tiene formato JSON o explicaciones, extraer solo el texto
      if (cleaned.includes('"') || cleaned.includes("'")) {
        const match = cleaned.match(/["']([^"']+)["']/);
        if (match) {
          cleaned = match[1];
        }
      }

      // Si la corrección es muy diferente, mantener la original
      const similarity = this._calculateSimilarity(text, cleaned);
      if (similarity < 0.5) {
        logger.warn('Corrección de IA muy diferente, usando original');
        return text;
      }

      return cleaned;
    } catch (error) {
      logger.error('Error en _correctWithAI:', error);
      return text; // Retornar original si hay error
    }
  }

  /**
   * Calcular similitud entre dos textos (simple)
   * 
   * @param {string} text1 - Primer texto
   * @param {string} text2 - Segundo texto
   * @returns {number} Similitud entre 0 y 1
   */
  _calculateSimilarity(text1, text2) {
    if (!text1 || !text2) {
      return 0;
    }

    const s1 = text1.toLowerCase().trim();
    const s2 = text2.toLowerCase().trim();

    if (s1 === s2) {
      return 1;
    }

    // Distancia de Levenshtein simple (aproximada)
    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);
    
    if (maxLen === 0) {
      return 1;
    }

    // Calcular diferencia de caracteres
    let diff = 0;
    const minLen = Math.min(len1, len2);
    
    for (let i = 0; i < minLen; i++) {
      if (s1[i] !== s2[i]) {
        diff++;
      }
    }

    diff += Math.abs(len1 - len2);

    return 1 - (diff / maxLen);
  }

  /**
   * Normalizar texto para búsqueda (mejorado con IA si es necesario)
   * 
   * @param {string} text - Texto a normalizar
   * @param {boolean} useAI - Si usar IA (default: false para normalización rápida)
   * @returns {Promise<string>} Texto normalizado
   */
  async normalize(text, useAI = false) {
    try {
      // Normalización básica siempre aplicada
      let normalized = textCorrector.normalizeQuery(text);

      // Si useAI es true, aplicar corrección con IA primero
      if (useAI && this.aiEnabled) {
        normalized = await this.correct(normalized, { useAI: true });
      }

      return normalized;
    } catch (error) {
      logger.error('Error en normalize:', error);
      return textCorrector.normalizeQuery(text);
    }
  }

  /**
   * Corregir múltiples textos en batch
   * 
   * @param {array} texts - Array de textos
   * @param {object} options - Opciones
   * @returns {Promise<array>} Array de textos corregidos
   */
  async correctBatch(texts, options = {}) {
    const results = [];
    
    for (const text of texts) {
      const corrected = await this.correct(text, options);
      results.push(corrected);
    }

    return results;
  }

  /**
   * Habilitar/deshabilitar uso de IA
   * 
   * @param {boolean} enabled - Si habilitar IA
   */
  setAIEnabled(enabled) {
    this.aiEnabled = enabled;
    logger.info(`IA en textCorrectorAI ${enabled ? 'habilitada' : 'deshabilitada'}`);
  }

  /**
   * Limpiar cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('✅ Cache de correcciones limpiado');
  }

  /**
   * Obtener estadísticas
   * 
   * @returns {object} Estadísticas del corrector
   */
  getStats() {
    return {
      aiEnabled: this.aiEnabled,
      useAI: this.useAI,
      cacheSize: this.cache.size
    };
  }
}

module.exports = new TextCorrectorAI();
