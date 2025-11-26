const ollamaClient = require('./utils/ollamaClient');
const logger = require('./utils/logger');
const kardexApi = require('./kardexApi');
const kardexDb = require('./kardexDb');

class ProductExtractorAI {
  constructor() {
    this.systemPrompt = `Eres un analizador inteligente de mensajes. Cada cliente se comunica de forma diferente.

TU TAREA:
Analizar CADA mensaje de forma individual, entendiendo:
- Qué producto está buscando este cliente específico
- Cómo se está expresando (puede tener errores de transcripción)
- Cuál es su intención real
- Qué información necesita extraer

ANÁLISIS PASO A PASO:
1. Lee el mensaje completo y entiende su significado
2. Identifica el producto mencionado (puede tener errores de transcripción)
3. Corrige errores basándote en el contexto y sentido común
4. Determina la intención del cliente (precio, stock, pedido, etc.)
5. Extrae información relevante: producto, marca, tipo

CORRECCIONES INTELIGENTES:
- Analiza el contexto para entender errores de transcripción
- Corrige basándote en el sentido del mensaje, no en patrones
- Normaliza términos según el contexto

PRINCIPIOS:
- Cada cliente es diferente, analiza cada mensaje como único
- No memorices patrones, entiende el significado
- Piensa antes de extraer información

Responde SOLO con JSON válido:
{
  "producto": "nombre del producto que este cliente busca (corregido si hay errores)",
  "intencion": "CONSULTAR_PRECIO" | "CONSULTAR_STOCK" | "HACER_PEDIDO" | "OTRO",
  "marca": "marca mencionada o null",
  "tipo": "tipo de producto mencionado o null"
}

IMPORTANTE: Analiza este mensaje específico de forma individual.`;
  }

  /**
   * Extraer información del producto usando IA
   * @param {string} userMessage - Mensaje del usuario
   */
  async extractProductInfo(userMessage) {
    try {
      // Verificar que Ollama esté disponible
      const isAvailable = await ollamaClient.isAvailable();
      if (!isAvailable) {
        logger.warn('Ollama no disponible, usando extracción básica');
        return this._extractBasic(userMessage);
      }

      const prompt = `Analiza este mensaje específico de este cliente. Cada cliente se comunica diferente.

Mensaje de este cliente: "${userMessage}"

ANÁLISIS INDIVIDUAL (piensa paso a paso):

PASO 1 - ENTENDER EL MENSAJE:
- ¿Qué está diciendo este cliente específicamente?
- ¿Cómo se está expresando? (formal, informal, coloquial, etc.)
- ¿Qué palabras clave relacionadas con productos menciona?
- ¿Cuál es su intención real? (precio, stock, pedido, información general)

PASO 2 - CORREGIR ERRORES DE TRANSCRIPCIÓN:
- Analiza si hay palabras que parecen errores (ej: "a dira" podría ser "adidas")
- Corrige basándote en el contexto y sentido común de ESTE mensaje
- Normaliza términos según el contexto específico

PASO 3 - EXTRAER INFORMACIÓN:
- ¿Qué producto está buscando este cliente?
- ¿Menciona alguna marca?
- ¿Qué tipo de producto es?
- ¿Cuál es su intención específica?

IMPORTANTE:
- Este cliente es único, analiza su mensaje de forma individual
- No asumas, analiza el mensaje completo
- Piensa antes de extraer información

Responde SOLO con JSON válido (sin explicaciones adicionales):`;

      logger.info('Extrayendo información de producto con IA', {
        message: userMessage.substring(0, 50)
      });

      // Generar respuesta con Ollama - temperatura balanceada para análisis inteligente
      const response = await ollamaClient.generateJSON(prompt, this.systemPrompt, {
        temperature: 0.5 // Balance entre precisión y análisis creativo (no memorización)
      });

      if (response && response.producto) {
        logger.success('✅ Información extraída por IA', {
          producto: response.producto,
          intencion: response.intencion,
          marca: response.marca
        });
        return response;
      }

      // Fallback a extracción básica
      return this._extractBasic(userMessage);

    } catch (error) {
      logger.error('Error al extraer información con IA', error);
      return this._extractBasic(userMessage);
    }
  }

  /**
   * Extracción básica sin IA
   */
  _extractBasic(userMessage) {
    const normalized = userMessage.toLowerCase().trim();
    
    // Detectar intención
    let intencion = 'OTRO';
    if (/(?:cuánto|cuanto|precio|vale|cuesta|a cuánto|a cuanto|cuánto sale|cuanto sale|cuánto vale|cuanto vale|precio de|cuál es el precio|cual es el precio|cuánto está|cuanto esta)/i.test(normalized)) {
      intencion = 'CONSULTAR_PRECIO';
    } else if (/(?:tienes|hay|disponible|stock|tienen|queda)/i.test(normalized)) {
      intencion = 'CONSULTAR_STOCK';
    } else if (/(?:quiero|necesito|pedir|comprar|dame|deme)/i.test(normalized)) {
      intencion = 'HACER_PEDIDO';
    }

    // Extraer producto básico
    const producto = this._extractProductNameBasic(userMessage);

    return {
      producto: producto || '',
      intencion,
      marca: null,
      tipo: null
    };
  }

  /**
   * Extraer nombre del producto (método básico)
   */
  _extractProductNameBasic(text) {
    if (!text || text.trim().length === 0) return null;
    
    const normalized = text.toLowerCase().trim();
    
    // Corregir errores comunes de transcripción
    let corrected = normalized
      .replace(/\ba dira\b/gi, 'adidas')
      .replace(/\bil balon\b/gi, 'el balón')
      .replace(/\bpelota\b/gi, 'balón')
      .replace(/\bfutbol\b/gi, 'fútbol')
      .replace(/\bfutbol\b/gi, 'fútbol');
    
    // Extraer después de palabras clave
    const patterns = [
      /(?:cuánto|cuanto|precio|vale|cuesta|a cuánto|a cuanto|cuánto sale|cuanto sale|cuánto vale|cuanto vale|precio de|cuál es el precio|cual es el precio|cuánto está|cuanto esta|cuánto esta|cuanto está)\s+(?:de|del|la|el)?\s*(?:un|una|unos|unas)?\s*([^?]+?)(?:\?|$)/i,
      /(?:tienes|hay|disponible|stock|tienen|queda)\s+(?:de|del|la|el)?\s*(?:un|una|unos|unas)?\s*([^?]+?)(?:\?|$)/i,
      /(?:un|una|unos|unas|el|la|los|las)\s+([^?]+?)(?:\?|$)/i
    ];
    
    for (const pattern of patterns) {
      const match = corrected.match(pattern);
      if (match && match[1]) {
        let productName = match[1].trim()
          .replace(/\b(estaba|está|es|ser|fue|están|son|pregunta|una pregunta|hola|por favor|que me digas|necesito|quiero)\b/gi, '')
          .replace(/[¿?¡!.,;:"]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (productName.length >= 3) {
          return productName;
        }
      }
    }
    
    return null;
  }

  /**
   * Buscar producto usando la información extraída
   */
  async searchProduct(productInfo) {
    try {
      const { producto, marca, tipo } = productInfo;
      
      if (!producto || producto.length < 2) {
        logger.warn('No hay producto para buscar');
        return null;
      }

      logger.info(`🔍 Buscando producto: "${producto}"`, { marca, tipo });

      // Generar múltiples variaciones de búsqueda
      const searchTerms = new Set();
      
      // Término original
      searchTerms.add(producto);
      
      // Variaciones con marca y tipo
      if (marca && tipo) {
        searchTerms.add(`${tipo} ${marca}`);
        searchTerms.add(`${marca} ${tipo}`);
        if (tipo === 'balón' || tipo === 'pelota') {
          searchTerms.add(`balón de fútbol ${marca}`);
          searchTerms.add(`${marca} balón`);
        }
      }
      
      // Solo marca
      if (marca) {
        searchTerms.add(marca);
        if (tipo === 'balón' || tipo === 'pelota') {
          searchTerms.add(`balón ${marca}`);
        }
        if (tipo === 'camiseta') {
          searchTerms.add(`camiseta ${marca}`);
        }
      }
      
      // Solo tipo
      if (tipo) {
        searchTerms.add(tipo);
        if (tipo === 'balón' || tipo === 'pelota') {
          searchTerms.add('balón de fútbol');
        }
      }
      
      // Palabras clave del producto original
      const palabras = producto.split(/\s+/).filter(p => p.length > 3);
      palabras.forEach(palabra => searchTerms.add(palabra));
      
      // Si tiene "cafetera" o "espresso", buscar variaciones
      if (producto.includes('cafetera') || producto.includes('espresso') || producto.includes('expreso')) {
        searchTerms.add('cafetera');
        searchTerms.add('cafetera espresso');
        searchTerms.add('cafetera express');
      }

      const searchArray = Array.from(searchTerms).filter(term => term && term.length >= 2);
      logger.info(`Buscando con ${searchArray.length} términos diferentes`);

      let productosEncontrados = null;

      // Buscar con cada término
      for (const term of searchArray) {
        logger.info(`Buscando con término: "${term}"`);

        // Buscar en BD primero
        if (kardexDb.isConnected()) {
          try {
            productosEncontrados = await kardexDb.buscarProductos(term, 10);
            if (productosEncontrados && productosEncontrados.length > 0) {
              logger.success(`✅ Encontrado en BD con término: "${term}" (${productosEncontrados.length} resultados)`);
              break;
            }
          } catch (error) {
            logger.warn('Error al buscar en BD', error);
          }
        }

        // Si no encontró en BD, buscar en API
        if (!productosEncontrados || productosEncontrados.length === 0) {
          try {
            productosEncontrados = await kardexApi.buscarProductos(term);
            if (productosEncontrados && productosEncontrados.length > 0) {
              logger.success(`✅ Encontrado en API con término: "${term}" (${productosEncontrados.length} resultados)`);
              break;
            }
          } catch (error) {
            logger.warn('Error al buscar en API', error);
          }
        }
      }

      if (productosEncontrados && productosEncontrados.length > 0) {
        // Seleccionar el mejor match
        const bestMatch = this._findBestMatch(producto, productosEncontrados);
        logger.success(`✅ Mejor match: "${bestMatch.nombre}"`);
        return bestMatch;
      }

      logger.warn(`⚠️ No se encontró producto con: "${producto}" después de ${searchArray.length} búsquedas`);
      return null;

    } catch (error) {
      logger.error('Error al buscar producto', error);
      return null;
    }
  }

  /**
   * Encontrar el mejor match entre productos encontrados
   */
  _findBestMatch(query, productos, marca = null, tipo = null) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const marcaLower = marca ? marca.toLowerCase() : null;
    const tipoLower = tipo ? tipo.toLowerCase() : null;

    // Calcular score para cada producto
    const scored = productos.map(producto => {
      const nombreLower = (producto.nombre || '').toLowerCase();
      let score = 0;

      // Puntos por coincidencia exacta del query completo
      if (nombreLower.includes(queryLower)) {
        score += 20;
      }

      // Puntos por coincidencia exacta de palabras clave importantes
      if (queryLower.includes('balón') && nombreLower.includes('balón')) {
        score += 10;
      }
      if (queryLower.includes('pelota') && nombreLower.includes('balón')) {
        score += 10; // "pelota" = "balón"
      }
      if (queryLower.includes('fútbol') && nombreLower.includes('fútbol')) {
        score += 8;
      }
      if (queryLower.includes('futbol') && nombreLower.includes('fútbol')) {
        score += 8; // "futbol" = "fútbol"
      }

      // Puntos por marca si se mencionó
      if (marcaLower) {
        if (nombreLower.includes(marcaLower)) {
          score += 15;
        }
        // Correcciones de marca
        if ((queryLower.includes('a dira') || queryLower.includes('a vidas')) && nombreLower.includes('adidas')) {
          score += 15;
        }
      }

      // Puntos por tipo si se mencionó
      if (tipoLower) {
        if (nombreLower.includes(tipoLower)) {
          score += 8;
        }
        // Sinónimos
        if (tipoLower === 'pelota' && nombreLower.includes('balón')) {
          score += 8;
        }
      }

      // Puntos por palabras comunes
      queryWords.forEach(word => {
        if (nombreLower.includes(word)) {
          score += 3;
        }
      });

      // Puntos adicionales por marcas conocidas
      if (nombreLower.includes('adidas') && (queryLower.includes('adidas') || queryLower.includes('a dira') || queryLower.includes('a vidas'))) {
        score += 10;
      }
      if (nombreLower.includes('nike') && queryLower.includes('nike')) {
        score += 10;
      }

      return { producto, score };
    });

    // Ordenar por score y devolver el mejor
    scored.sort((a, b) => b.score - a.score);
    
    logger.info(`Mejores matches:`, scored.slice(0, 3).map(s => ({
      nombre: s.producto.nombre,
      score: s.score
    })));
    
    return scored[0].producto;
  }
}

module.exports = new ProductExtractorAI();

