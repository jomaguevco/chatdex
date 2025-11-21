const logger = require('./logger');

class TextParser {
  constructor() {
    // Palabras clave para detectar cantidades
    this.cantidadKeywords = [
      'uno', 'dos', 'tres', 'cuatro', 'cinco', 
      'seis', 'siete', 'ocho', 'nueve', 'diez',
      'docena', 'media docena', 'kilo', 'kg', 'litro', 'medio'
    ];
    
    // Mapa de palabras a números
    this.palabrasANumeros = {
      'un': 1, 'uno': 1, 'una': 1,
      'dos': 2, 'pareja': 2, 'par': 2,
      'tres': 3,
      'cuatro': 4,
      'cinco': 5,
      'seis': 6,
      'siete': 7,
      'ocho': 8,
      'nueve': 9,
      'diez': 10,
      'once': 11,
      'doce': 12,
      'docena': 12,
      'media docena': 6,
      'medio': 0.5,
      'media': 0.5,
      'cuarto': 0.25,
      'un cuarto': 0.25
    };
    
    // Unidades de medida
    this.unidadesMedida = {
      'kg': 'kg', 'kilo': 'kg', 'kilogramos': 'kg', 'kilogramo': 'kg',
      'g': 'g', 'gramo': 'g', 'gramos': 'g',
      'lt': 'lt', 'litro': 'lt', 'litros': 'lt', 'l': 'lt',
      'ml': 'ml', 'mililitro': 'ml', 'mililitros': 'ml',
      'unidad': 'un', 'unidades': 'un', 'unid': 'un',
      'docena': 'docena', 'docenas': 'docena'
    };
    
    // Sinónimos / variantes comunes (normalizar consulta de producto)
    this.synonyms = {
      'raton': 'mouse',
      'maose': 'mouse',
      'maus': 'mouse',
      'audifonos': 'auriculares',
      'audifono': 'auriculares',
      'cascos': 'auriculares',
      'celu': 'celular',
      'laptop': 'laptop',
      'notebook': 'laptop',
      'impresora': 'impresora',
      'impresoras': 'impresora',
      'teclados': 'teclado',
      'mouses': 'mouse'
    };
  }

  /**
   * Extraer productos y cantidades del texto
   */
  parseOrder(text) {
    try {
      logger.debug('Parseando texto de pedido', { text });
      
      const normalizedText = this._normalizeText(text);
      
      // Extraer items del pedido
      const items = this._extractItems(normalizedText);
      
      // Extraer información adicional
      const info = {
        items,
        direccion: this._extractAddress(normalizedText),
        fecha: this._extractDate(normalizedText),
        hora: this._extractTime(normalizedText),
        metodoPago: this._extractPaymentMethod(normalizedText)
      };
      
      logger.debug('Resultado del parseo', info);
      return info;
    } catch (error) {
      logger.error('Error al parsear pedido', error);
      return { items: [], direccion: null, fecha: null, hora: null, metodoPago: null };
    }
  }

  /**
   * Normalizar texto (minúsculas, quitar acentos, etc.)
   */
  _normalizeText(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
      .replace(/[^\w\s,\.]/g, '') // Quitar caracteres especiales
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extraer items (productos y cantidades)
   */
  _extractItems(text) {
    const items = [];
    
    // Patrones mejorados para detectar cantidades y productos
    const patterns = [
      // "2 panes", "3 kg de arroz", "1 litro de leche"
      /(\d+(?:\.\d+)?)\s*([a-z]+)?\s+([a-z\s]+?)(?=\s+y\s+|,|\s+para\s+|$)/gi,
      // "dos panes", "tres yogurts", "un par de zapatos"
      /(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|un|una|par|pareja|docena|media\s+docena)\s+([a-z\s]+?)(?=\s+y\s+|,|\s+para\s+|$)/gi,
      // "medio kilo", "1/2 kg", "cuarto de litro"
      /(medio|media|cuarto|un cuarto)\s+([a-z]+)?\s+([a-z\s]+?)(?=\s+y\s+|,|$)/gi
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        let cantidad = 1;
        let unidad = null;
        let producto = '';
        
        if (match[1]) {
          // Cantidad numérica
          cantidad = parseFloat(match[1]);
          unidad = match[2] ? this._normalizeUnidad(match[2]) : null;
          producto = (match[3] || '').trim();
        } else if (match[1] && !match[2]) {
          // Cantidad en palabras
          cantidad = this._parseCantidad(match[1]);
          producto = text.substring(match.index + match[0].length).trim();
        }
        
        // Limpiar producto
        producto = producto.replace(/^(de|del|la|las|el|los|un|una)\s+/i, '').trim();
        producto = this._normalizeProductName(producto);
        
        if (cantidad > 0 && producto.length > 2) {
          items.push({
            cantidad,
            unidad: unidad || 'un',
            producto,
            query: `${producto} ${unidad ? unidad : ''}`.trim()
          });
        }
      }
    }
    
    // Si no se encontraron items con cantidad, buscar solo nombres de productos
    if (items.length === 0) {
      // Intentar extraer productos sin cantidad explícita
      const productos = text.split(/\s+y\s+|\s*,\s*/i);
      for (const prod of productos) {
        const limpio = prod.trim().replace(/^(quiero|necesito|deseo|me gustaria|quisiera|pidiendo|pedir|ordenar|comprar)\s+/i, '');
        if (limpio.length > 2) {
          items.push({
            cantidad: 1,
            unidad: 'un',
            producto: this._normalizeProductName(limpio),
            query: this._normalizeProductName(limpio)
          });
        }
      }
    }
    
    return items;
  }
  
  /**
   * Normalizar nombre de producto: quitar stopwords, singularizar simple y aplicar sinónimos
   */
  _normalizeProductName(name) {
    const stop = new Set(['de','del','la','el','las','los','para','por','con','a','en','y','o']);
    let s = this._normalizeText(name);
    const tokens = s.split(' ').filter(t => !stop.has(t));
    const singular = tokens.map(t => this._singularize(t));
    const mapped = singular.map(t => this.synonyms[t] || t);
    return mapped.join(' ').trim();
  }
  
  _singularize(token) {
    // Reglas simples de singularización en español para usos comunes
    if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
    if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
    return token;
  }
  
  /**
   * Normalizar unidad de medida
   */
  _normalizeUnidad(unidad) {
    const normalizada = unidad.toLowerCase().trim();
    return this.unidadesMedida[normalizada] || normalizada;
  }

  /**
   * Parsear cantidad (número o palabra)
   */
  _parseCantidad(cantidadStr) {
    const numero = parseInt(cantidadStr);
    if (!isNaN(numero)) {
      return numero;
    }
    
    const normalizado = cantidadStr.toLowerCase().trim();
    return this.palabrasANumeros[normalizado] || 1;
  }

  /**
   * Extraer dirección del texto (mejorado para direcciones peruanas)
   */
  _extractAddress(text) {
    const addressPatterns = [
      // "dirección en Av. Larco 123"
      /(?:direccion|entregar|enviar|envio|a domicilio|domicilio)(?:\s+en|\s+a|\s+es)?\s+([^,.]+?)(?:\.|,|$|\s+para)/i,
      // "Av. Larco 123", "Jr. Lampa 456", "Calle Las Flores"
      /(?:av|avenida|calle|jr|jiron|psje|pasaje|mz|manzana|lote|urbanizacion|urb|distrito)\.?\s+([a-z0-9\s]+?)(?:\.|,|$|\s+para)/i,
      // "en Lima", "en San Isidro", "en Miraflores"
      /(?:en|a|para)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\.|,|$)/,
      // Direcciones con números "Calle 28 de Julio 123"
      /(?:calle|av|avenida|jr|jiron|psje|pasaje)\.?\s+([0-9\s]+(?:°|ª)?\s+(?:de\s+)?[a-z]+(?:\s+[0-9]+)?)/i
    ];
    
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match) {
        const direccion = (match[1] || match[2] || '').trim();
        if (direccion.length > 3) {
          return direccion;
        }
      }
    }
    
    return null;
  }

  /**
   * Extraer fecha del texto
   */
  _extractDate(text) {
    const datePatterns = [
      /(?:para|el|dia)\s+(hoy|manana|pasado manana)/i,
      /(?:para|el)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)/i,
      /(\d{1,2})\s*\/\s*(\d{1,2})/
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        return this._parseDateString(match[1], match[2]);
      }
    }
    
    return null;
  }

  /**
   * Parsear string de fecha a objeto Date
   */
  _parseDateString(day, month = null) {
    const today = new Date();
    
    const daysMap = {
      'hoy': 0,
      'manana': 1,
      'pasado manana': 2,
      'lunes': 1, 'martes': 2, 'miercoles': 3,
      'jueves': 4, 'viernes': 5, 'sabado': 6, 'domingo': 0
    };
    
    if (daysMap[day] !== undefined) {
      const targetDay = daysMap[day];
      const result = new Date(today);
      
      if (day === 'hoy' || day === 'manana' || day === 'pasado manana') {
        result.setDate(today.getDate() + daysMap[day]);
      } else {
        // Día de la semana
        let daysToAdd = targetDay - today.getDay();
        if (daysToAdd <= 0) daysToAdd += 7;
        result.setDate(today.getDate() + daysToAdd);
      }
      
      return result;
    }
    
    if (month) {
      const result = new Date(today.getFullYear(), parseInt(month) - 1, parseInt(day));
      return result;
    }
    
    return null;
  }

  /**
   * Extraer hora del texto
   */
  _extractTime(text) {
    const timePatterns = [
      /(\d{1,2})\s*(?::|h)\s*(\d{2})\s*(am|pm)?/i,
      /a\s+las?\s+(\d{1,2})\s*(am|pm)?/i,
      /(mediodia|medianoche)/i
    ];
    
    for (const pattern of timePatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[0].includes('mediodia')) return '12:00 PM';
        if (match[0].includes('medianoche')) return '12:00 AM';
        
        const hour = match[1];
        const minute = match[2] || '00';
        const period = match[3] || '';
        
        return `${hour}:${minute} ${period}`.trim();
      }
    }
    
    return null;
  }

  /**
   * Extraer método de pago
   */
  _extractPaymentMethod(text) {
    const methods = {
      'yape': /yape/i,
      'plin': /plin/i,
      'efectivo': /efectivo|cash/i,
      'tarjeta': /tarjeta|visa|mastercard/i
    };
    
    for (const [method, pattern] of Object.entries(methods)) {
      if (pattern.test(text)) {
        return method.toUpperCase();
      }
    }
    
    return null;
  }

  /**
   * Detectar intención del mensaje
   */
  detectIntent(text) {
    const normalizedText = this._normalizeText(text);
    
    // Log para debugging
    logger.debug(`Detectando intención en texto: "${text}" -> normalizado: "${normalizedText}"`);
    
    const intents = {
      'greeting': /^(hola|hi|buenos dias|buenas tardes|buenas noches|hey|saludos|buen dia|buena tarde|buena noche)/i,
      'order': /(quiero|necesito|deseo|me gustaria|quisiera|pidiendo|pedir|ordenar|comprar)/i,
      'confirm': /^(si|confirmo|ok|vale|dale|correcto|exacto|confirmar)/i,
      'cancel': /(cancelar|no quiero|mejor no|olvidalo|no)/i,
      'paid': /(pague|pagado|ya pague|listo|transferi|pago realizado)/i,
      'help': /(ayuda|help|como|que puedo|opciones|soporte)/i,
      'catalog': /(productos|catalogo|que tienen|que venden|menu|lista|inventario)/i,
      'status': /(estado|pedido|orden|seguimiento|donde esta)/i
    };
    
    for (const [intent, pattern] of Object.entries(intents)) {
      if (pattern.test(normalizedText)) {
        logger.debug(`✅ Intención detectada: ${intent} (patrón: ${pattern})`);
        return intent;
      }
    }
    
    logger.debug(`⚠️ No se detectó ninguna intención, retornando 'unknown'`);
    return 'unknown';
  }
}

module.exports = new TextParser();

