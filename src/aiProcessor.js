const ollamaClient = require('./utils/ollamaClient');
const kardexApi = require('./kardexApi');
const kardexDb = require('./kardexDb');
const logger = require('./utils/logger');
const productCache = require('./utils/productCache');
const phonetics = require('./utils/phonetics');
const config = require('../config/config');
const textParser = require('./utils/textParser');

class AIProcessor {
  constructor() {
    this.systemPrompt = `Eres un asistente de ventas conversacional, amigable y muy comprensivo de KARDEX.
Tu objetivo: (1) CLASIFICAR la intención del cliente de forma natural y conversacional y (2) EXTRAER datos estructurados cuando corresponda.

IMPORTANTE: 
- Entiende el lenguaje natural y conversacional. El usuario puede hablar de forma coloquial, con errores de pronunciación (especialmente en voz), o de manera informal.
- Si el usuario dice cosas como "mm", "ehh", "ahh", "um", ignóralas (son pausas de voz).
- Si el usuario usa variaciones de palabras (ej: "lapto" en vez de "laptop", "maus" en vez de "mouse"), entiéndelas correctamente.
- Si el usuario mezcla español e inglés (ej: "mouse" y "ratón"), ambas son válidas.
- Si el usuario dice números de forma coloquial ("dos", "2", "do"), todas son válidas.
- Sé tolerante con errores de transcripción de voz y malas pronunciaciones.

INTENCIONES POSIBLES:
- "HACER_PEDIDO": Quiere comprar/agregar productos. Incluye: "quiero", "necesito", "dame", "me llevo", "comprar", "pedir", "agregar", "ponme", "traeme", "me gustaría", "quisiera", "estoy interesado", "vamos a comprar", "necesito comprar", "me interesa", "demen", "consigo", "me llevo", "vamos a comprar", "necesito comprar", "quisiera comprar", "me interesa", "estoy interesado", "quiero comprar"
- "VER_CATALOGO": Pide la lista de productos. Incluye: "catálogo", "catalogo", "productos", "producto", "lista", "ver productos", "quiero ver", "muestrame", "muéstrame", "mostrar", "ver catálogo", "ver catalogo", "que tienen", "qué tienen", "que venden", "qué venden", "muestrame productos", "mostrar productos", "ver lista", "quiero ver productos"
- "VER_PRODUCTO": Pide info de un producto particular. Incluye: "info de", "detalles de", "qué es", "cuéntame de", "información de", "datos de", "características de"
- "CONSULTAR_PRECIO": Pregunta el precio. Incluye: "cuánto cuesta", "cuanto cuesta", "precio", "vale", "cuesta", "a cuánto", "a cuanto", "cuánto sale", "cuanto sale", "cuál es el precio", "cual es el precio", "precio de", "cuánto vale", "cuanto vale", "a cuánto está", "a cuanto esta"
- "CONSULTAR_STOCK": Pregunta disponibilidad. Incluye: "tienes", "hay", "disponible", "stock", "tienen", "queda", "tienes disponible", "hay disponible", "tienen stock", "hay stock", "queda stock", "tienes en stock", "hay en stock"
- "VER_PEDIDO": Quiere ver su pedido actual. Incluye: "mi pedido", "pedido actual", "orden actual", "ver pedido actual", "que tengo", "qué tengo", "que pedi", "qué pedí", "ver mi pedido", "mostrar pedido", "listar pedido", "productos del pedido", "qué tengo en el pedido", "estado", "status", "ver pedido", "ver mi orden"
- "CANCELAR": Quiere cancelar, salir, volver al inicio, empezar de nuevo, terminar. Incluye: "cancelar", "salir", "no quiero", "déjalo", "dejalo", "olvídalo", "olvidalo", "mejor no", "ya no", "no importa", "cancel", "volver", "atrás", "atras", "inicio", "empezar de nuevo", "comenzar de nuevo", "reiniciar", "resetear", "cerrar", "terminar", "acabar", "parar", "detener", "déjame en paz", "déjame tranquilo", "adiós", "adios", "chau", "bye"
- "SALIR": Quiere salir, cancelar, volver. Sinónimos de CANCELAR
- "VOLVER": Quiere volver al inicio, cancelar la operación actual. Sinónimos de CANCELAR
- "SALUDO": Es un saludo. Incluye: "hola", "hi", "hello", "buenos días", "buen dia", "buenas tardes", "buenas noches", "saludos", "que tal", "qué tal", "como estas", "como estás", "cómo estás", "hey", "oye", "buen", "buena"
- "AYUDA": Pide ayuda o comandos disponibles. Incluye: "ayuda", "help", "qué puedo hacer", "que puedo hacer", "opciones", "comandos", "cómo funciona", "como funciona", "que hago", "qué hago", "necesito ayuda", "ayúdame", "ayudame"
- "BUSCAR": Búsqueda de productos con filtros. Incluye: "buscar", "filtrar", "productos baratos", "menos de X", "con stock", "disponibles", "productos económicos", "productos caros", "productos entre X y Y", "solo disponibles", "solo con stock"
- "OTRO": No encaja en lo anterior

REGLAS DE EXTRACCIÓN PARA "HACER_PEDIDO":
- Extrae TODOS los productos y cantidades. Si no hay cantidad explícita, asume 1.
- Preserva el nombre tal como se menciona por el usuario (no inventes IDs/códigos).
- Si hay combos ("pack", "combo", "kit"), extrae componentes si se mencionan y cantidades.
- Si hay preferencias (marca, modelo) inclúyelas en el nombre.
- Extrae dirección/fecha/hora/métodoPago si se mencionan de forma explícita. Si no, deja null.

RESPUESTA: SOLO JSON VÁLIDO (sin texto adicional, sin markdown).
{
  "intencion": "HACER_PEDIDO" | "VER_CATALOGO" | "VER_PRODUCTO" | "CONSULTAR_PRECIO" | "CONSULTAR_STOCK" | "VER_PEDIDO" | "CANCELAR" | "SALIR" | "VOLVER" | "SALUDO" | "AYUDA" | "BUSCAR" | "OTRO",
  "productos": [
    {"nombre": "texto exacto del producto mencionado por el usuario (preservar variaciones coloquiales)", "cantidad": 1}
  ],
  "productoConsulta": "si aplica",
  "filtros": {
    "precioMaximo": null,
    "precioMinimo": null,
    "soloDisponibles": false,
    "categoria": null
  },
  "direccion": null,
  "fecha": null,
  "hora": null,
  "metodoPago": null
}

EJEMPLOS (NO incluir en la respuesta):
Usuario: "Quiero 2 laptops Lenovo i5 y un mouse inalámbrico"
JSON:
{"intencion":"HACER_PEDIDO","productos":[{"nombre":"laptops Lenovo i5","cantidad":2},{"nombre":"mouse inalámbrico","cantidad":1}],"productoConsulta":null,"direccion":null,"fecha":null,"hora":null,"metodoPago":null}

Usuario: "¿Tienen stock de impresora HP?"
JSON:
{"intencion":"CONSULTAR_STOCK","productos":[],"productoConsulta":"impresora HP","direccion":null,"fecha":null,"hora":null,"metodoPago":null}`;
  }

  /**
   * Procesar pedido desde texto (voz o texto escrito)
   * @param {string} text - Texto del pedido
   * @param {array} conversationHistory - Historial de conversación (opcional)
   */
  async processOrder(text, conversationHistory = []) {
    try {
      logger.info('Procesando pedido con IA', { textLength: text.length });

      // 0) Pre-parseo con reglas para ayudar al modelo y mejorar recall
      let preParsed = null;
      try {
        preParsed = textParser.parseOrder(text);
        logger.debug('Preparseo (reglas) completado', {
          items: preParsed?.items?.map(i => ({ nombre: i.nombre, cantidad: i.cantidad })) || []
        });
      } catch (ppErr) {
        logger.warn('Fallo preparseo, continuo solo con IA', { error: ppErr?.message });
      }

      // Verificar que Ollama esté disponible
      const isAvailable = await ollamaClient.isAvailable();
      if (!isAvailable) {
        throw new Error('Ollama no está disponible. Por favor, inicia el servicio.');
      }

      // Verificar que el modelo esté disponible
      const modelAvailable = await ollamaClient.checkModel();
      if (!modelAvailable) {
        throw new Error(`Modelo ${ollamaClient.model} no está disponible. Ejecuta: ollama pull ${ollamaClient.model}`);
      }

      // 1) Generar prompt enriquecido con candidatos detectados por reglas (si hay)
      const candidatesStr = preParsed?.items && preParsed.items.length > 0
        ? `\nCANDIDATOS_DETECTADOS:\n${preParsed.items.map(i => `- ${i.nombre} x${i.cantidad || 1}`).join('\n')}\n`
        : '\n';
      const prompt = `Analiza y responde en JSON válido.\n\nMENSAJE:\n"${text}"\n${candidatesStr}`;

      // Llamar a Ollama
      const extracted = await ollamaClient.generateJSON(prompt, this.systemPrompt, {
        temperature: 0.3
      });

      logger.info('📋 Información extraída por IA', {
        productosCount: extracted.productos?.length || 0,
        productos: extracted.productos?.map(p => ({ nombre: p.nombre, cantidad: p.cantidad })) || [],
        hasDireccion: !!extracted.direccion,
        hasFecha: !!extracted.fecha,
        hasHora: !!extracted.hora
      });

      // Verificar intención
      const intencion = extracted.intencion || 'HACER_PEDIDO';
      
      // Si no es intención de pedido, retornar para que el bot básico lo maneje
      if (intencion !== 'HACER_PEDIDO') {
        logger.info(`Intención detectada: ${intencion}, no es pedido`);
        return {
          success: false,
          intent: intencion,
          message: null // El bot básico manejará esto
        };
      }

      // 2) Unificar productos IA + pre-parser para mejorar cobertura
      const iaProductos = Array.isArray(extracted.productos) ? extracted.productos : [];
      const ruleProductos = Array.isArray(preParsed?.items)
        ? preParsed.items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad || 1 }))
        : [];
      const mergedByName = new Map();
      for (const p of [...iaProductos, ...ruleProductos]) {
        const key = (p.nombre || '').toLowerCase().trim();
        if (!key) continue;
        const prev = mergedByName.get(key);
        if (!prev) {
          mergedByName.set(key, { nombre: p.nombre, cantidad: parseInt(p.cantidad) || 1 });
        } else {
          prev.cantidad += parseInt(p.cantidad) || 1;
          mergedByName.set(key, prev);
        }
      }
      const mergedProductos = Array.from(mergedByName.values());

      // Validar estructura para pedidos
      if (!mergedProductos || mergedProductos.length === 0) {
        return {
          success: false,
          message: 'No pude identificar productos en tu mensaje. Por favor, menciona los productos que deseas.\n\n' +
            'Ejemplo: "Quiero una laptop y un mouse"'
        };
      }

      // Buscar productos en el catálogo
      const productosEncontrados = [];
      const productosNoEncontrados = [];

      const productosSinStock = [];
      for (const item of mergedProductos) {
        const nombre = this._normalizeName(item.nombre || item.nombre_producto || item.producto);
        const cantidad = parseInt(item.cantidad) || 1;

        logger.debug('Procesando producto extraído', { 
          item, 
          nombre, 
          cantidad,
          tipoNombre: typeof nombre
        });

        if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
          logger.warn('⚠️ Producto sin nombre válido, saltando', { item });
          continue;
        }

        // Intentar cache primero
        const cacheKey = `search:${nombre.toLowerCase()}`;
        let productos = productCache.get(cacheKey);

        if (!productos) {
          logger.info(`🔍 Buscando producto: "${nombre}"`);
          
          // Buscar en BD primero (más rápido)
          if (kardexDb.isConnected()) {
            logger.debug('Buscando en BD MySQL...');
            productos = await kardexDb.buscarProductos(nombre, 5);
            logger.debug(`Resultados BD: ${productos ? productos.length : 0}`);
          }

          // Si no hay resultados, usar API
          if (!productos || productos.length === 0) {
            logger.debug('Buscando en API REST...');
            productos = await kardexApi.buscarProductos(nombre);
            logger.debug(`Resultados API: ${productos ? productos.length : 0}`);
          }

          // Guardar en cache
          if (productos && productos.length > 0) {
            productCache.set(cacheKey, productos);
            logger.success(`✅ Producto encontrado: "${nombre}" -> ${productos[0].nombre}`);
          } else {
            logger.warn(`⚠️ Producto no encontrado: "${nombre}"`);
          }
        } else {
          logger.debug(`✅ Producto encontrado en cache: "${nombre}"`);
        }

        if (productos && productos.length > 0) {
          // Seleccionar el mejor match
          const mejorMatch = this._findBestMatch(nombre, productos);
          
          // Validar que el producto tenga un ID válido
          if (!mejorMatch.id || mejorMatch.id <= 0) {
            logger.error(`❌ Producto encontrado pero sin ID válido: "${mejorMatch.nombre}"`, mejorMatch);
            productosNoEncontrados.push(nombre);
            continue;
          }
          
          logger.info(`✅ Producto encontrado: "${nombre}" -> "${mejorMatch.nombre}" (ID: ${mejorMatch.id})`);
          
          productosEncontrados.push({
            producto_id: mejorMatch.id,
            nombre: mejorMatch.nombre,
            cantidad: cantidad,
            precio_unitario: mejorMatch.precio_venta || 0,
            stock_disponible: mejorMatch.stock_actual || 0
          });
        } else {
          logger.warn(`❌ Producto NO encontrado: "${nombre}"`);
          productosNoEncontrados.push(nombre);
        }
      }

      if (productosEncontrados.length === 0) {
        logger.error('❌ No se encontró ningún producto', {
          productosBuscados: productosNoEncontrados,
          totalExtraidos: extracted.productos.length
        });
        
        // Intentar obtener sugerencias inteligentes
        const productSuggestions = require('./utils/productSuggestions');
        let mensajeSugerencias = '';
        
        if (productosNoEncontrados.length > 0) {
          const primerProducto = productosNoEncontrados[0];
          const sugerencias = await productSuggestions.getSimilarProducts(primerProducto, 5);
          
          if (sugerencias && sugerencias.length > 0) {
            mensajeSugerencias = productSuggestions.formatSuggestions(
              sugerencias, 
              `No encontré "${primerProducto}" en nuestro catálogo`
            );
          } else {
            // Si no hay sugerencias similares, mostrar productos populares
            const populares = await productSuggestions.getPopularProducts(5);
            if (populares && populares.length > 0) {
              mensajeSugerencias = `No encontré "${primerProducto}" en nuestro catálogo.\n\n` +
                `💡 *Te sugiero estos productos populares:*\n\n` +
                populares.map((p, i) => 
                  `${i + 1}. *${p.nombre}* — S/ ${(parseFloat(p.precio_venta || 0)).toFixed(2)}`
                ).join('\n') +
                `\n\n💬 Escribe *"CATALOGO"* para ver más productos.`;
            } else {
              mensajeSugerencias = `No encontré estos productos en nuestro catálogo: ${productosNoEncontrados.join(', ')}\n\n` +
                '💡 *Sugerencias:*\n' +
                '• Verifica que el nombre del producto sea correcto\n' +
                '• Escribe "CATALOGO" para ver nuestros productos disponibles\n' +
                '• Intenta usar el nombre completo del producto';
            }
          }
        } else {
          mensajeSugerencias = 'No pude identificar productos en tu mensaje.\n\n' +
            '💡 *Puedes decirme cosas como:*\n' +
            '• "Quiero una laptop"\n' +
            '• "Necesito 2 mouses"\n' +
            '• "Dame un teclado"\n\n' +
            'O escribe *"CATALOGO"* para ver todos los productos.';
        }
        
        return {
          success: false,
          message: mensajeSugerencias,
          productosNoEncontrados: productosNoEncontrados
        };
      }

      // Calcular total y verificar stock
      let total = 0;
      const productosVerificados = [];
      
      for (const producto of productosEncontrados) {
        if (producto.stock_disponible < producto.cantidad) {
          productosSinStock.push({
            ...producto
          });
          continue;
        }
        
        const subtotal = producto.precio_unitario * producto.cantidad;
        total += subtotal;
        
        productosVerificados.push({
          producto_id: producto.producto_id,
          nombre: producto.nombre,
          cantidad: producto.cantidad,
          precio_unitario: producto.precio_unitario,
          subtotal: subtotal
        });
      }

      // Construir respuesta exitosa para agregar productos
      return {
        success: true,
        action: 'add_products_to_order',
        productos: productosVerificados,
        total: total,
        direccion: extracted.direccion || preParsed?.direccion || null,
        fecha: extracted.fecha || preParsed?.fecha || null,
        hora: extracted.hora || preParsed?.hora || null,
        metodoPago: extracted.metodoPago || preParsed?.metodoPago || null,
        productosNoEncontrados: productosNoEncontrados.length > 0 ? productosNoEncontrados : null,
        productosSinStock: productosSinStock.length > 0 ? productosSinStock : null
      };
    } catch (error) {
      logger.error('Error al procesar pedido con IA', error);
      
      if (error.message.includes('Ollama no está disponible') || error.message.includes('no está disponible')) {
        return {
          success: false,
          message: 'El servicio de procesamiento inteligente no está disponible en este momento.\n\n' +
            'Por favor, intenta hacer tu pedido de forma más específica o contacta con soporte.'
        };
      }

      return {
        success: false,
        message: 'Hubo un error al procesar tu pedido. Por favor, intenta de nuevo o describe tu pedido de forma más específica.'
      };
    }
  }

  /**
   * Encontrar el mejor match de producto
   */
  _findBestMatch(query, productos) {
    const normalizedQuery = this._normalizeName(query);
    let best = productos[0];
    let bestScore = this._combinedSimilarity(normalizedQuery, this._normalizeName(productos[0].nombre));
    for (const p of productos.slice(1)) {
      const score = this._combinedSimilarity(normalizedQuery, this._normalizeName(p.nombre));
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    // Aplicar umbral
    const threshold = config.matching?.threshold || 0.65;
    if (bestScore < threshold) {
      logger.warn(`Score bajo (${bestScore.toFixed(2)} < ${threshold}) para "${query}" -> "${best.nombre}"`);
      return { id: null, nombre: query }; // forzar no match
    }
    return best;
  }

  /**
   * Normalizar nombres (lowercase, sin tildes, quitar stopwords comunes)
   */
  _normalizeName(name) {
    if (!name) return '';
    const s = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const stop = new Set(['de','del','la','el','para','por','con','y','en','una','un','unos','unas']);
    return s.split(' ').filter(w => !stop.has(w)).join(' ');
  }

  /**
   * Similaridad combinada: contiene, Jaccard de tokens y Levenshtein normalizado
   */
  _combinedSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.9;
    const j = this._jaccard(s1, s2);
    const l = this._levenshteinSimilarity(s1, s2);
    const p = phonetics.phoneticSimilarity(s1, s2);
    const pw = config.matching?.phoneticWeight || 0.2;
    // Rebalancear pesos: jaccard 0.5, levenshtein 0.3, fonético pw
    const base = (0.5 * j) + (0.3 * l);
    return Math.min(1, base + (pw * p));
  }

  _jaccard(a, b) {
    const ta = new Set(a.split(' '));
    const tb = new Set(b.split(' '));
    const inter = new Set([...ta].filter(x => tb.has(x)));
    const uni = new Set([...ta, ...tb]);
    return uni.size === 0 ? 0 : inter.size / uni.size;
  }

  /**
   * Similaridad Levenshtein (normalizada 0..1)
   */
  _levenshteinSimilarity(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0 && len2 === 0) return 1;
    if (len1 === 0 || len2 === 0) return 0;
    
    const matrix = [];
    
    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2[i - 1] === str1[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    const distance = matrix[len2][len1];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
  }
}

module.exports = new AIProcessor();

