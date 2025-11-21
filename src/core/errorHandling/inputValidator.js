const logger = require('../../utils/logger');

/**
 * Validador de entrada
 * 
 * Este módulo valida y sanitiza inputs del usuario:
 * - Validar correos, números, direcciones, métodos de pago
 * - Prevenir inyecciones o texto malicioso
 * - Sanitizar inputs
 * - Normalizar formatos
 * 
 * @module core/errorHandling/inputValidator
 */

class InputValidator {
  constructor() {
    this.suspiciousPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /eval\s*\(/gi,
      /expression\s*\(/gi,
      /<iframe/gi,
      /<object/gi,
      /<embed/gi
    ];
  }

  /**
   * Validar email
   * 
   * @param {string} email - Email a validar
   * @returns {object} {valid: boolean, error: string|null}
   */
  validateEmail(email) {
    try {
      if (!email || typeof email !== 'string') {
        return { valid: false, error: 'Email no proporcionado' };
      }

      const emailTrimmed = email.trim().toLowerCase();
      
      // Validación básica de formato
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (!emailRegex.test(emailTrimmed)) {
        return { valid: false, error: 'Formato de email inválido. Ejemplo: usuario@ejemplo.com' };
      }

      // Validar longitud
      if (emailTrimmed.length > 255) {
        return { valid: false, error: 'Email demasiado largo' };
      }

      // Sanitizar
      const sanitized = this.sanitize(emailTrimmed);

      return { valid: true, sanitized, error: null };
    } catch (error) {
      logger.error('Error en validateEmail:', error);
      return { valid: false, error: 'Error al validar email' };
    }
  }

  /**
   * Validar número de teléfono peruano
   * 
   * @param {string|number} phone - Teléfono a validar
   * @returns {object} {valid: boolean, normalized: string|null, error: string|null}
   */
  validatePhone(phone) {
    try {
      if (!phone) {
        return { valid: false, error: 'Teléfono no proporcionado' };
      }

      // Normalizar: remover caracteres no numéricos excepto +
      let normalized = phone.toString().replace(/[^0-9+]/g, '');
      normalized = normalized.replace(/^\+/, ''); // Remover + si existe

      // Si empieza con 0, quitarlo
      if (normalized.startsWith('0') && normalized.length > 1) {
        normalized = normalized.substring(1);
      }

      // Validar formato peruano: 9 dígitos (sin código) o 11 dígitos (con código 51)
      if (normalized.length === 9 && /^9\d{8}$/.test(normalized)) {
        return { valid: true, normalized: normalized, error: null };
      }

      if (normalized.length === 11 && /^519\d{8}$/.test(normalized)) {
        return { valid: true, normalized: normalized, error: null };
      }

      return { 
        valid: false, 
        normalized: null, 
        error: 'Formato de teléfono inválido. Debe tener 9 dígitos (ejemplo: 987654321) o 11 dígitos con código de país (ejemplo: 51987654321)' 
      };
    } catch (error) {
      logger.error('Error en validatePhone:', error);
      return { valid: false, error: 'Error al validar teléfono' };
    }
  }

  /**
   * Validar dirección
   * 
   * @param {string} address - Dirección a validar
   * @returns {object} {valid: boolean, sanitized: string|null, error: string|null}
   */
  validateAddress(address) {
    try {
      if (!address || typeof address !== 'string') {
        return { valid: false, error: 'Dirección no proporcionada' };
      }

      const addressTrimmed = address.trim();

      // Validar longitud mínima
      if (addressTrimmed.length < 5) {
        return { valid: false, error: 'La dirección es muy corta. Por favor, proporciona una dirección completa.' };
      }

      // Validar longitud máxima
      if (addressTrimmed.length > 500) {
        return { valid: false, error: 'La dirección es muy larga. Por favor, proporciona una dirección más concisa.' };
      }

      // Sanitizar
      const sanitized = this.sanitize(addressTrimmed);

      return { valid: true, sanitized, error: null };
    } catch (error) {
      logger.error('Error en validateAddress:', error);
      return { valid: false, error: 'Error al validar dirección' };
    }
  }

  /**
   * Validar método de pago
   * 
   * @param {string} paymentMethod - Método de pago
   * @returns {object} {valid: boolean, normalized: string|null, error: string|null}
   */
  validatePaymentMethod(paymentMethod) {
    try {
      if (!paymentMethod || typeof paymentMethod !== 'string') {
        return { valid: false, error: 'Método de pago no proporcionado' };
      }

      const methodLower = paymentMethod.trim().toLowerCase();

      // Métodos válidos
      const validMethods = {
        'yape': 'yape',
        'plin': 'plin',
        'transferencia': 'transferencia',
        'efectivo': 'efectivo',
        'tarjeta': 'tarjeta',
        'tarjeta de credito': 'tarjeta',
        'tarjeta de débito': 'tarjeta',
        'credito': 'tarjeta',
        'debito': 'tarjeta'
      };

      // Buscar método válido
      for (const [key, value] of Object.entries(validMethods)) {
        if (methodLower.includes(key)) {
          return { valid: true, normalized: value, error: null };
        }
      }

      return { 
        valid: false, 
        normalized: null, 
        error: `Método de pago inválido. Métodos válidos: ${Object.values(validMethods).filter((v, i, a) => a.indexOf(v) === i).join(', ')}` 
      };
    } catch (error) {
      logger.error('Error en validatePaymentMethod:', error);
      return { valid: false, error: 'Error al validar método de pago' };
    }
  }

  /**
   * Validar cantidad (número entero positivo)
   * 
   * @param {string|number} quantity - Cantidad a validar
   * @returns {object} {valid: boolean, normalized: number|null, error: string|null}
   */
  validateQuantity(quantity) {
    try {
      if (!quantity && quantity !== 0) {
        return { valid: false, error: 'Cantidad no proporcionada' };
      }

      // Convertir a número
      const num = typeof quantity === 'string' ? parseInt(quantity, 10) : Math.floor(quantity);

      // Validar que sea un número válido
      if (isNaN(num) || !isFinite(num)) {
        return { valid: false, error: 'La cantidad debe ser un número válido' };
      }

      // Validar que sea positivo
      if (num < 1) {
        return { valid: false, error: 'La cantidad debe ser mayor a 0' };
      }

      // Validar que sea entero
      if (num % 1 !== 0) {
        return { valid: false, error: 'La cantidad debe ser un número entero (sin decimales)' };
      }

      // Validar máximo razonable
      if (num > 1000) {
        return { valid: false, error: 'La cantidad es muy grande. Por favor, contacta con soporte para pedidos grandes.' };
      }

      return { valid: true, normalized: num, error: null };
    } catch (error) {
      logger.error('Error en validateQuantity:', error);
      return { valid: false, error: 'Error al validar cantidad' };
    }
  }

  /**
   * Sanitizar texto (prevenir inyecciones y texto malicioso)
   * 
   * @param {string} text - Texto a sanitizar
   * @returns {string} Texto sanitizado
   */
  sanitize(text) {
    try {
      if (!text || typeof text !== 'string') {
        return '';
      }

      let sanitized = text;

      // Remover patrones sospechosos
      for (const pattern of this.suspiciousPatterns) {
        sanitized = sanitized.replace(pattern, '');
      }

      // Remover caracteres de control excepto espacios y saltos de línea
      sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

      // Limitar longitud
      if (sanitized.length > 10000) {
        sanitized = sanitized.substring(0, 10000);
      }

      return sanitized.trim();
    } catch (error) {
      logger.error('Error en sanitize:', error);
      return text || '';
    }
  }

  /**
   * Validar DNI
   * 
   * @param {string|number} dni - DNI a validar
   * @returns {object} {valid: boolean, normalized: string|null, error: string|null}
   */
  validateDNI(dni) {
    try {
      if (!dni) {
        return { valid: false, error: 'DNI no proporcionado' };
      }

      // Normalizar: solo números
      let normalized = dni.toString().replace(/[^0-9]/g, '');

      // Validar longitud (DNI peruano: 8 dígitos)
      if (normalized.length !== 8) {
        return { valid: false, error: 'El DNI debe tener 8 dígitos' };
      }

      // Validar que no sea todos ceros
      if (/^0+$/.test(normalized)) {
        return { valid: false, error: 'DNI inválido' };
      }

      return { valid: true, normalized, error: null };
    } catch (error) {
      logger.error('Error en validateDNI:', error);
      return { valid: false, error: 'Error al validar DNI' };
    }
  }

  /**
   * Validar nombre
   * 
   * @param {string} name - Nombre a validar
   * @returns {object} {valid: boolean, sanitized: string|null, error: string|null}
   */
  validateName(name) {
    try {
      if (!name || typeof name !== 'string') {
        return { valid: false, error: 'Nombre no proporcionado' };
      }

      const nameTrimmed = name.trim();

      // Validar longitud mínima
      if (nameTrimmed.length < 2) {
        return { valid: false, error: 'El nombre es muy corto' };
      }

      // Validar longitud máxima
      if (nameTrimmed.length > 200) {
        return { valid: false, error: 'El nombre es muy largo' };
      }

      // Validar que tenga solo letras, espacios y caracteres comunes
      if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s\-\.']+$/.test(nameTrimmed)) {
        return { valid: false, error: 'El nombre contiene caracteres inválidos' };
      }

      // Sanitizar
      const sanitized = this.sanitize(nameTrimmed);

      return { valid: true, sanitized, error: null };
    } catch (error) {
      logger.error('Error en validateName:', error);
      return { valid: false, error: 'Error al validar nombre' };
    }
  }
}

module.exports = new InputValidator();
