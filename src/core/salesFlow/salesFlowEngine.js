const databaseManager = require('../database/databaseManager');
const promotionsManager = require('../database/promotionsManager');
const orderValidator = require('./orderValidator');
const productRecommender = require('./productRecommender');
const logger = require('../../utils/logger');

/**
 * Motor de flujo de ventas completo
 * 
 * Este módulo implementa el flujo completo de ventas en 9 pasos:
 * 1. Saludo y bienvenida profesional
 * 2. Identificación de intención (usar IA mejorada)
 * 3. Consulta de base de datos (productos, stock, precios, promociones)
 * 4. Presentación de opciones válidas basadas en BD
 * 5. Ayuda en selección (recomendaciones inteligentes)
 * 6. Confirmación: producto → cantidad → precio final
 * 7. Recolección: datos cliente → envío → pago
 * 8. Cierre de venta (registro en BD)
 * 9. Confirmación y seguimiento
 * 
 * @module core/salesFlow/salesFlowEngine
 */

class SalesFlowEngine {
  constructor() {
    this.steps = {
      GREETING: 1,
      INTENT_IDENTIFICATION: 2,
      DATABASE_QUERY: 3,
      PRESENT_OPTIONS: 4,
      SELECTION_ASSISTANCE: 5,
      CONFIRMATION: 6,
      DATA_COLLECTION: 7,
      SALE_CLOSURE: 8,
      FOLLOW_UP: 9
    };
  }

  /**
   * Ejecutar paso 1: Saludo y bienvenida profesional
   * 
   * @param {object} context - Contexto {cliente, phoneNumber, sessionState}
   * @returns {Promise<object>} {message: string, nextStep: number}
   */
  async stepGreeting(context = {}) {
    try {
      const { cliente, phoneNumber, sessionState } = context;
      const nombreCliente = cliente?.nombre || sessionState?.nombreCliente || 'Cliente';
      const isClienteRegistrado = !!cliente;

      let message = '';
      
      if (isClienteRegistrado) {
        message = `👋 *¡Hola ${nombreCliente}!* 👋\n\n`;
      } else {
        message = `👋 *¡Hola!* 👋\n\n`;
      }
      
      message += `✨ *¡Bienvenido a KARDEX!* ✨\n\n`;
      message += `Soy tu asistente virtual de ventas. Estoy aquí para ayudarte a encontrar los productos que necesitas.\n\n`;
      message += `🎯 *¿Qué deseas hacer hoy?*\n\n`;
      message += `📋 *Opciones disponibles:*\n`;
      message += `\n`;
      message += `🛍️  Ver productos disponibles\n`;
      message += `   Escribe: *"CATALOGO"* o *"PRODUCTOS"*\n`;
      message += `\n`;
      message += `💰 Consultar precios\n`;
      message += `   Ejemplo: *"¿Cuánto cuesta una laptop?"*\n`;
      message += `\n`;
      message += `🛒 Hacer un pedido\n`;
      message += `   🎤 Envía una nota de voz o escribe:\n`;
      message += `   *"Quiero 2 laptops HP"*\n`;
      message += `\n`;
      message += `📊 Ver estado de tu pedido\n`;
      message += `   Escribe: *"ESTADO"* o *"MI PEDIDO"*\n`;
      message += `\n`;
      message += `❓ Obtener ayuda\n`;
      message += `   Escribe: *"AYUDA"*\n\n`;
      message += `💡 *Tip:* Para pedidos rápidos, envía una nota de voz diciendo lo que necesitas. El bot entenderá incluso si hay ruido o pronuncias mal algunas palabras. 🎤\n\n`;
      message += `🚀 *¡Estoy listo para ayudarte!* ✨`;

      return {
        message,
        nextStep: this.steps.INTENT_IDENTIFICATION,
        action: 'greeting_sent'
      };
    } catch (error) {
      logger.error('Error en stepGreeting:', error);
      return {
        message: '👋 ¡Hola! ¿En qué puedo ayudarte?',
        nextStep: this.steps.INTENT_IDENTIFICATION,
        action: 'greeting_sent',
        error: error.message
      };
    }
  }

  /**
   * Ejecutar paso 2: Identificación de intención
   * 
   * @param {string} userMessage - Mensaje del usuario
   * @param {object} context - Contexto
   * @param {object} aiResult - Resultado de IA (intent, confidence)
   * @returns {Promise<object>} {intent: string, nextStep: number, requiresDB: boolean}
   */
  async stepIntentIdentification(userMessage, context = {}, aiResult = null) {
    try {
      // Si ya hay resultado de IA, usarlo
      if (aiResult && aiResult.intent) {
        const intent = aiResult.intent.toUpperCase();
        const requiresDB = [
          'HACER_PEDIDO',
          'VER_CATALOGO',
          'CONSULTAR_PRECIO',
          'CONSULTAR_STOCK',
          'VER_PRODUCTO'
        ].includes(intent);

        return {
          intent,
          confidence: aiResult.confidence || 0.7,
          nextStep: requiresDB ? this.steps.DATABASE_QUERY : this.steps.PRESENT_OPTIONS,
          requiresDB,
          reasoning: aiResult.reasoning || ''
        };
      }

      // Fallback a clasificación básica si no hay IA
      const intentMap = {
        'quiero': 'HACER_PEDIDO',
        'necesito': 'HACER_PEDIDO',
        'comprar': 'HACER_PEDIDO',
        'pedir': 'HACER_PEDIDO',
        'catálogo': 'VER_CATALOGO',
        'catalogo': 'VER_CATALOGO',
        'productos': 'VER_CATALOGO',
        'precio': 'CONSULTAR_PRECIO',
        'cuánto': 'CONSULTAR_PRECIO',
        'cuanto': 'CONSULTAR_PRECIO',
        'tienes': 'CONSULTAR_STOCK',
        'hay': 'CONSULTAR_STOCK',
        'disponible': 'CONSULTAR_STOCK',
        'mi pedido': 'VER_PEDIDO',
        'estado': 'VER_PEDIDO',
        'cancelar': 'CANCELAR',
        'salir': 'CANCELAR',
        'ayuda': 'AYUDA'
      };

      const textLower = userMessage.toLowerCase();
      let detectedIntent = 'OTRO';
      
      for (const [keyword, intent] of Object.entries(intentMap)) {
        if (textLower.includes(keyword)) {
          detectedIntent = intent;
          break;
        }
      }

      const requiresDB = [
        'HACER_PEDIDO',
        'VER_CATALOGO',
        'CONSULTAR_PRECIO',
        'CONSULTAR_STOCK',
        'VER_PRODUCTO'
      ].includes(detectedIntent);

      return {
        intent: detectedIntent,
        confidence: 0.6,
        nextStep: requiresDB ? this.steps.DATABASE_QUERY : this.steps.PRESENT_OPTIONS,
        requiresDB,
        reasoning: 'Clasificación básica por palabras clave'
      };
    } catch (error) {
      logger.error('Error en stepIntentIdentification:', error);
      return {
        intent: 'OTRO',
        confidence: 0.3,
        nextStep: this.steps.PRESENT_OPTIONS,
        requiresDB: false,
        error: error.message
      };
    }
  }

  /**
   * Ejecutar paso 3: Consulta de base de datos
   * 
   * @param {string} intent - Intención detectada
   * @param {object} queryData - Datos de consulta {search, filters, productoId, etc.}
   * @returns {Promise<object>} {data: any, nextStep: number}
   */
  async stepDatabaseQuery(intent, queryData = {}) {
    try {
      let result = null;

      switch (intent) {
        case 'HACER_PEDIDO':
          // Buscar productos mencionados
          if (queryData.productos && queryData.productos.length > 0) {
            const productosEncontrados = [];
            
            for (const producto of queryData.productos) {
              const productos = await databaseManager.buscarProductos(producto.nombre, {
                limit: 5,
                filters: queryData.filters
              });
              
              if (productos && productos.length > 0) {
                productosEncontrados.push({
                  query: producto.nombre,
                  productos: productos,
                  cantidad: producto.cantidad || 1
                });
              }
            }
            
            result = { productosEncontrados };
          }
          break;

        case 'VER_CATALOGO':
          // Obtener catálogo completo
          const catalogo = await databaseManager.getProductos({
            limit: queryData.limit || 50,
            filters: queryData.filters
          });
          result = { catalogo };
          break;

        case 'CONSULTAR_PRECIO':
        case 'CONSULTAR_STOCK':
          // Buscar producto específico
          if (queryData.productoNombre) {
            const productos = await databaseManager.buscarProductos(queryData.productoNombre, {
              limit: 1
            });
            
            if (productos && productos.length > 0) {
              result = {
                producto: productos[0],
                consulta: intent
              };
            }
          }
          break;

        case 'VER_PRODUCTO':
          // Obtener producto por ID
          if (queryData.productoId) {
            const producto = await databaseManager.getProductoById(queryData.productoId);
            result = { producto };
          }
          break;

        default:
          result = null;
      }

      return {
        data: result,
        nextStep: this.steps.PRESENT_OPTIONS,
        success: result !== null
      };
    } catch (error) {
      logger.error('Error en stepDatabaseQuery:', error);
      return {
        data: null,
        nextStep: this.steps.PRESENT_OPTIONS,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Ejecutar paso 4: Presentar opciones válidas basadas en BD
   * 
   * @param {string} intent - Intención
   * @param {object} dbData - Datos de BD
   * @returns {Promise<object>} {message: string, options: array, nextStep: number}
   */
  async stepPresentOptions(intent, dbData = {}) {
    try {
      let message = '';
      let options = [];
      let nextStep = this.steps.SELECTION_ASSISTANCE;

      switch (intent) {
        case 'HACER_PEDIDO':
          if (dbData.productosEncontrados && dbData.productosEncontrados.length > 0) {
            message = `✅ *Productos encontrados:*\n\n`;
            
            for (const item of dbData.productosEncontrados) {
              const producto = item.productos[0]; // Tomar el mejor match
              message += `📦 *${producto.nombre}*\n`;
              message += `💰 Precio: S/. ${parseFloat(producto.precio_venta || 0).toFixed(2)}\n`;
              message += `📊 Stock: ${producto.stock_actual || 0} unidades\n`;
              
              // Verificar promociones
              const promocion = await promotionsManager.getPromocionesParaProducto(producto.id, producto);
              if (promocion && promocion.length > 0) {
                message += `🎉 *Promoción disponible:*\n`;
                message += promotionsManager.getMensajePromocion(promocion[0]) + '\n';
              }
              
              message += `\n`;
              
              options.push({
                producto_id: producto.id,
                nombre: producto.nombre,
                precio: producto.precio_venta,
                stock: producto.stock_actual,
                cantidad_solicitada: item.cantidad
              });
            }
            
            message += `💬 ¿Confirmas estos productos? (Responde "SÍ" o "NO")`;
          } else {
            message = `❌ No encontré los productos que mencionaste.\n\n`;
            message += `💡 ¿Quieres que te muestre productos similares o ver el catálogo completo?`;
            nextStep = this.steps.SELECTION_ASSISTANCE;
          }
          break;

        case 'VER_CATALOGO':
          if (dbData.catalogo && dbData.catalogo.length > 0) {
            message = `📋 *Catálogo de productos:*\n\n`;
            
            // Agrupar por categorías si es posible
            const categorias = {};
            dbData.catalogo.forEach(p => {
              const cat = p.categoria_id || 'Otros';
              if (!categorias[cat]) {
                categorias[cat] = [];
              }
              categorias[cat].push(p);
            });

            let count = 0;
            for (const [cat, productos] of Object.entries(categorias)) {
              message += `\n*${cat}:*\n`;
              productos.slice(0, 5).forEach(p => {
                count++;
                message += `${count}. ${p.nombre} - S/. ${parseFloat(p.precio_venta || 0).toFixed(2)}`;
                if (p.stock_actual > 0) {
                  message += ` (Stock: ${p.stock_actual})`;
                } else {
                  message += ` (Sin stock)`;
                }
                message += `\n`;
              });
              if (productos.length > 5) {
                message += `   ... y ${productos.length - 5} más\n`;
              }
            }

            message += `\n💬 Escribe el nombre del producto para agregarlo a tu pedido.`;
          } else {
            message = `❌ No hay productos disponibles en este momento.`;
          }
          break;

        case 'CONSULTAR_PRECIO':
          if (dbData.producto) {
            const producto = dbData.producto;
            message = `💰 *${producto.nombre}*\n`;
            message += `Precio: S/. ${parseFloat(producto.precio_venta || 0).toFixed(2)}\n`;
            
            // Aplicar promociones
            const descuentoInfo = await promotionsManager.aplicarDescuento(
              producto.id,
              producto.precio_venta,
              1,
              producto
            );
            
            if (descuentoInfo.promocion) {
              message += `🎉 *Precio con promoción:* S/. ${descuentoInfo.precioFinal.toFixed(2)}\n`;
              message += `💰 Ahorras: S/. ${descuentoInfo.descuento.toFixed(2)}\n`;
            }
            
            message += `\n💬 ¿Quieres agregarlo a tu pedido?`;
          } else {
            message = `❌ No encontré ese producto. ¿Puedes ser más específico?`;
          }
          break;

        case 'CONSULTAR_STOCK':
          if (dbData.producto) {
            const producto = dbData.producto;
            const stock = producto.stock_actual || 0;
            
            message = `📊 *${producto.nombre}*\n`;
            if (stock > 0) {
              message += `✅ Disponible: ${stock} unidades\n`;
            } else {
              message += `❌ Sin stock disponible\n`;
              // Sugerir alternativas
              const alternativas = await productRecommender.getSimilarProducts(producto.nombre, 3);
              if (alternativas && alternativas.length > 0) {
                message += `\n💡 *Productos similares disponibles:*\n`;
                alternativas.forEach((alt, idx) => {
                  message += `${idx + 1}. ${alt.nombre} - S/. ${parseFloat(alt.precio_venta || 0).toFixed(2)} (Stock: ${alt.stock_actual || 0})\n`;
                });
              }
            }
          } else {
            message = `❌ No encontré ese producto. ¿Puedes ser más específico?`;
          }
          break;

        default:
          message = `❓ No entendí bien tu solicitud. ¿Puedes repetirla o escribir "AYUDA"?`;
      }

      return {
        message,
        options,
        nextStep,
        action: 'options_presented'
      };
    } catch (error) {
      logger.error('Error en stepPresentOptions:', error);
      return {
        message: '❌ Hubo un error al procesar tu solicitud. Por favor, intenta de nuevo.',
        options: [],
        nextStep: this.steps.SELECTION_ASSISTANCE,
        error: error.message
      };
    }
  }

  /**
   * Ejecutar paso 5: Ayuda en selección (recomendaciones)
   * 
   * @param {object} context - Contexto {intent, userMessage, productos, cliente}
   * @returns {Promise<object>} {recommendations: array, message: string, nextStep: number}
   */
  async stepSelectionAssistance(context = {}) {
    try {
      const { intent, userMessage, productos, cliente } = context;
      
      let recommendations = [];
      let message = '';

      if (intent === 'HACER_PEDIDO' && productos && productos.length === 0) {
        // Productos no encontrados, sugerir similares
        if (userMessage) {
          recommendations = await productRecommender.getSimilarProducts(userMessage, 5);
          
          if (recommendations && recommendations.length > 0) {
            message = `💡 *¿Te refieres a alguno de estos productos?*\n\n`;
            recommendations.forEach((p, idx) => {
              message += `${idx + 1}. *${p.nombre}*\n`;
              message += `   Precio: S/. ${parseFloat(p.precio_venta || 0).toFixed(2)}\n`;
              message += `   Stock: ${p.stock_actual || 0} unidades\n\n`;
            });
            message += `💬 Responde con el número o el nombre del producto.`;
          } else {
            // Productos populares
            recommendations = await productRecommender.getPopularProducts(5);
            if (recommendations && recommendations.length > 0) {
              message = `💡 *No encontré ese producto, pero te sugiero estos productos populares:*\n\n`;
              recommendations.forEach((p, idx) => {
                message += `${idx + 1}. *${p.nombre}*\n`;
                message += `   Precio: S/. ${parseFloat(p.precio_venta || 0).toFixed(2)}\n\n`;
              });
            } else {
              message = `❌ No encontré productos similares. ¿Quieres ver el catálogo completo? Escribe "CATALOGO".`;
            }
          }
        }
      } else if (intent === 'HACER_PEDIDO' && productos && productos.length > 0) {
        // Detectar dudas o preguntas
        const hasQuestions = /(\?|cuál|cual|cuáles|cuales|qué|que)/i.test(userMessage || '');
        
        if (hasQuestions) {
          message = `💬 Veo que tienes dudas. ¿Qué te gustaría saber sobre estos productos?\n\n`;
          message += `Puedo ayudarte con:\n`;
          message += `• Detalles técnicos\n`;
          message += `• Comparación de precios\n`;
          message += `• Disponibilidad\n`;
          message += `• Recomendaciones personalizadas\n\n`;
          message += `Solo pregunta lo que necesites. 😊`;
        }
      }

      return {
        recommendations,
        message: message || '💬 ¿Necesitas ayuda para elegir? Puedo recomendarte productos según tus necesidades.',
        nextStep: this.steps.CONFIRMATION,
        action: 'assistance_provided'
      };
    } catch (error) {
      logger.error('Error en stepSelectionAssistance:', error);
      return {
        recommendations: [],
        message: '💬 ¿Necesitas ayuda para elegir?',
        nextStep: this.steps.CONFIRMATION,
        error: error.message
      };
    }
  }

  /**
   * Ejecutar paso 6: Confirmación (producto → cantidad → precio final)
   * Este paso se maneja en orderHandler, pero podemos preparar los datos aquí
   * 
   * @param {array} productos - Productos a confirmar
   * @returns {Promise<object>} {total: number, detalles: array, promociones: array}
   */
  async stepConfirmation(productos = []) {
    try {
      // Validar productos con orderValidator
      const validationResult = await orderValidator.validateOrder(productos);
      
      if (!validationResult.valid) {
        return {
          valid: false,
          errors: validationResult.errors,
          message: validationResult.message
        };
      }

      // Calcular totales con promociones
      let total = 0;
      const detalles = [];
      
      for (const item of validationResult.validatedProducts) {
        const descuentoInfo = await promotionsManager.aplicarDescuento(
          item.producto_id,
          item.precio_unitario,
          item.cantidad,
          item.producto
        );

        const subtotal = descuentoInfo.precioFinal * item.cantidad;
        total += subtotal;

        detalles.push({
          ...item,
          precio_original: item.precio_unitario,
          precio_final: descuentoInfo.precioFinal,
          descuento: descuentoInfo.descuento,
          subtotal
        });
      }

      return {
        valid: true,
        total: parseFloat(total.toFixed(2)),
        detalles,
        promociones: detalles.filter(d => d.promocion).map(d => d.promocion)
      };
    } catch (error) {
      logger.error('Error en stepConfirmation:', error);
      return {
        valid: false,
        errors: [error.message],
        message: 'Error al procesar confirmación'
      };
    }
  }

  /**
   * Ejecutar paso 7: Recolección de datos (cliente → envío → pago)
   * Este paso se maneja principalmente en whatsapp-baileys.js
   * 
   * @param {object} pedidoData - Datos del pedido confirmado
   * @param {object} clienteData - Datos del cliente
   * @returns {Promise<object>} {ready: boolean, missing: array}
   */
  async stepDataCollection(pedidoData = {}, clienteData = {}) {
    try {
      const missing = [];

      // Verificar datos del cliente
      if (!clienteData.nombre) {
        missing.push('nombre');
      }
      if (!clienteData.telefono) {
        missing.push('telefono');
      }

      // Verificar datos de envío (si aplica)
      if (pedidoData.requiresShipping && !clienteData.direccion) {
        missing.push('direccion');
      }

      // Verificar método de pago
      if (!pedidoData.metodo_pago) {
        missing.push('metodo_pago');
      }

      return {
        ready: missing.length === 0,
        missing,
        message: missing.length > 0 
          ? `Faltan los siguientes datos: ${missing.join(', ')}`
          : 'Todos los datos están completos'
      };
    } catch (error) {
      logger.error('Error en stepDataCollection:', error);
      return {
        ready: false,
        missing: ['datos_completos'],
        error: error.message
      };
    }
  }

  /**
   * Ejecutar paso 8: Cierre de venta (registro en BD)
   * Este paso se maneja en orderHandler
   * 
   * @param {object} pedidoData - Datos completos del pedido
   * @returns {Promise<object>} {success: boolean, pedido_id: number, numero_pedido: string}
   */
  async stepSaleClosure(pedidoData = {}) {
    try {
      // Crear pedido vía API
      const result = await databaseManager.crearPedido({
        cliente_id: pedidoData.cliente_id,
        telefono: pedidoData.telefono
      });

      if (!result || !result.success) {
        return {
          success: false,
          error: 'Error al crear pedido',
          message: 'No se pudo registrar tu pedido. Por favor, intenta de nuevo.'
        };
      }

      // Agregar productos al pedido
      const productosAgregados = [];
      for (const item of pedidoData.productos || []) {
        const addResult = await databaseManager.agregarProductoAPedido(
          result.pedido_id,
          item.producto_id,
          item.cantidad
        );

        if (addResult && addResult.success) {
          productosAgregados.push(item.producto_id);
        }
      }

      // Confirmar pedido
      if (pedidoData.confirmar) {
        const confirmResult = await databaseManager.confirmarPedido(
          result.pedido_id,
          {
            direccion: pedidoData.direccion,
            metodo_pago: pedidoData.metodo_pago
          }
        );

        return {
          success: true,
          pedido_id: result.pedido_id,
          numero_pedido: result.numero_pedido,
          confirmado: true,
          message: `✅ Pedido ${result.numero_pedido} confirmado exitosamente.`
        };
      }

      return {
        success: true,
        pedido_id: result.pedido_id,
        numero_pedido: result.numero_pedido,
        confirmado: false,
        message: `✅ Pedido ${result.numero_pedido} creado. Esperando confirmación.`
      };
    } catch (error) {
      logger.error('Error en stepSaleClosure:', error);
      return {
        success: false,
        error: error.message,
        message: 'Error al cerrar la venta. Por favor, contacta con soporte.'
      };
    }
  }

  /**
   * Ejecutar paso 9: Confirmación y seguimiento
   * 
   * @param {object} pedidoResult - Resultado del pedido
   * @returns {object} {message: string}
   */
  stepFollowUp(pedidoResult = {}) {
    try {
      let message = '';

      if (pedidoResult.success && pedidoResult.confirmado) {
        message = `🎉 *¡Gracias por tu compra!*\n\n`;
        message += `✅ Tu pedido ${pedidoResult.numero_pedido} ha sido confirmado.\n\n`;
        message += `📦 *Detalles del pedido:*\n`;
        message += `Número: ${pedidoResult.numero_pedido}\n`;
        message += `Fecha: ${new Date().toLocaleDateString('es-PE')}\n\n`;
        message += `💬 Te notificaremos cuando tu pedido esté listo para envío.\n\n`;
        message += `¿Necesitas algo más? Escribe "AYUDA" para ver opciones.`;
      } else if (pedidoResult.success && !pedidoResult.confirmado) {
        message = `✅ Tu pedido ${pedidoResult.numero_pedido} está pendiente de confirmación.\n\n`;
        message += `💬 Para confirmarlo, escribe "CONFIRMAR" o espera a que te contactemos.\n\n`;
        message += `¿Necesitas algo más?`;
      } else {
        message = `❌ Hubo un problema al procesar tu pedido.\n\n`;
        message += `Por favor, intenta de nuevo o contacta con soporte.\n\n`;
        message += `¿Necesitas ayuda? Escribe "AYUDA".`;
      }

      return {
        message,
        action: 'follow_up_sent'
      };
    } catch (error) {
      logger.error('Error en stepFollowUp:', error);
      return {
        message: 'Gracias por usar KARDEX. ¿Necesitas algo más?',
        error: error.message
      };
    }
  }
}

module.exports = new SalesFlowEngine();
