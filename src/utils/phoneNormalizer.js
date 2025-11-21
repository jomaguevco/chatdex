/**
 * Utilidad para normalizar números de teléfono
 */
class PhoneNormalizer {
  /**
   * Normalizar número de teléfono
   * @param {string} phone - Número de teléfono en cualquier formato
   * @returns {string} - Número normalizado sin espacios ni caracteres especiales
   */
  static normalize(phone) {
    if (!phone) return '';
    
    // Convertir a string y eliminar caracteres no numéricos (excepto + al inicio)
    let normalized = phone.toString().trim();
    
    // Eliminar espacios, guiones, paréntesis, etc.
    normalized = normalized.replace(/[\s\-\(\)\.]/g, '');
    
    // Si empieza con +, eliminarlo pero recordar que tenía código de país
    let hadPlus = false;
    if (normalized.startsWith('+')) {
      hadPlus = true;
      normalized = normalized.substring(1);
    }
    
    // Eliminar todo lo que no sea número
    normalized = normalized.replace(/[^0-9]/g, '');
    
    // Si tiene código de país 51 (Perú), mantenerlo
    // Si no tiene código y tiene 9 dígitos, agregar 51
    if (normalized.length === 9 && !normalized.startsWith('51')) {
      normalized = '51' + normalized;
    }
    
    // Si tenía + y no tiene código de país, agregarlo
    if (hadPlus && !normalized.startsWith('51') && normalized.length === 9) {
      normalized = '51' + normalized;
    }
    
    return normalized;
  }

  /**
   * Generar variantes de un número para búsqueda flexible
   * @param {string} phone - Número de teléfono
   * @returns {string[]} - Array de variantes del número
   */
  static getVariants(phone) {
    const normalized = this.normalize(phone);
    const variants = [normalized];
    
    // Si tiene código de país (51), agregar sin código
    if (normalized.startsWith('51') && normalized.length >= 11) {
      variants.push(normalized.substring(2));
    }
    
    // Si no tiene código y tiene más de 9 dígitos, intentar extraer los últimos 9
    if (!normalized.startsWith('51') && normalized.length >= 9) {
      variants.push(normalized.slice(-9));
    }
    
    // Eliminar duplicados
    return [...new Set(variants)];
  }

  /**
   * Validar formato de número de teléfono peruano
   * @param {string} phone - Número de teléfono
   * @returns {boolean} - True si es válido
   */
  static isValidPeruvianPhone(phone) {
    const normalized = this.normalize(phone);
    
    // Número peruano válido: 9 dígitos (debe empezar con 9 para celulares peruanos) 
    // o 11 dígitos (con código 51)
    // También aceptar cualquier número de 9 dígitos para flexibilidad
    return (normalized.length === 9 && /^\d{9}$/.test(normalized)) || 
           (normalized.length === 11 && normalized.startsWith('519')) ||
           (normalized.length === 10 && /^9\d{9}$/.test(normalized));
  }

  /**
   * Formatear número para mostrar
   * @param {string} phone - Número de teléfono
   * @returns {string} - Número formateado (ej: +51 987 654 321)
   */
  static format(phone) {
    const normalized = this.normalize(phone);
    
    if (normalized.startsWith('51') && normalized.length === 11) {
      const codigo = normalized.substring(0, 2);
      const numero = normalized.substring(2);
      return `+${codigo} ${numero.substring(0, 3)} ${numero.substring(3, 6)} ${numero.substring(6)}`;
    } else if (normalized.length === 9) {
      return `${normalized.substring(0, 3)} ${normalized.substring(3, 6)} ${normalized.substring(6)}`;
    }
    
    return normalized;
  }
}

module.exports = PhoneNormalizer;

