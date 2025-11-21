const logger = require('./utils/logger');
const kardexApi = require('./kardexApi');
const kardexDb = require('./kardexDb');
const config = require('../config/config');
const productCache = require('./utils/productCache');
const { normalize: normalizePhon, soundexEs } = require('./utils/phonetics');
const productSuggestions = require('./utils/productSuggestions');

class BasicBot {
  constructor() {
    this.commands = {
      greeting: ['hola', 'hi', 'hello', 'buenos', 'buenas', 'saludos', 'que tal', 'qué tal', 'como estas', 'como estás', 'buen dia', 'buen día', 'buenas tardes', 'buenas noches', 'hey', 'oye', 'buen', 'buena'],
      catalog: ['catalogo', 'catálogo', 'productos', 'producto', 'lista', 'ver productos', 'quiero ver', 'muestrame', 'muéstrame', 'mostrar', 'ver catálogo', 'ver catalogo', 'que tienen', 'qué tienen', 'que venden', 'qué venden'],
      help: ['ayuda', 'help', 'comandos', 'que puedo hacer', 'qué puedo hacer', 'opciones', 'como funciona', 'cómo funciona', 'que hago', 'qué hago', 'necesito ayuda', 'ayúdame', 'ayudame'],
      status: ['estado', 'status', 'mi pedido', 'pedido', 'orden', 'ver pedido', 'ver mi pedido', 'mostrar pedido', 'listar pedido', 'productos del pedido', 'qué tengo en el pedido', 'que tengo', 'qué tengo'],
      cancel: ['cancelar', 'cancel', 'no quiero', 'no gracias', 'salir', 'salirme', 'volver', 'volver atrás', 'volver atras', 'volver al inicio', 'inicio', 'empezar de nuevo', 'comenzar de nuevo', 'reiniciar', 'resetear', 'cerrar', 'terminar', 'acabar', 'parar', 'detener', 'no', 'mejor no', 'déjalo', 'dejalo', 'no importa', 'olvídalo', 'olvidalo', 'déjame en paz', 'déjame tranquilo', 'adiós', 'adios', 'chau', 'bye']
    };
    this.categoryKeywords = [
      // categorías comunes de tecnología
      'laptop', 'laptops', 'notebook', 'portátil', 'portatiles',
      'tecnologico', 'tecnologicos', 'tecnología',
      'audifono', 'audifonos', 'auricular', 'auriculares',
      'mouse', 'teclado', 'monitor', 'impresora', 'celular', 'celulares',
      'sony', 'apple', 'samsung', 'xiaomi', 'lenovo', 'hp', 'dell'
    ];
  }

  /**
   * Procesar mensaje de texto con reglas simples
   */
  async processMessage(text, sessionState = {}) {
    const normalizedText = text.toLowerCase().trim();
    
    logger.info('Bot básico procesando mensaje', { text: normalizedText });

    // Detectar intención básica
    const intentResult = this._detectIntent(normalizedText);
    const intent = typeof intentResult === 'object' && intentResult.intent ? intentResult.intent : intentResult;
    
    switch (intent) {
      case 'greeting':
        return this._handleGreeting(sessionState);
      
      case 'catalog':
        return await this._handleCatalog();
      
      case 'category_browse':
        return await this._handleCategoryOrSearch(text);

      case 'help':
        return this._handleHelp(sessionState);
      
      case 'status':
      case 'ver_pedido':
        return { action: 'view_order' };
      
      case 'historial_pedidos':
        return { action: 'view_order_history' };
      
      case 'ver_factura':
        return { action: 'view_invoice' };
      
      case 'ver_compra':
        const pedidoId = typeof intentResult === 'object' && intentResult.pedidoId ? intentResult.pedidoId : null;
        return { action: 'view_purchase_detail', pedidoId: pedidoId };
      
      case 'modificar_perfil':
        return { action: 'modify_profile' };
      
      case 'update_profile':
        const field = typeof intentResult === 'object' && intentResult.field ? intentResult.field : null;
        return { action: 'update_profile_field', field: field };
      
      case 'estado_cuenta':
        return { action: 'view_account_status' };
      
      case 'deploy_status':
        return this._handleDeployStatus();
      
      case 'cancel':
        return { action: 'cancel_order' };
      
      case 'cancel_confirmed_order':
        const cancelPedidoId = typeof intentResult === 'object' && intentResult.pedidoId ? intentResult.pedidoId : null;
        return { action: 'cancel_confirmed_order', pedidoId: cancelPedidoId };
      
      case 'price_inquiry':
        return await this._handlePriceInquiry(text, sessionState);
      
      case 'stock_inquiry':
        return await this._handleStockInquiry(text, sessionState);
      
      case 'advanced_search':
        return await this._handleAdvancedSearch(text, sessionState);
      
      case 'yape_payment':
        return await this._handleYapePayment(sessionState, sessionState.phoneNumber);
      
      case 'plin_payment':
        return await this._handlePlinPayment(sessionState, sessionState.phoneNumber);
      
      case 'remove_product':
        return { action: 'remove_product', productName: this._extractProductNameFromRemove(text) };
      
      case 'confirm_order':
        return { action: 'confirm_order' };
      
      case 'list_order_items':
        return { action: 'list_order_items' };
      
      case 'modify_order':
        if (typeof intentResult === 'object' && intentResult.action === 'change_quantity') {
          return { 
            action: 'update_product_quantity',
            productName: intentResult.productName,
            newQuantity: intentResult.newQuantity
          };
        }
        return { action: 'modify_order' };
      
      default:
        // Si no se detecta intención clara, sugerir usar voz para pedidos
        return this._handleUnknown(sessionState);
    }
  }

  /**
   * Detectar intención básica
   */
  _detectIntent(text) {
    const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    
    // Saludos (más variaciones)
    const greetingPatterns = [
      /^(hola|hi|hello|buenos|buenas|saludos|que tal|qué tal|como estas|como estás|buen dia|buen día|buenas tardes|buenas noches)/i,
      /^(hey|oye|buen|buena)/i
    ];
    if (this.commands.greeting.some(cmd => textLower.includes(cmd)) || 
        greetingPatterns.some(pattern => pattern.test(textLower))) {
      return 'greeting';
    }

    // Catálogo (más variaciones)
    if (this.commands.catalog.some(cmd => textLower.includes(cmd)) ||
        textLower.match(/(quiero ver|ver|muestrame|muéstrame|mostrar|ver catálogo|ver catalogo|que tienen|qué tienen|que venden|qué venden)/i)) {
      return 'catalog';
    }

    // Ver categoría/listado: "quiero ver laptops", "ver celulares", o texto que es claramente una categoría
    const catRegex = /(quiero ver|ver|muéstrame|muestrame|mostrar|ver catálogo de)\s+([a-záéíóúñ\s]{3,})/i;
    if (catRegex.test(text)) {
      return 'category_browse';
    }
    // Texto corto que coincide con palabras de categoría también dispara browse
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length <= 4 && this.categoryKeywords.some(k => text.includes(k))) {
      return 'category_browse';
    }

    // Ayuda (más variaciones)
    if (this.commands.help.some(cmd => textLower.includes(cmd)) ||
        textLower.match(/(necesito ayuda|ayúdame|ayudame|que puedo hacer|qué puedo hacer|como funciona|cómo funciona|que hago|qué hago)/i)) {
      return 'help';
    }

    // Historial de pedidos/compras
    if (text.match(/(historial|mis pedidos|mis compras|pedidos anteriores|compras anteriores|ver pedidos|ver compras)/i)) {
      return 'historial_pedidos';
    }

    // Ver facturas
    if (text.match(/(mis facturas|facturas|ver factura|ver facturas|comprobantes)/i)) {
      return 'ver_factura';
    }

    // Modificar perfil
    if (text.match(/(?:modificar|actualizar|cambiar|editar)\s+(?:mi\s+)?(?:perfil|datos|informaci[oó]n)/i)) {
      return 'modificar_perfil';
    }

    // Cambiar teléfono
    if (text.match(/(?:cambiar|modificar|actualizar|editar)\s+(?:mi\s+)?(?:tel[ée]fono|telefono|n[úu]mero)/i)) {
      return { intent: 'update_profile', field: 'telefono' };
    }

    // Cambiar dirección
    if (text.match(/(?:cambiar|modificar|actualizar|editar)\s+(?:mi\s+)?(?:direcci[oó]n|direccion|dir)/i)) {
      return { intent: 'update_profile', field: 'direccion' };
    }

    // Cambiar email
    if (text.match(/(?:cambiar|modificar|actualizar|editar)\s+(?:mi\s+)?(?:email|correo|e-mail)/i)) {
      return { intent: 'update_profile', field: 'email' };
    }

    // Ver estado de cuenta
    if (text.match(/(?:mi\s+)?(?:cuenta|estado de cuenta|mis datos|mi informaci[oó]n)/i)) {
      return 'estado_cuenta';
    }

    // Ver detalle de pedido específico (número de pedido)
    const pedidoMatch = text.match(/(?:ver|detalle|detalles?|mostrar)\s+(?:pedido|compra|orden|venta|factura)\s*(?:n[úu]mero|n[°º]|#)?\s*(\d+)/i);
    if (pedidoMatch && pedidoMatch[1]) {
      return { intent: 'ver_compra', pedidoId: pedidoMatch[1] };
    }

    // Estado / Ver pedido actual (más variaciones)
    if (textLower.match(/(estado|status|mi pedido|pedido actual|orden actual|ver pedido actual|que tengo|qué tengo|que pedi|qué pedí|que pedí|qué pedí|ver mi pedido|mostrar pedido|listar pedido|productos del pedido|qué tengo en el pedido|ver pedido|ver mi orden)/i)) {
      return 'ver_pedido';
    }

    // Estado de despliegue / sistema
    if (text.match(/(deploy|despliegue|estado del sistema|vercel|railway)/i)) {
      return 'deploy_status';
    }

    // Cancelar pedido confirmado específico
    const cancelarPedidoMatch = text.match(/(?:cancelar|anular)\s+(?:pedido|pedido n[úu]mero|pedido n[°º]|pedido #)\s*(\d+)/i);
    if (cancelarPedidoMatch && cancelarPedidoMatch[1]) {
      return { intent: 'cancel_confirmed_order', pedidoId: cancelarPedidoMatch[1] };
    }

    // Cancelar (genérico)
    if (this.commands.cancel.some(cmd => textLower.includes(cmd))) {
      return 'cancel';
    }

    // Consulta de precio (más variaciones)
    if (textLower.match(/(precio|cuanto cuesta|cuánto cuesta|cuanto vale|cuánto vale|valor|price|cost|a cuánto|a cuanto|cuánto sale|cuanto sale|cuál es el precio|cual es el precio|precio de|a cuánto está|a cuanto esta)/i)) {
      return 'price_inquiry';
    }

    // Consulta de stock (más variaciones)
    if (textLower.match(/(stock|disponible|hay|tienes|tiene|inventario|tienes disponible|hay disponible|tienen stock|hay stock|queda stock|tienes en stock|hay en stock|queda|tienen)/i)) {
      return 'stock_inquiry';
    }

    // Búsqueda avanzada con filtros
    const precioMatch = text.match(/(?:menos de|hasta|máximo|maximo|máx|max)\s*(\d+)|(?:más de|desde|mínimo|minimo|mín|min)\s*(\d+)|(?:entre|rango)\s*(\d+)\s*(?:y|a|-)\s*(\d+)/i);
    if (precioMatch || text.match(/(?:productos?\s+)?(?:baratos?|económicos?|economicos?|caros?|costosos?)/i)) {
      return 'advanced_search';
    }

    // Solo disponibles/con stock
    if (text.match(/(?:solo|solamente|únicamente|unicamente)\s+(?:disponibles?|con\s+stock|que\s+tengan|que\s+haya)/i)) {
      return 'advanced_search';
    }

    // Solicitud de pago Yape (más variaciones)
    if (textLower.match(/(yape|pago yape|quiero yape|pagar con yape|pago por yape|pago yape|yape por favor|quiero pagar con yape|pago con yape)/i)) {
      return 'yape_payment';
    }

    // Solicitud de pago Plin (más variaciones)
    if (textLower.match(/(plin|pago plin|quiero plin|pagar con plin|pago por plin|pago plin|plin por favor|quiero pagar con plin|pago con plin)/i)) {
      return 'plin_payment';
    }

    // Eliminar producto del pedido (más variaciones)
    if (textLower.match(/(eliminar|quitar|remover|borrar|sacar|quita|elimina|borra|remueve)\s+(.+)/i)) {
      return 'remove_product';
    }

    // Cambiar cantidad de producto
    const cantidadMatch = text.match(/(?:cambiar|modificar|actualizar|poner|pon|ponerle)\s+(?:cantidad|cant|cuantidad)?\s+(?:de|del)?\s*(.+?)\s+(?:a|en|por|con)\s+(\d+)/i);
    if (cantidadMatch && cantidadMatch[1] && cantidadMatch[2]) {
      return { intent: 'modify_order', action: 'change_quantity', productName: cantidadMatch[1].trim(), newQuantity: parseInt(cantidadMatch[2]) };
    }

    // Ver pedido actual / lista de productos
    if (text.match(/(?:ver|mostrar|listar|mi pedido actual|productos del pedido|qué tengo en el pedido)/i)) {
      return 'list_order_items';
    }

    // Confirmar pedido (más variaciones conversacionales)
    if (text.match(/(confirmar|confirmo|si|sí|ok|okey|okay|acepto|aceptar|finalizar|terminar pedido|listo|de acuerdo|va|dale|adelante|proceder|siguiente)/i)) {
      return 'confirm_order';
    }

    // Pagar/Pagado (más variaciones)
    if (text.match(/(ya pagué|ya pague|pagué|pague|ya pagado|pagado|realicé el pago|hice el pago|transferí|transferi|transferencia|ya transferi|ya transferí)/i)) {
      return { intent: 'payment_confirmed', action: 'payment_confirmed' };
    }

    return 'unknown';
  }

  /**
   * Buscar por categoría o término corto (listado)
   */
  async _handleCategoryOrSearch(text) {
    try {
      const term = this._extractCategoryOrSearchTerm(text);
      if (!term) {
        return await this._handleCatalog();
      }

      let productos = await this._searchProductosSmart(term, { limit: 20 });

      if (!productos || productos.length === 0) {
        // Intentar obtener sugerencias inteligentes
        const sugerencias = await productSuggestions.getSimilarProducts(term, 5);
        
        if (sugerencias && sugerencias.length > 0) {
          return {
            message: productSuggestions.formatSuggestions(sugerencias, `❌ No encontré resultados exactos para "${term}"`),
            productos: sugerencias
          };
        }
        
        // Si no hay sugerencias similares, intentar productos relacionados
        const relacionados = await productSuggestions.getRelatedProducts(term, 5);
        if (relacionados && relacionados.length > 0) {
          return {
            message: `❌ No encontré resultados exactos para "${term}".\n\n` +
              `💡 *Productos relacionados que podrían interesarte:*\n\n` +
              relacionados.map((p, i) => 
                `${i + 1}. *${p.nombre}* — S/ ${(parseFloat(p.precio_venta || 0)).toFixed(2)}`
              ).join('\n') +
              `\n\n💬 Escribe *"CATALOGO"* para ver todos los productos disponibles.`,
            productos: relacionados
          };
        }
        
        return {
          message: `❌ No encontré resultados para "${term}".\n\n` +
            `💡 *Sugerencias:*\n` +
            `• Verifica la ortografía\n` +
            `• Intenta usar el nombre completo del producto\n` +
            `• Escribe *"CATALOGO"* para ver productos destacados\n` +
            `• Di *"productos baratos"* o *"productos disponibles"* para buscar con filtros`
        };
      }

      let msg = `🔎 *Resultados para:* ${term}\n\n`;
      productos.slice(0, 20).forEach(p => {
        const precio = typeof p.precio_venta === 'number' ? p.precio_venta : parseFloat(p.precio_venta || 0);
        msg += `• *${p.nombre}* — _S/ ${precio.toFixed(2)}_${p.stock_actual > 0 ? '  ✅' : '  ❌'}\n`;
      });
      if (productos.length > 20) {
        msg += `\n_... y ${productos.length - 20} más_\n`;
      }
      msg += '\n💬 _Escribe el nombre para más detalles o envía una nota de voz._';

      return { message: msg, productos };
    } catch (e) {
      logger.error('Error en _handleCategoryOrSearch', e);
      return { message: 'No pude procesar la búsqueda. Intenta más tarde.' };
    }
  }

  _extractCategoryOrSearchTerm(text) {
    const s = (text || '').toLowerCase();
    const m = s.match(/(?:quiero ver|ver|muéstrame|muestrame|mostrar|ver catálogo de)\s+([a-záéíóúñ\s]{3,})/i);
    if (m && m[1]) return m[1].trim();
    // Si no hay patrón, si el texto es corto y parece categoría, úsalo completo
    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length <= 4 && this.categoryKeywords.some(k => s.includes(k))) {
      return s.trim();
    }
    return null;
  }

  /**
   * Manejar saludo
   */
  _handleGreeting(sessionState = {}) {
    const nombreCliente = sessionState.nombreCliente || 'Cliente';
    const isClienteRegistrado = !!sessionState.cliente;
    
    let mensaje = '';
    
    if (isClienteRegistrado) {
      mensaje = `👋 *¡Hola ${nombreCliente}!* 👋\n\n`;
    } else {
      mensaje = `👋 *¡Hola Cliente!* 👋\n\n`;
    }
    
    mensaje += `✨ *¡Bienvenido a KARDEX!* ✨\n\n`;
    mensaje += `🎯 *¿Qué deseas hacer hoy?*\n\n`;
    mensaje += `📋 *Opciones disponibles:*\n`;
    mensaje += `\n`;
    mensaje += `🛍️  Ver productos disponibles\n`;
    mensaje += `   Escribe: *"CATALOGO"* o *"PRODUCTOS"*\n`;
    mensaje += `\n`;
    mensaje += `💰 Consultar precios\n`;
    mensaje += `   Ejemplo: *"¿Cuánto cuesta una laptop?"*\n`;
    mensaje += `\n`;
    mensaje += `🛒 Hacer un pedido\n`;
    mensaje += `   🎤 Envía una nota de voz o escribe:\n`;
    mensaje += `   *"Quiero 2 laptops HP"*\n`;
    mensaje += `\n`;
    mensaje += `📊 Ver estado de tu pedido\n`;
    mensaje += `   Escribe: *"ESTADO"* o *"MI PEDIDO"*\n`;
    mensaje += `\n`;
    mensaje += `❓ Obtener ayuda\n`;
    mensaje += `   Escribe: *"AYUDA"*\n\n`;
    mensaje += `💡 *Tip:* Para pedidos rápidos, envía una nota de voz diciendo lo que necesitas. El bot entenderá incluso si hay ruido o pronuncias mal algunas palabras. 🎤\n\n`;
    mensaje += `🚀 *¡Estoy listo para ayudarte!* ✨`;
    
    return { message: mensaje };
  }

  /**
   * Manejar solicitud de catálogo
   */
  async _handleCatalog() {
    try {
      let productos = null;
      
      // Intentar BD primero
      if (kardexDb.isConnected()) {
        productos = await kardexDb.getProductos({ activo: true, limit: 20 });
      }
      
      // Si no hay resultados, usar API
      if (!productos || productos.length === 0) {
        productos = await kardexApi.getProductos({ activo: true, limit: 20 });
      }
      
      if (!productos || productos.length === 0) {
        return {
          message: 'No hay productos disponibles.'
        };
      }
      
      let catalogMessage = '🛍️ *CATÁLOGO DE PRODUCTOS*\n\n';
      catalogMessage += '*Productos destacados:*\n\n';
      
      for (const producto of productos.slice(0, 20)) {
        const precio = typeof producto.precio_venta === 'number' 
          ? producto.precio_venta.toFixed(2) 
          : parseFloat(producto.precio_venta || 0).toFixed(2);
        
        catalogMessage += `• *${producto.nombre}*\n`;
        catalogMessage += `  Precio: S/ ${precio} | Stock: ${producto.stock_actual > 0 ? '✅' : '❌'}\n\n`;
      }
      
      if (productos.length > 20) {
        catalogMessage += `_... y ${productos.length - 20} producto(s) más_\n\n`;
      }
      
      catalogMessage += '💬 *Para pedir o ver más detalles:*\n';
      catalogMessage += '• Escribe el nombre del producto\n';
      catalogMessage += '• O envíalo por voz de forma natural\n';
      catalogMessage += '• Ejemplo: *"quiero laptop HP"* o *"cuánto cuesta mouse"*\n\n';
      catalogMessage += '💡 *Tips:*\n';
      catalogMessage += '• Di *"productos baratos"* para ver opciones económicas\n';
      catalogMessage += '• Di *"solo disponibles"* para ver productos con stock\n';
      catalogMessage += '• Di *"menos de 500"* para filtrar por precio';
      
      return {
        message: catalogMessage,
        productos
      };
    } catch (error) {
      logger.error('Error al obtener catálogo', error);
      return {
        message: 'No pude obtener el catálogo en este momento. Por favor, intenta más tarde.'
      };
    }
  }

  /**
   * Manejar ayuda (contextual según el estado de la sesión)
   */
  _handleHelp(sessionState = {}) {
    const currentState = sessionState.state || 'idle';
    const sessionManager = require('./sessionManager');
    
    let mensaje = '🤖 *AYUDA - COMANDOS DISPONIBLES*\n\n';
    
    // Ayuda general siempre visible
    mensaje += '📋 *COMANDOS GENERALES:*\n\n';
    mensaje += '• 🛍️ *"CATALOGO"* o *"PRODUCTOS"* - Ver productos disponibles\n';
    mensaje += '• 💰 *"¿Cuánto cuesta X?"* - Consultar precio\n';
    mensaje += '• 📦 *"¿Tienes X?"* - Consultar stock\n';
    mensaje += '• 🛒 *"Quiero X"* o nota de voz - Hacer pedido\n';
    mensaje += '• 📊 *"ESTADO"* o *"MI PEDIDO"* - Ver pedido actual\n';
    mensaje += '• 📋 *"MIS PEDIDOS"* - Ver historial (requiere autenticación)\n';
    mensaje += '• 📄 *"MIS FACTURAS"* - Ver facturas (requiere autenticación)\n';
    mensaje += '• ⚙️ *"MODIFICAR PERFIL"* - Actualizar datos (requiere autenticación)\n';
    mensaje += '• 📊 *"MI CUENTA"* - Ver estado de cuenta (requiere autenticación)\n\n';
    
    // Ayuda contextual según el estado
    if (currentState === sessionManager.STATES.PEDIDO_EN_PROCESO || 
        currentState === sessionManager.STATES.AWAITING_CONFIRMATION) {
      mensaje += '📦 *COMANDOS PARA TU PEDIDO:*\n\n';
      mensaje += '• *"VER PEDIDO"* - Ver productos en tu pedido\n';
      mensaje += '• *"cambiar [producto] a X"* - Cambiar cantidad\n';
      mensaje += '• *"eliminar [producto]"* - Quitar producto\n';
      mensaje += '• *"CONFIRMO"* - Confirmar pedido\n';
      mensaje += '• *"CANCELAR"* - Cancelar pedido\n\n';
    }
    
    if (currentState === sessionManager.STATES.AWAITING_PAYMENT) {
      mensaje += '💳 *COMANDOS DE PAGO:*\n\n';
      mensaje += '• *"YAPE"* - Ver información de pago Yape\n';
      mensaje += '• *"PLIN"* - Ver información de pago Plin\n';
      mensaje += '• *"PAGADO"* - Confirmar que ya pagaste\n';
      mensaje += '• *"CANCELAR"* - Cancelar pedido\n\n';
    }
    
    mensaje += '💡 *TIPS:*\n';
    mensaje += '• Puedes hablar de forma natural, el bot te entenderá\n';
    mensaje += '• Usa notas de voz para pedidos rápidos\n';
    mensaje += '• Di "salir" o "cancelar" en cualquier momento para volver\n';
    mensaje += '• Ejemplos: "quiero 2 laptops", "cuánto cuesta un mouse", "ver mi pedido"\n\n';
    mensaje += '❓ ¿Necesitas más ayuda? Escribe tu pregunta de forma natural.';
    
    return { message: mensaje };
  }

  /**
   * Manejar estado de despliegue
   */
  _handleDeployStatus() {
    return {
      message:
        '🚀 El sistema está desplegado en Vercel (frontend) y Railway (backend).\n' +
        '✅ Cada commit en la rama principal desencadena despliegue automático.\n' +
        'ℹ️ Si acabas de actualizar, espera 1-2 minutos para ver cambios reflejados.'
    };
  }

  /**
   * Manejar consulta de precio
   */
  async _handlePriceInquiry(text) {
    try {
      // Extraer nombre del producto del texto
      const productName = this._extractProductName(text);
      
      if (!productName) {
        return {
          message: '⚠️ _No pude identificar el producto._\n' +
            'Por favor menciona el nombre. *Ejemplo:* _"¿Cuánto cuesta una laptop?"_'
        };
      }
      
      // Buscar producto
      let productos = await this._searchProductosSmart(productName, { limit: 3 });
      
      if (!productos || productos.length === 0) {
        // Intentar obtener sugerencias inteligentes
        const sugerencias = await productSuggestions.getSimilarProducts(productName, 5);
        
        if (sugerencias && sugerencias.length > 0) {
          return {
            message: productSuggestions.formatSuggestions(sugerencias, `❌ No encontré "${productName}"`)
          };
        }
        
        // Si no hay sugerencias, mostrar productos populares
        const populares = await productSuggestions.getPopularProducts(5);
        if (populares && populares.length > 0) {
          return {
            message: `❌ No encontré "${productName}".\n\n` +
              `💡 *Te sugiero estos productos populares:*\n\n` +
              populares.map((p, i) => 
                `${i + 1}. *${p.nombre}* — S/ ${(parseFloat(p.precio_venta || 0)).toFixed(2)}`
              ).join('\n') +
              `\n\n💬 Escribe *"CATALOGO"* para ver más productos.`
          };
        }
        
        return {
          message: `❌ No encontré "${productName}".\n` +
            '• Verifica el nombre (ej: "audifonos sony wh-1000xm5").\n' +
            '• Escribe *"CATALOGO"* para ver productos.\n' +
            '• También puedes decir: _"ver laptops"_ o _"tecnológicos"_.'
        };
      }
      
      // Mostrar información del producto encontrado
      const producto = productos[0];
      const precio = typeof producto.precio_venta === 'number' 
        ? producto.precio_venta.toFixed(2) 
        : parseFloat(producto.precio_venta || 0).toFixed(2);
      
      let message = `💰 *${producto.nombre}*\n`;
      message += `• _Precio:_ *S/ ${precio}*\n`;
      
      if (producto.stock_actual > 0) {
        message += `• _Stock:_ ✅ *${producto.stock_actual}*\n`;
      } else {
        message += `• _Stock:_ ❌ *Agotado*\n`;
      }
      
      message += '\n💬 _Para pedir, envía una nota de voz o escribe el nombre._';
      
      return { message };
    } catch (error) {
      logger.error('Error al consultar precio', error);
      return {
        message: 'No pude consultar el precio en este momento. Por favor, intenta más tarde.'
      };
    }
  }

  /**
   * Manejar consulta de stock
   */
  async _handleStockInquiry(text, sessionState = {}) {
    try {
      // Mostrar estado del pedido actual si existe
      let orderStatusMessage = '';
      if (sessionState.phoneNumber) {
        const sessionManager = require('./sessionManager');
        const pendingOrder = await sessionManager.getPendingOrder(sessionState.phoneNumber);
        if (pendingOrder && pendingOrder.productos && pendingOrder.productos.length > 0) {
          orderStatusMessage = '🧾 *Tu pedido actual:*\n';
          pendingOrder.productos.forEach((p, idx) => {
            orderStatusMessage += `• ${p.nombre || p.nombre_producto} × _${p.cantidad}_\n`;
          });
          orderStatusMessage += `💰 *Total:* _S/ ${parseFloat(pendingOrder.total || 0).toFixed(2)}_\n\n`;
        }
      }

      const productName = this._extractProductName(text);
      
      if (!productName) {
        return {
          message: orderStatusMessage + '⚠️ _No pude identificar el producto._\n' +
            'Por favor menciona el nombre. *Ejemplo:* _"¿Tienes laptops disponibles?"_'
        };
      }
      
      // Buscar producto
      let productos = await this._searchProductosSmart(productName, { limit: 3 });
      
      if (!productos || productos.length === 0) {
        // Intentar obtener sugerencias inteligentes
        const sugerencias = await productSuggestions.getSimilarProducts(productName, 5);
        
        if (sugerencias && sugerencias.length > 0) {
          return {
            message: orderStatusMessage + productSuggestions.formatSuggestions(sugerencias, `❌ No encontré "${productName}"`)
          };
        }
        
        return {
          message: orderStatusMessage + `❌ No encontré "${productName}".\n` +
            'Escribe *"CATALOGO"* para ver productos o intenta con _"ver laptops"_.'
        };
      }
      
      const producto = productos[0];
      let message = orderStatusMessage + `📦 *${producto.nombre}*\n`;
      
      if (producto.stock_actual > 0) {
        message += `• _Stock:_ ✅ *${producto.stock_actual}*\n`;
        message += `• _Precio:_ *S/ ${producto.precio_venta.toFixed(2)}*\n`;
      } else {
        message += `• _Stock:_ ❌ *Agotado*\n`;
      }
      
      message += '\n💬 _Para pedir, envía una nota de voz o escribe el nombre._';
      
      return { message };
    } catch (error) {
      logger.error('Error al consultar stock', error);
      return {
        message: 'No pude consultar el stock. Intenta más tarde.'
      };
    }
  }

  /**
   * Extraer nombre del producto del comando eliminar
   */
  _extractProductNameFromRemove(text) {
    const match = text.match(/(?:eliminar|quitar|remover|borrar|sacar)\s+(.+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return null;
  }

  /**
   * Extraer nombre del producto del texto
   */
  _extractProductName(text) {
    const normalize = (s) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!.,;:"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    const original = text || '';
    const s = normalize(original);
    
    // 1) Intento: capturar después de frases comunes
    const directMatch = s.match(/(?:cuanto cuesta|precio|stock|disponible|tienes|tiene)\s+(?:de|del|la|el)?\s*([a-z0-9\s]{3,})$/i);
    if (directMatch && directMatch[1]) {
      const candidate = normalize(directMatch[1]);
      if (candidate.length >= 3) return candidate;
    }
    
    // 2) Limpiar palabras comunes y devolver lo restante
    const cleaned = s
      .replace(/\b(precio|cuanto cuesta|valor|price|cost|stock|disponible|hay|tienes|tiene|inventario|de|del|la|el|un|una|unos|unas)\b/gi, '')
      .trim();
    if (cleaned.length >= 3) return cleaned;
    
    // 3) Último recurso: tomar las últimas palabras significativas
    const tokens = s.split(' ').filter(t => t.length >= 3);
    return tokens.length ? tokens.slice(-3).join(' ') : null;
  }

  /**
   * Manejar búsqueda avanzada con filtros
   */
  async _handleAdvancedSearch(text, sessionState = {}) {
    try {
      // Extraer filtros del texto
      const textLower = text.toLowerCase();
      let filtros = {
        precioMaximo: null,
        precioMinimo: null,
        soloDisponibles: false,
        categoria: null
      };

      // Detectar filtro de precio máximo
      const maxMatch = textLower.match(/(?:menos de|hasta|máximo|maximo|máx|max)\s*(\d+)/);
      if (maxMatch) {
        filtros.precioMaximo = parseFloat(maxMatch[1]);
      }

      // Detectar filtro de precio mínimo
      const minMatch = textLower.match(/(?:más de|desde|mínimo|minimo|mín|min)\s*(\d+)/);
      if (minMatch) {
        filtros.precioMinimo = parseFloat(minMatch[1]);
      }

      // Detectar rango de precios
      const rangeMatch = textLower.match(/(?:entre|rango)\s*(\d+)\s*(?:y|a|-)\s*(\d+)/);
      if (rangeMatch) {
        filtros.precioMinimo = parseFloat(rangeMatch[1]);
        filtros.precioMaximo = parseFloat(rangeMatch[2]);
      }

      // Detectar solo disponibles
      if (textLower.match(/(?:solo|solamente|únicamente)\s+(?:disponibles?|con\s+stock)/)) {
        filtros.soloDisponibles = true;
      }

      // Detectar productos baratos/económicos
      if (textLower.match(/(?:productos?\s+)?(?:baratos?|económicos?|economicos?)/)) {
        filtros.precioMaximo = 500; // Por defecto, productos baratos son menos de 500 soles
      }

      // Obtener productos
      let productos = null;
      if (kardexDb.isConnected()) {
        productos = await kardexDb.getProductos({ activo: true, limit: 100 });
      }
      if (!productos || productos.length === 0) {
        productos = await kardexApi.getProductos({ activo: true, limit: 100 });
      }

      if (!productos || productos.length === 0) {
        return {
          message: 'No hay productos disponibles en este momento.'
        };
      }

      // Aplicar filtros
      let productosFiltrados = productos;

      if (filtros.soloDisponibles) {
        productosFiltrados = productosFiltrados.filter(p => (p.stock_actual || 0) > 0);
      }

      if (filtros.precioMaximo !== null) {
        productosFiltrados = productosFiltrados.filter(p => 
          parseFloat(p.precio_venta || 0) <= filtros.precioMaximo
        );
      }

      if (filtros.precioMinimo !== null) {
        productosFiltrados = productosFiltrados.filter(p => 
          parseFloat(p.precio_venta || 0) >= filtros.precioMinimo
        );
      }

      // Ordenar por precio
      productosFiltrados.sort((a, b) => 
        parseFloat(a.precio_venta || 0) - parseFloat(b.precio_venta || 0)
      );

      if (productosFiltrados.length === 0) {
        return {
          message: `❌ No encontré productos que cumplan con los filtros especificados.\n\n` +
            `💡 Intenta con otros filtros o escribe *"CATALOGO"* para ver todos los productos.`
        };
      }

      // Construir mensaje
      let mensaje = '🔍 *RESULTADOS DE BÚSQUEDA*\n\n';
      
      if (filtros.precioMaximo !== null || filtros.precioMinimo !== null) {
        mensaje += '*Filtros aplicados:*\n';
        if (filtros.precioMinimo !== null) {
          mensaje += `• Precio mínimo: S/ ${filtros.precioMinimo}\n`;
        }
        if (filtros.precioMaximo !== null) {
          mensaje += `• Precio máximo: S/ ${filtros.precioMaximo}\n`;
        }
        mensaje += '\n';
      }

      if (filtros.soloDisponibles) {
        mensaje += '*Solo productos disponibles*\n\n';
      }

      mensaje += `*Encontré ${productosFiltrados.length} producto(s):*\n\n`;

      productosFiltrados.slice(0, 20).forEach((p, index) => {
        const precio = parseFloat(p.precio_venta || 0).toFixed(2);
        const stock = p.stock_actual > 0 ? '✅' : '❌';
        mensaje += `${index + 1}. *${p.nombre}*\n`;
        mensaje += `   Precio: S/ ${precio} ${stock}\n\n`;
      });

      if (productosFiltrados.length > 20) {
        mensaje += `_... y ${productosFiltrados.length - 20} más_\n\n`;
      }

      mensaje += '💬 *Para pedir alguno, escribe su nombre o envíalo por voz.*';

      return {
        message: mensaje,
        productos: productosFiltrados
      };
    } catch (error) {
      logger.error('Error en búsqueda avanzada', error);
      return {
        message: 'No pude procesar la búsqueda. Por favor, intenta más tarde.'
      };
    }
  }

  /**
   * Manejar mensaje desconocido (más conversacional y útil, sin decir "no entendí")
   */
  _handleUnknown(sessionState = {}) {
    const nombreCliente = sessionState.nombreCliente || '';
    const saludo = nombreCliente ? `Hola ${nombreCliente}` : 'Hola';
    
    return {
      message: `👋 *${saludo}!* 👋\n\n` +
        `📋 *¿En qué puedo ayudarte hoy?*\n\n` +
        `🛍️ *Ver productos:*\n` +
        `   Di: *"CATALOGO"*, *"ver productos"*, *"quiero ver productos"*\n\n` +
        `💰 *Consultar precios:*\n` +
        `   Di: *"¿Cuánto cuesta una laptop?"*, *"precio de mouse"*\n\n` +
        `🛒 *Hacer un pedido:*\n` +
        `   Di: *"quiero una laptop"*, *"necesito 2 mouses"*, *"dame un teclado"*\n\n` +
        `📊 *Ver mi pedido:*\n` +
        `   Di: *"ESTADO"*, *"ver pedido"*, *"mi pedido"*\n\n` +
        `📋 *Otras opciones:*\n` +
        `   • *"MIS PEDIDOS"* - Ver historial\n` +
        `   • *"AYUDA"* - Ver todas las opciones\n` +
        `   • *"REGISTRAR"* - Crear cuenta\n\n` +
        `🎤 *O simplemente habla conmigo:*\n` +
        `Envía una nota de voz diciendo lo que necesitas.\n\n` +
        `💡 *Ejemplos de voz:*\n` +
        `• "Hola, quiero comprar una laptop"\n` +
        `• "Necesito dos mouses inalámbricos"\n` +
        `• "¿Tienes teclados disponibles?"\n\n` +
        `✨ *Puedo entenderte incluso con ruido o pronunciación incorrecta.* 😊`
    };
  }

  /**
   * Verificar si un texto contiene intención de pedido (para decidir si usar IA)
   */
  containsOrderIntent(text) {
    const orderKeywords = [
      'quiero', 'necesito', 'pedir', 'comprar', 'dame', 'deme', 'me gustaría', 'gustaria',
      'solicito', 'orden', 'ordenar', 'llevo', 'llevar', 'envío', 'envio', 'enviamos',
      'entrega', 'delivery', 'cantidad', 'unidades', 'piezas', 'un', 'una', 'dos', 'tres',
      'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'ponme', 'pon', 'agregar',
      'agregame', 'agrégame', 'agreguen', 'agregar', 'añadir', 'añade', 'añadame', 'traeme',
      'traer', 'dame', 'demen', 'consigo', 'me llevo', 'vamos a comprar', 'necesito comprar',
      'quisiera', 'quisiera comprar', 'me interesa', 'estoy interesado', 'quiero comprar'
    ];
    
    const normalizedText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Verificar si contiene números junto con productos
    const hasNumber = /\d+/.test(normalizedText);
    const hasProductWords = /(laptop|mouse|teclado|monitor|producto|celular|audifono|impresora|disco|memoria|ram|ssd|hdd)/i.test(normalizedText);
    
    if (hasNumber && hasProductWords) {
      return true;
    }
    
    return orderKeywords.some(keyword => normalizedText.includes(keyword));
  }

  /**
   * Búsqueda inteligente con fallback difuso (tokens + fonética)
   */
  async _searchProductosSmart(query, { limit = 20 } = {}) {
    const q = (query || '').toString().trim();
    if (!q) return [];

    // 1) Intentar BD
    if (kardexDb.isConnected()) {
      try {
        const dbRes = await kardexDb.buscarProductos(q, limit);
        if (Array.isArray(dbRes) && dbRes.length > 0) return dbRes;
      } catch (_) {}
    }

    // 2) Intentar API directa
    try {
      const apiRes = await kardexApi.buscarProductos(q);
      if (Array.isArray(apiRes) && apiRes.length > 0) return apiRes.slice(0, limit);
    } catch (_) {}

    // 3) Fallback: descargar listado parcial y aplicar índice local con fonética
    try {
      const listado = await kardexApi.getProductos({ activo: true, limit: 500 });
      if (Array.isArray(listado) && listado.length > 0) {
        productCache.indexProducts(listado, { normalize: normalizePhon, soundex: soundexEs });
        const candidates = productCache.findCandidates(q, { normalize: normalizePhon, soundex: soundexEs, limit: limit * 2 });
        // Reordenar candidatos por heurística de similitud simple
        const nq = normalizePhon(q);
        const scored = candidates.map(p => {
          const name = normalizePhon(p.nombre || '');
          const includes = name.includes(nq) ? 2 : 0;
          const commonTokens = new Set(nq.split(' ').filter(Boolean).filter(t => name.includes(t))).size;
          return { p, score: includes + commonTokens };
        }).sort((a, b) => b.score - a.score);
        return scored.map(s => s.p).slice(0, limit);
      }
    } catch (e) {
      logger.warn('Fallback difuso falló', e.message);
    }

    return [];
  }
}

module.exports = new BasicBot();

