const sessionManager = require('./sessionManager');
const kardexApi = require('./kardexApi');
const logger = require('./utils/logger');
const config = require('../config/config');
const yapeQR = require('./utils/yapeQR');
const PhoneNormalizer = require('./utils/phoneNormalizer');

class OrderHandler {
  /**
   * Inicializar pedido vacío en BD
   */
  async initOrder(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      logger.info(`🆕 Inicializando pedido para ${phoneNumber}`);

      // Obtener o crear cliente (pasar sessionState para usar datos del cliente si están disponibles)
      const clienteId = await this._obtenerOcrearCliente(phoneNumber, sessionState);
      if (!clienteId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '❌ No se pudo crear tu perfil. Por favor, contacta con soporte.'
        );
        return null;
      }

      // Crear pedido vacío en BD
      const pedidoResult = await kardexApi.crearPedidoVacio(clienteId, phoneNumber);
      
      if (!pedidoResult.success) {
        logger.error('Error al crear pedido vacío:', pedidoResult.error);
        await whatsappHandler.sendMessage(
          phoneNumber,
          '❌ Hubo un error al iniciar tu pedido. Por favor, intenta nuevamente.'
        );
        return null;
      }

      // Guardar pedido activo en sesión
      await sessionManager.setActiveOrder(
        phoneNumber,
        pedidoResult.pedido_id,
        pedidoResult.numero_pedido
      );

      logger.success(`✅ Pedido iniciado: ${pedidoResult.numero_pedido} (ID: ${pedidoResult.pedido_id})`);
      
      return {
        pedido_id: pedidoResult.pedido_id,
        numero_pedido: pedidoResult.numero_pedido
      };
    } catch (error) {
      logger.error('Error al inicializar pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '❌ Hubo un error al iniciar tu pedido. Por favor, intenta nuevamente.'
      );
      return null;
    }
  }

  /**
   * Agregar producto al pedido en proceso
   */
  async addProductToOrder(phoneNumber, productoId, cantidad, productoNombre, whatsappHandler) {
    try {
      logger.info(`➕ Agregando producto al pedido: ${productoNombre} x${cantidad}`);

      // Obtener pedido activo
      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        // Si no hay pedido activo, crear uno
        const nuevoPedido = await this.initOrder(phoneNumber, whatsappHandler);
        if (!nuevoPedido) {
          return null;
        }
        return await this.addProductToOrder(phoneNumber, productoId, cantidad, productoNombre, whatsappHandler);
      }

      // Agregar producto al pedido en BD
      const result = await kardexApi.agregarProductoAPedido(pedidoId, productoId, cantidad);
      
      if (!result.success) {
        logger.error('Error al agregar producto:', result.error);
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ ${result.error || 'No se pudo agregar el producto al pedido.'}`
        );
        return null;
      }

      // Actualizar sesión con el pedido actualizado
      const pedidoActualizado = await kardexApi.getPedidoEnProceso(pedidoId);
      if (pedidoActualizado) {
        await sessionManager.updateSessionState(
          phoneNumber,
          sessionManager.STATES.PEDIDO_EN_PROCESO,
          {
            pedido_id: pedidoId,
            numero_pedido: pedidoActualizado.numero_pedido,
            productos: pedidoActualizado.detalles?.map(d => ({
              producto_id: d.producto_id,
              nombre: d.producto?.nombre || productoNombre,
              cantidad: d.cantidad,
              precio_unitario: parseFloat(d.precio_unitario),
              subtotal: parseFloat(d.subtotal)
            })) || [],
            total: parseFloat(pedidoActualizado.total)
          }
        );
      }

      // Mostrar resumen actualizado
      const resumen = this.generateOrderSummaryFromBD(pedidoActualizado);
      await whatsappHandler.sendMessage(phoneNumber, resumen);

      logger.success(`✅ Producto agregado: ${productoNombre} x${cantidad}`);
      
      return result;
    } catch (error) {
      logger.error('Error al agregar producto al pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '❌ Hubo un error al agregar el producto. Por favor, intenta nuevamente.'
      );
      return null;
    }
  }

  /**
   * Generar resumen del pedido desde BD
   */
  generateOrderSummaryFromBD(pedido) {
    if (!pedido || !pedido.detalles || pedido.detalles.length === 0) {
      return '📦 *Tu pedido está vacío*\n\nAgrega productos escribiendo sus nombres.';
    }

    let resumen = `📦 *Pedido ${pedido.numero_pedido}*\n\n`;
    
    pedido.detalles.forEach((detalle, index) => {
      const producto = detalle.producto || {};
      const subtotal = parseFloat(detalle.subtotal);
      resumen += `${index + 1}. *${producto.nombre || 'Producto'}*\n`;
      resumen += `   ${detalle.cantidad} x S/. ${parseFloat(detalle.precio_unitario).toFixed(2)} = S/. ${subtotal.toFixed(2)}\n\n`;
    });

    resumen += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    resumen += `💰 *Total: S/. ${parseFloat(pedido.total).toFixed(2)}*\n\n`;
    resumen += `💬 *Comandos:*\n`;
    resumen += `• "VER PEDIDO" - Ver resumen\n`;
    resumen += `• "ELIMINAR [producto]" - Quitar producto\n`;
    resumen += `• "CONFIRMAR" - Finalizar pedido\n`;
    resumen += `• "CANCELAR" - Cancelar pedido`;

    return resumen;
  }

  /**
   * Agregar productos al pedido (múltiples productos)
   */
  async addProductsToOrder(phoneNumber, orderData, whatsappHandler, sessionState = {}) {
    try {
      logger.info(`➕ Agregando productos al pedido para ${phoneNumber}`);

      // Verificar si hay pedido activo, si no crear uno
      let pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        const nuevoPedido = await this.initOrder(phoneNumber, whatsappHandler, sessionState);
        if (!nuevoPedido) {
          return;
        }
        pedidoId = nuevoPedido.pedido_id;
      }

      // Agregar cada producto al pedido
      const productosAgregados = [];
      const productosError = [];
      const productosSinStock = [];

      for (const producto of orderData.productos) {
        const result = await this.addProductToOrder(
          phoneNumber,
          producto.producto_id,
          producto.cantidad,
          producto.nombre,
          whatsappHandler
        );

        if (result && result.success) {
          productosAgregados.push(producto.nombre);
        } else {
          productosError.push(producto.nombre);
        }
      }

      // Informar productos sin stock si vienen marcados por la IA
      if (orderData.productosSinStock && Array.isArray(orderData.productosSinStock) && orderData.productosSinStock.length > 0) {
        productosSinStock.push(...orderData.productosSinStock.map(p => p.nombre));
        const productSuggestions = require('./utils/productSuggestions');
        
        let msg = '❌ *Estos productos no tienen stock suficiente:*\n\n';
        for (const p of orderData.productosSinStock) {
          msg += `• *${p.nombre}*\n`;
          msg += `  Solicitado: ${p.cantidad} | Disponible: ${p.stock_disponible}\n\n`;
          
          // Buscar alternativas con stock para cada producto sin stock
          const alternativas = await productSuggestions.getSimilarProducts(p.nombre, 3);
          const alternativasConStock = alternativas.filter(a => (a.stock_actual || 0) > 0);
          
          if (alternativasConStock.length > 0) {
            msg += `💡 *Alternativas similares con stock:*\n`;
            alternativasConStock.forEach((alt, idx) => {
              msg += `  ${idx + 1}. ${alt.nombre} — S/ ${(parseFloat(alt.precio_venta || 0)).toFixed(2)} (Stock: ${alt.stock_actual})\n`;
            });
            msg += '\n';
          }
        }
        msg += '💬 *Para agregar alguna alternativa, escribe su nombre.*';
        await whatsappHandler.sendMessage(phoneNumber, msg);
      }
      
      // Informar productos no encontrados con sugerencias
      if (orderData.productosNoEncontrados && Array.isArray(orderData.productosNoEncontrados) && orderData.productosNoEncontrados.length > 0) {
        const productSuggestions = require('./utils/productSuggestions');
        
        for (const productoNombre of orderData.productosNoEncontrados) {
          // Buscar sugerencias para cada producto no encontrado
          const sugerencias = await productSuggestions.getSimilarProducts(productoNombre, 5);
          
          if (sugerencias && sugerencias.length > 0) {
            await whatsappHandler.sendMessage(
              phoneNumber,
              productSuggestions.formatSuggestions(sugerencias, `❌ No encontré "${productoNombre}"`)
            );
          } else {
            // Si no hay sugerencias, mostrar productos populares
            const populares = await productSuggestions.getPopularProducts(5);
            if (populares && populares.length > 0) {
              await whatsappHandler.sendMessage(
                phoneNumber,
                `❌ No encontré "${productoNombre}" en nuestro catálogo.\n\n` +
                `💡 *Te sugiero estos productos populares:*\n\n` +
                populares.map((p, i) => 
                  `${i + 1}. *${p.nombre}* — S/ ${(parseFloat(p.precio_venta || 0)).toFixed(2)}`
                ).join('\n') +
                `\n\n💬 Escribe *"CATALOGO"* para ver más productos.`
              );
            }
          }
        }
      }

      // Mostrar resumen final
      if (productosAgregados.length > 0) {
        const pedidoActualizado = await kardexApi.getPedidoEnProceso(pedidoId);
        if (pedidoActualizado) {
          const resumen = this.generateOrderSummaryFromBD(pedidoActualizado);
          await whatsappHandler.sendMessage(phoneNumber, resumen);
        }
      }

      if (productosError.length > 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `⚠️ No se pudieron agregar: ${productosError.join(', ')}`
        );
      }

    } catch (error) {
      logger.error('Error al agregar productos al pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '❌ Hubo un error al procesar tu pedido. Por favor, intenta nuevamente.'
      );
    }
  }

  /**
   * Crear pedido pendiente
   */
  async createPendingOrder(phoneNumber, orderData, whatsappHandler, sessionState = {}) {
    try {
      logger.info(`📦 Creando pedido pendiente para ${phoneNumber}`);

      // Guardar pedido en la sesión
      await sessionManager.updateSessionState(
        phoneNumber,
        sessionManager.STATES.AWAITING_CONFIRMATION,
        orderData
      );

      // Generar resumen del pedido
      const resumen = this.generateOrderSummary(orderData);

      // Enviar resumen al cliente
      await whatsappHandler.sendMessage(phoneNumber, resumen);

      // Guardar pedido pendiente en base de datos
      await sessionManager.createPendingOrder(phoneNumber, {
        productos: orderData.productos,
        total: orderData.total,
        direccion: orderData.direccion || null,
        fecha: orderData.fecha || null,
        hora: orderData.hora || null,
        metodoPago: orderData.metodoPago || 'YAPE'
      });

      logger.success(`✅ Pedido pendiente creado para ${phoneNumber}`);

    } catch (error) {
      logger.error('Error al crear pedido pendiente', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al crear tu pedido. Por favor, intenta nuevamente.'
      );
    }
  }

  /**
   * Generar resumen del pedido
   */
  generateOrderSummary(orderData) {
    // Si hay un mensaje personalizado del NLU, usarlo como base
    if (orderData.message) {
      let resumen = orderData.message;
      
      // Agregar información faltante si existe
      if (orderData.missingInfo && orderData.missingInfo.length > 0) {
        resumen += '\n\n📋 *Para completar tu pedido, necesito:*\n';
        orderData.missingInfo.forEach(info => {
          resumen += `• ${info}\n`;
        });
      }
      
      // Agregar sugerencias si hay
      if (orderData.suggestions && orderData.suggestions.length > 0) {
        resumen += '\n\n💡 *También te podría interesar:*\n';
        orderData.suggestions.forEach(sug => {
          resumen += `• ${sug}\n`;
        });
      }
      
      // Agregar instrucciones de confirmación
      if (!orderData.missingInfo || orderData.missingInfo.length === 0) {
        resumen += '\n\n✅ *¿Confirmas este pedido?*\n';
        resumen += 'Escribe *CONFIRMO* para confirmar o *CANCELAR* para cancelar.';
      } else {
        resumen += '\n\n💬 *Puedes proporcionar esta información en tu siguiente mensaje.*';
      }
      
      return resumen;
    }
    
    // Mensaje tradicional si no hay mensaje personalizado
    let resumen = '📦 *Resumen de tu pedido:*\n\n';

    // Productos
    if (orderData.productos && orderData.productos.length > 0) {
      orderData.productos.forEach((producto, index) => {
        const subtotal = producto.cantidad * producto.precio_unitario;
        resumen += `${index + 1}. *${producto.nombre}*\n`;
        resumen += `   ${producto.cantidad} x S/. ${Number(producto.precio_unitario).toFixed(2)} = S/. ${subtotal.toFixed(2)}\n`;
        
        if (producto.stock_disponible !== undefined) {
          resumen += `   📦 Stock disponible: ${producto.stock_disponible}\n`;
        }
        resumen += '\n';
      });
    }

    // Información adicional
    if (orderData.direccion) {
      resumen += `📍 *Dirección de entrega:*\n${orderData.direccion}\n\n`;
    }

    if (orderData.fecha) {
      resumen += `📅 *Fecha de entrega:* ${orderData.fecha}\n`;
    }

    if (orderData.hora) {
      resumen += `⏰ *Hora:* ${orderData.hora}\n`;
    }

    if (orderData.metodoPago) {
      resumen += `💳 *Método de pago:* ${orderData.metodoPago}\n\n`;
    }

    // Total
    resumen += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    resumen += `💰 *Total: S/. ${Number(orderData.total).toFixed(2)}*\n\n`;

    // Productos no encontrados
    if (orderData.productosNoEncontrados && orderData.productosNoEncontrados.length > 0) {
      resumen += `⚠️ *Nota:* No encontré estos productos: ${orderData.productosNoEncontrados.join(', ')}\n`;
      resumen += `💡 Te enviaré sugerencias de productos similares en un mensaje aparte.\n\n`;
    }

    // Instrucciones
    resumen += `✅ *¿Confirmas este pedido?*\n`;
    resumen += `Escribe *CONFIRMO* para confirmar o *CANCELAR* para cancelar.`;

    return resumen;
  }

  /**
   * Confirmar pedido
   */
  async confirmOrder(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      logger.info(`✅ Confirmando pedido para ${phoneNumber}`);

      const session = await sessionManager.getSession(phoneNumber);

      if (!session.current_order) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '❌ No tienes ningún pedido pendiente para confirmar.'
        );
        return;
      }

      // Obtener pedido desde BD
      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '❌ No tienes un pedido activo para confirmar.'
        );
        return;
      }

      const pedido = await kardexApi.getPedidoEnProceso(pedidoId);
      
      if (!pedido || !pedido.detalles || pedido.detalles.length === 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '❌ Tu pedido está vacío. Agrega productos antes de confirmar.'
        );
        return;
      }

      // Convertir detalles del pedido al formato esperado por verificarPedido
      const productosParaVerificar = pedido.detalles.map(detalle => ({
        producto_id: detalle.producto_id,
        cantidad: detalle.cantidad
      }));

      logger.info('Verificando pedido antes de confirmar', {
        pedido_id: pedidoId,
        productosCount: productosParaVerificar.length,
        productos: productosParaVerificar
      });

      // Verificar stock nuevamente antes de confirmar
      const verificacion = await kardexApi.verificarPedido(productosParaVerificar);

      if (!verificacion.success) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ ${verificacion.error}\n\nTu pedido no pudo ser procesado. Por favor, realiza un nuevo pedido.`
        );
        await sessionManager.clearSession(phoneNumber);
        return;
      }

      // Obtener o crear cliente en KARDEX (usar sessionState si está disponible)
      let clienteId = await this._obtenerOcrearCliente(phoneNumber, sessionState);
      
      if (!clienteId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '❌ No se pudo registrar tu información. Por favor, contacta con soporte.'
        );
        return;
      }

      // El pedido ya existe en BD, solo necesitamos crear la venta
      logger.success(`✅ Confirmando pedido existente: ${pedido.numero_pedido} (ID: ${pedidoId})`);

      // Crear VENTA asociada al pedido (para facturación inmediata)
      const ventaResult = await kardexApi.crearVenta({
        cliente_id: clienteId,
        total: verificacion.total,
        subtotal: verificacion.total,
        detalles: verificacion.productos.map(p => ({
          producto_id: p.producto_id,
          cantidad: p.cantidad,
          precio_unitario: p.precio_unitario
        })),
        observaciones: `Pedido ${pedido.numero_pedido} desde WhatsApp - ${phoneNumber}`,
        telefono: phoneNumber
      });

      if (!ventaResult.success) {
        logger.error('Error al crear venta:', ventaResult.error);
        // Aunque falle la venta, el pedido ya está creado
        await whatsappHandler.sendMessage(
          phoneNumber,
          `⚠️ Tu pedido ${pedido.numero_pedido} fue creado, pero hubo un error al generar la factura. Contacta con soporte.`
        );
        return;
      }

      // Generar QR de Yape
      let qrPath = null;
      try {
        qrPath = await yapeQR.generateYapeQR(
          config.payment.yape.number,
          verificacion.total,
          `Pedido ${ventaResult.numero_factura}`
        );
        logger.success(`✅ QR de Yape generado: ${qrPath}`);
      } catch (qrError) {
        logger.error('Error al generar QR de Yape:', qrError);
      }

      // Notificar a vendedores/administradores
      const notificacionResult = await kardexApi.notificarPedidoWhatsApp({
        telefono: phoneNumber,
        productos: verificacion.productos,
        total: verificacion.total,
        direccion: null,
        fecha: null,
        hora: null,
        metodoPago: null,
        observaciones: `Pedido ${pedido.numero_pedido} confirmado desde WhatsApp`,
        numero_factura: ventaResult.numero_factura
      });

      // Actualizar estado de la sesión con información completa
      await sessionManager.updateSessionState(
        phoneNumber,
        sessionManager.STATES.AWAITING_PAYMENT,
        {
          pedido_id: pedidoId,
          numero_pedido: pedido.numero_pedido,
          pedido_estado: 'APROBADO',
          venta_id: ventaResult.venta_id,
          numero_factura: ventaResult.numero_factura,
          total: verificacion.total
        }
      );

      // Enviar confirmación al cliente con pedido, factura y QR
      let mensaje = '✅ *¡Pedido confirmado y factura generada!* 🎉\n\n';
      mensaje += `📦 *Pedido N°:* ${pedido.numero_pedido}\n`;
      mensaje += `📄 *Factura N°:* ${ventaResult.numero_factura}\n`;
      mensaje += `💰 *Total:* S/. ${Number(verificacion.total).toFixed(2)}\n\n`;
      
      mensaje += `💳 *Información de pago:*\n`;
      mensaje += `Yape: ${config.payment.yape.number}\n`;
      mensaje += `A nombre de: ${config.payment.yape.name}\n\n`;
      
      if (qrPath) {
        mensaje += '📱 *Escanea el QR de Yape para pagar:*\n';
        // Enviar imagen del QR
        try {
          const fs = require('fs');
          const qrBuffer = await fs.promises.readFile(qrPath);
          await whatsappHandler.sendImage(phoneNumber, qrBuffer, `QR_Yape_${ventaResult.numero_factura}.png`);
          mensaje += '(QR enviado arriba)\n\n';
        } catch (imgError) {
          logger.error('Error al enviar QR:', imgError);
          mensaje += 'Por favor, realiza el pago manualmente.\n\n';
        }
      }
      
      mensaje += 'Cuando realices el pago, escribe *PAGADO* para confirmar.';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

      // Limpiar sesión después de 30 minutos
      setTimeout(async () => {
        await sessionManager.clearSession(phoneNumber);
      }, 30 * 60 * 1000);

      logger.success(`✅ Pedido ${pedido.numero_pedido} confirmado, factura ${ventaResult.numero_factura} creada y QR enviado para ${phoneNumber}`);

    } catch (error) {
      logger.error('Error al confirmar pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al confirmar tu pedido. Por favor, intenta nuevamente o contacta con soporte.'
      );
    }
  }

  /**
   * Ver pedido actual
   */
  async viewOrder(phoneNumber, whatsappHandler) {
    try {
      logger.info(`📊 Mostrando pedido para ${phoneNumber}`);

      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📦 *No tienes un pedido activo*\n\n' +
            'Para iniciar un pedido, escribe el nombre de un producto o "quiero hacer un pedido".'
        );
        return;
      }

      const pedido = await kardexApi.getPedidoEnProceso(pedidoId);
      
      if (!pedido) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '❌ No se pudo obtener la información de tu pedido. Por favor, intenta nuevamente.'
        );
        return;
      }

      const resumen = this.generateOrderSummaryFromBD(pedido);
      await whatsappHandler.sendMessage(phoneNumber, resumen);

    } catch (error) {
      logger.error('Error al ver pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '❌ Hubo un error al obtener tu pedido. Por favor, intenta nuevamente.'
      );
    }
  }

  /**
   * Eliminar producto del pedido
   */
  async removeProductFromOrder(phoneNumber, productName, whatsappHandler) {
    try {
      logger.info(`➖ Eliminando producto del pedido: ${productName}`);

      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          'No tienes un pedido activo.'
        );
        return;
      }

      // Obtener pedido actual
      const pedido = await kardexApi.getPedidoEnProceso(pedidoId);
      
      if (!pedido || !pedido.detalles || pedido.detalles.length === 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          'Tu pedido está vacío.'
        );
        return;
      }

      // Buscar el producto por nombre (fuzzy match)
      const productoEncontrado = pedido.detalles.find(detalle => {
        const nombreProducto = detalle.producto?.nombre?.toLowerCase() || '';
        const nombreBuscado = productName.toLowerCase();
        return nombreProducto.includes(nombreBuscado) || nombreBuscado.includes(nombreProducto);
      });

      if (!productoEncontrado) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `No encontré "${productName}" en tu pedido.\n\n` +
          'Escribe "VER PEDIDO" para ver los productos actuales.'
        );
        return;
      }

      // Eliminar producto del pedido
      const result = await kardexApi.eliminarProductoDePedido(pedidoId, productoEncontrado.id);
      
      if (!result.success) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ ${result.error || 'No se pudo eliminar el producto.'}`
        );
        return;
      }

      // Actualizar sesión y mostrar resumen
      const pedidoActualizado = await kardexApi.getPedidoEnProceso(pedidoId);
      if (pedidoActualizado) {
        await sessionManager.updateSessionState(
          phoneNumber,
          sessionManager.STATES.PEDIDO_EN_PROCESO,
          {
            pedido_id: pedidoId,
            numero_pedido: pedidoActualizado.numero_pedido,
            productos: pedidoActualizado.detalles?.map(d => ({
              producto_id: d.producto_id,
              nombre: d.producto?.nombre,
              cantidad: d.cantidad,
              precio_unitario: parseFloat(d.precio_unitario),
              subtotal: parseFloat(d.subtotal)
            })) || [],
            total: parseFloat(pedidoActualizado.total)
          }
        );

        const resumen = this.generateOrderSummaryFromBD(pedidoActualizado);
        await whatsappHandler.sendMessage(phoneNumber, resumen);
      }

      logger.success(`✅ Producto eliminado: ${productName}`);
    } catch (error) {
      logger.error('Error al eliminar producto del pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '❌ Hubo un error al eliminar el producto. Por favor, intenta nuevamente.'
      );
    }
  }

  /**
   * Cancelar pedido (en proceso o confirmado)
   */
  async cancelOrder(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      logger.info(`❌ Cancelando pedido para ${phoneNumber}`);

      const session = await sessionManager.getSession(phoneNumber);
      const stateObj = session?.current_order ? JSON.parse(session.current_order) : {};
      const currentState = session?.state || sessionManager.STATES.IDLE;

      // Si está esperando confirmación de cancelación, procesar confirmación
      if (currentState === sessionManager.STATES.AWAITING_CANCEL_CONFIRMATION) {
        const pedidoIdACancelar = stateObj._pedido_a_cancelar;
        const userToken = sessionState.user_token || sessionState._user_token || stateObj._user_token;

        if (!pedidoIdACancelar) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
          await whatsappHandler.sendMessage(phoneNumber, '❌ No se pudo identificar el pedido a cancelar.');
          return;
        }

        // Verificar estado del pedido antes de cancelar
        const pedidoDetalle = userToken 
          ? await kardexApi.getDetallePedido(pedidoIdACancelar, userToken)
          : await kardexApi.getPedidoEnProceso(pedidoIdACancelar);

        if (!pedidoDetalle.success || !pedidoDetalle.data) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
          await whatsappHandler.sendMessage(phoneNumber, '❌ No se pudo obtener la información del pedido.');
          return;
        }

        const pedido = pedidoDetalle.data;
        const estado = pedido.estado || 'PENDIENTE';

        // Verificar que el pedido sea cancelable
        const estadosCancelables = ['PENDIENTE', 'APROBADO', 'EN_PROCESO'];
        if (!estadosCancelables.includes(estado)) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
          await whatsappHandler.sendMessage(
            phoneNumber,
            `❌ *No se puede cancelar este pedido*\n\n` +
            `El pedido N° ${pedido.numero_pedido || pedidoIdACancelar} está en estado: *${this._translateEstado(estado)}*\n\n` +
            `Solo se pueden cancelar pedidos pendientes, aprobados o en proceso.\n\n` +
            `Si ya está completado o procesado, contacta con soporte para más opciones.`
          );
          return;
        }

        // Cancelar el pedido
        let result;
        if (userToken && (estado === 'APROBADO' || estado === 'EN_PROCESO')) {
          result = await kardexApi.cancelarPedido(pedidoIdACancelar, userToken);
        } else {
          result = await kardexApi.cancelarPedidoEnProceso(pedidoIdACancelar);
        }

        if (!result.success) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
          await whatsappHandler.sendMessage(
            phoneNumber,
            `❌ ${result.error || result.message || 'No se pudo cancelar el pedido.'}`
          );
          return;
        }

        // Limpiar sesión
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
        
        await whatsappHandler.sendMessage(
          phoneNumber,
          '✅ *Pedido cancelado exitosamente*\n\n' +
          `El pedido N° ${pedido.numero_pedido || pedidoIdACancelar} ha sido cancelado.\n\n` +
          'Si necesitas algo más, solo escríbeme. 😊'
        );

        logger.success(`✅ Pedido ${pedidoIdACancelar} cancelado para ${phoneNumber}`);
        return;
      }

      // Si no está en confirmación, buscar pedido activo o confirmado
      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      const userToken = sessionState.user_token || sessionState._user_token || stateObj._user_token;
      
      // Si hay pedido activo en sesión, cancelarlo directamente
      if (pedidoId && currentState === sessionManager.STATES.PEDIDO_EN_PROCESO) {
        const result = await kardexApi.cancelarPedidoEnProceso(pedidoId);
        
        if (!result.success) {
          await whatsappHandler.sendMessage(
            phoneNumber,
            `❌ ${result.error || 'No se pudo cancelar el pedido.'}`
          );
          return;
        }

        await sessionManager.clearSession(phoneNumber);
        
        await whatsappHandler.sendMessage(
          phoneNumber,
          '✅ *Pedido cancelado*\n\n' +
          'Tu pedido ha sido cancelado exitosamente.\n\n' +
          'Si necesitas algo más, solo escríbeme. 😊'
        );

        logger.success(`✅ Pedido cancelado para ${phoneNumber}`);
        return;
      }

      // Si no hay pedido activo, buscar pedidos confirmados del cliente
      if (userToken) {
        const pedidosResult = await kardexApi.getMisPedidos(userToken);
        const pedidosPendientes = pedidosResult.success 
          ? pedidosResult.data.filter(p => ['PENDIENTE', 'APROBADO', 'EN_PROCESO'].includes(p.estado))
          : [];

        if (pedidosPendientes.length === 0) {
          await whatsappHandler.sendMessage(
            phoneNumber,
            '📋 *No hay pedidos para cancelar*\n\n' +
            'No tienes pedidos pendientes o en proceso que puedan ser cancelados.\n\n' +
            'Escribe *"mis pedidos"* para ver tu historial completo.'
          );
          return;
        }

        // Si hay un solo pedido, solicitar confirmación para cancelarlo
        if (pedidosPendientes.length === 1) {
          const pedido = pedidosPendientes[0];
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_CANCEL_CONFIRMATION, {
            _pedido_a_cancelar: pedido.id,
            _user_token: userToken
          });

          await whatsappHandler.sendMessage(
            phoneNumber,
            `⚠️ *¿Confirmas la cancelación?*\n\n` +
            `Pedido N° ${pedido.numero_pedido || pedido.id}\n` +
            `Estado: ${this._translateEstado(pedido.estado)}\n` +
            `Total: S/ ${(pedido.total || 0).toFixed(2)}\n\n` +
            `Escribe *"SI"* o *"CONFIRMO"* para cancelar el pedido.\n` +
            `O escribe *"NO"* o *"CANCELAR"* para volver.`
          );
          return;
        }

        // Si hay varios pedidos, listarlos y pedir que especifique cuál cancelar
        let mensaje = '📋 *Tienes varios pedidos pendientes*\n\n';
        mensaje += '*PEDIDOS PENDIENTES:*\n\n';
        
        pedidosPendientes.slice(0, 5).forEach((pedido, index) => {
          mensaje += `${index + 1}. *Pedido N° ${pedido.numero_pedido || pedido.id}*\n`;
          mensaje += `   Estado: ${this._translateEstado(pedido.estado)}\n`;
          mensaje += `   Total: S/ ${(pedido.total || 0).toFixed(2)}\n`;
          mensaje += `   *Cancelar:* Escribe "cancelar pedido ${pedido.numero_pedido || pedido.id}"\n\n`;
        });

        mensaje += '💡 Escribe *"cancelar pedido N°"* para cancelar un pedido específico.';

        await whatsappHandler.sendMessage(phoneNumber, mensaje);
        return;
      }

      // Si no hay token, solo puede cancelar pedido en proceso
      if (!pedidoId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📋 *No hay pedidos para cancelar*\n\n' +
          'No tienes ningún pedido activo para cancelar.\n\n' +
          'Para cancelar pedidos confirmados, necesitas estar autenticado.\n' +
          'Escribe *"mis pedidos"* para ver tu historial (requiere autenticación).'
        );
        return;
      }

    } catch (error) {
      logger.error('Error al cancelar pedido', error);
      await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al cancelar tu pedido. Por favor, intenta más tarde.'
      );
    }
  }

  /**
   * Cancelar pedido confirmado específico
   */
  async cancelConfirmedOrder(phoneNumber, pedidoId, whatsappHandler, sessionState = {}) {
    try {
      const userToken = sessionState.user_token || sessionState._user_token;
      
      if (!userToken) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '🔐 *Acceso restringido*\n\n' +
          'Para cancelar un pedido confirmado, necesitas estar autenticado.\n\n' +
          'Por favor, inicia sesión con tu contraseña de la página web.'
        );
        return;
      }

      logger.info(`❌ Cancelando pedido confirmado ${pedidoId} para ${phoneNumber}`);

      // Obtener detalle del pedido
      const pedidoDetalle = await kardexApi.getDetallePedido(pedidoId, userToken);

      if (!pedidoDetalle.success || !pedidoDetalle.data) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ No se encontró el pedido N° ${pedidoId}.\n\n` +
          'Verifica el número o escribe *"mis pedidos"* para ver tu historial.'
        );
        return;
      }

      const pedido = pedidoDetalle.data;
      const estado = pedido.estado || 'PENDIENTE';

      // Verificar que el pedido sea cancelable
      const estadosCancelables = ['PENDIENTE', 'APROBADO', 'EN_PROCESO'];
      if (!estadosCancelables.includes(estado)) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ *No se puede cancelar este pedido*\n\n` +
          `El pedido N° ${pedido.numero_pedido || pedidoId} está en estado: *${this._translateEstado(estado)}*\n\n` +
          `Solo se pueden cancelar pedidos pendientes, aprobados o en proceso.\n\n` +
          `Si ya está completado o procesado, contacta con soporte para más opciones.`
        );
        return;
      }

      // Solicitar confirmación
      await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_CANCEL_CONFIRMATION, {
        _pedido_a_cancelar: pedidoId,
        _user_token: userToken
      });

      await whatsappHandler.sendMessage(
        phoneNumber,
        `⚠️ *¿Confirmas la cancelación?*\n\n` +
        `*Pedido N°:* ${pedido.numero_pedido || pedidoId}\n` +
        `*Estado:* ${this._translateEstado(estado)}\n` +
        `*Total:* S/ ${(pedido.total || 0).toFixed(2)}\n\n` +
        `Escribe *"SI"* o *"CONFIRMO"* para cancelar el pedido.\n` +
        `O escribe *"NO"* o *"CANCELAR"* para volver.`
      );

    } catch (error) {
      logger.error('Error al procesar cancelación de pedido confirmado', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al procesar la cancelación. Por favor, intenta más tarde.'
      );
    }
  }

  /**
   * Mostrar enlace de pago Yape
   */
  async showYapePayment(phoneNumber, orderData, whatsappHandler) {
    try {
      logger.info(`💳 Mostrando enlace de pago Yape para ${phoneNumber}`);

      const paymentLinks = require('./utils/paymentLinks');
      const yapeQR = require('./utils/yapeQR');
      const config = require('../config/config');

      const total = orderData.total || 0;
      const concepto = orderData.numero_pedido 
        ? `Pedido ${orderData.numero_pedido}` 
        : `Pedido WhatsApp ${phoneNumber}`;

      // Generar deep link
      const paymentLink = paymentLinks.generateYapeLink(total, phoneNumber, concepto);

      if (!paymentLink) {
        // Fallback: solo QR
        await this._sendYapeQROnly(phoneNumber, total, concepto, whatsappHandler);
        return;
      }

      // Mensaje con enlace
      let mensaje = '💳 *Pago con Yape*\n\n';
      mensaje += `💰 *Monto:* S/. ${paymentLink.amount}\n`;
      mensaje += `📱 *Yape:* ${paymentLink.phone}\n`;
      mensaje += `📝 *Concepto:* ${concepto}\n\n`;
      mensaje += `🔗 *Haz clic en el enlace para pagar:*\n`;
      mensaje += `${paymentLink.deepLink}\n\n`;
      mensaje += `O escanea el QR que aparece abajo 👇\n\n`;
      mensaje += `Cuando realices el pago, escribe *PAGADO* para confirmar.`;

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

      // Generar y enviar QR
      try {
        const qrPath = await yapeQR.generateYapeQR(
          config.payment.yape.number,
          total,
          concepto
        );
        
        const fs = require('fs');
        const qrBuffer = await fs.promises.readFile(qrPath);
        await whatsappHandler.sendImage(
          phoneNumber, 
          qrBuffer, 
          `QR_Yape_${concepto.replace(/\s+/g, '_')}.png`
        );
        
        logger.success(`✅ QR de Yape enviado para ${phoneNumber}`);
      } catch (qrError) {
        logger.error('Error al generar/enviar QR de Yape', qrError);
        // Continuar aunque falle el QR
      }

    } catch (error) {
      logger.error('Error al mostrar pago Yape', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        'Hubo un error al generar el enlace de pago. Por favor, intenta de nuevo.'
      );
    }
  }

  /**
   * Mostrar enlace de pago Plin
   */
  async showPlinPayment(phoneNumber, orderData, whatsappHandler) {
    try {
      logger.info(`💳 Mostrando enlace de pago Plin para ${phoneNumber}`);

      const paymentLinks = require('./utils/paymentLinks');
      const config = require('../config/config');

      const total = orderData.total || 0;
      const concepto = orderData.numero_pedido 
        ? `Pedido ${orderData.numero_pedido}` 
        : `Pedido WhatsApp ${phoneNumber}`;

      // Generar deep link
      const paymentLink = paymentLinks.generatePlinLink(total, phoneNumber, concepto);

      if (!paymentLink) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          'Hubo un error al generar el enlace de pago Plin. Por favor, contacta con soporte.'
        );
        return;
      }

      // Mensaje con enlace
      let mensaje = '💳 *Pago con Plin*\n\n';
      mensaje += `💰 *Monto:* S/. ${paymentLink.amount}\n`;
      mensaje += `📱 *Plin:* ${paymentLink.phone}\n`;
      mensaje += `📝 *Concepto:* ${concepto}\n\n`;
      mensaje += `🔗 *Haz clic en el enlace para pagar:*\n`;
      mensaje += `${paymentLink.deepLink}\n\n`;
      mensaje += `Cuando realices el pago, escribe *PAGADO* para confirmar.`;

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al mostrar pago Plin', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        'Hubo un error al generar el enlace de pago. Por favor, intenta de nuevo.'
      );
    }
  }

  /**
   * Enviar solo QR de Yape (fallback)
   */
  async _sendYapeQROnly(phoneNumber, total, concepto, whatsappHandler) {
    try {
      const yapeQR = require('./utils/yapeQR');
      const config = require('../config/config');

      let mensaje = '💳 *Pago con Yape*\n\n';
      mensaje += `💰 *Monto:* S/. ${parseFloat(total).toFixed(2)}\n`;
      mensaje += `📱 *Yape:* ${config.payment.yape.number}\n`;
      mensaje += `📝 *Concepto:* ${concepto}\n\n`;
      mensaje += `📱 *Escanea el QR para pagar:*\n\n`;
      mensaje += `Cuando realices el pago, escribe *PAGADO* para confirmar.`;

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

      const qrPath = await yapeQR.generateYapeQR(
        config.payment.yape.number,
        total,
        concepto
      );
      
      const fs = require('fs');
      const qrBuffer = await fs.promises.readFile(qrPath);
      await whatsappHandler.sendImage(
        phoneNumber, 
        qrBuffer, 
        `QR_Yape_${concepto.replace(/\s+/g, '_')}.png`
      );
    } catch (error) {
      logger.error('Error al enviar QR de Yape', error);
      throw error;
    }
  }

  /**
   * Manejar confirmación de pago
   */
  async handlePaymentConfirmed(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      logger.info(`💳 Procesando confirmación de pago para ${phoneNumber}`);

      const session = await sessionManager.getSession(phoneNumber);
      let orderData = null;

      if (session.current_order) {
        orderData = JSON.parse(session.current_order);
      }

      // Actualizar estado del pedido en el sistema si existe
      if (orderData && orderData.pedido_id) {
        try {
          // Actualizar estado del pedido a COMPLETADO
          await kardexApi.actualizarEstadoPedido(orderData.pedido_id, 'COMPLETADO');
          logger.success(`Estado del pedido ${orderData.pedido_id} actualizado a COMPLETADO`);
        } catch (updateError) {
          logger.warn('No se pudo actualizar estado del pedido', updateError.message);
        }
      }

      // Actualizar estado de la sesión
      await sessionManager.updateSessionState(
        phoneNumber,
        sessionManager.STATES.PAGO_CONFIRMADO,
        orderData
      );

      let mensaje = '✅ *¡Pago confirmado!* 💰\n\n';
      
      if (orderData && orderData.numero_pedido) {
        mensaje += `📦 *Pedido N°:* ${orderData.numero_pedido}\n`;
      }
      
      if (orderData && orderData.numero_factura) {
        mensaje += `📄 *Factura N°:* ${orderData.numero_factura}\n`;
      }
      
      mensaje += '\nTu pago ha sido registrado. Nuestro equipo procesará tu pedido y te notificará cuando esté listo para entrega.\n\n';
      mensaje += '📞 Si tienes alguna pregunta, no dudes en contactarnos.\n\n';
      mensaje += '¡Gracias por tu compra! 🎉';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

      // Limpiar sesión después de un tiempo
      setTimeout(async () => {
        await sessionManager.clearSession(phoneNumber);
      }, 60 * 60 * 1000); // 1 hora

      logger.success(`✅ Pago confirmado para ${phoneNumber}`);

    } catch (error) {
      logger.error('Error al procesar confirmación de pago', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al procesar tu confirmación de pago.'
      );
    }
  }

  /**
   * Ver pedido actual (alias para checkOrderStatus)
   */
  async viewOrder(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      logger.info(`📊 Ver pedido actual para ${phoneNumber}`);
      
      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        // Si no hay pedido activo, mostrar mensaje útil
        const nombreCliente = sessionState.nombreCliente || '';
        const saludo = nombreCliente ? `Hola ${nombreCliente}` : 'Hola';
        
        await whatsappHandler.sendMessage(
          phoneNumber,
          `📦 *${saludo}, no tienes un pedido activo en este momento.*\n\n` +
          `💡 *¿Qué puedes hacer?*\n\n` +
          `• *Hacer un pedido:* Escribe lo que necesitas o envíalo por voz\n` +
          `• *Ver historial:* Escribe *"mis pedidos"* (requiere autenticación)\n` +
          `• *Ver catálogo:* Escribe *"CATALOGO"*\n` +
          `• *Ayuda:* Escribe *"AYUDA"*\n\n` +
          `🎤 *Ejemplo de pedido por voz:*\n` +
          `"Quiero una laptop HP y un mouse inalámbrico"`
        );
        return;
      }

      // Obtener pedido actualizado
      const pedido = await kardexApi.getPedidoEnProceso(pedidoId);
      
      if (!pedido || !pedido.detalles || pedido.detalles.length === 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📦 *Tu pedido está vacío*\n\n' +
          '💡 Agrega productos escribiendo lo que necesitas o enviándolo por voz.'
        );
        return;
      }

      // Mostrar resumen del pedido
      const resumen = this.generateOrderSummaryFromBD(pedido);
      await whatsappHandler.sendMessage(phoneNumber, resumen);

    } catch (error) {
      logger.error('Error al ver pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al obtener tu pedido. Por favor, intenta más tarde.'
      );
    }
  }

  /**
   * Verificar estado del pedido
   */
  async checkOrderStatus(phoneNumber, whatsappHandler) {
    try {
      logger.info(`📊 Verificando estado del pedido para ${phoneNumber}`);

      const session = await sessionManager.getSession(phoneNumber);
      let orderData = null;

      if (session.current_order) {
        orderData = JSON.parse(session.current_order);
      }

      // Si hay un pedido_id, consultar el pedido real desde la API
      if (orderData && orderData.pedido_id) {
        try {
          const pedido = await kardexApi.getPedidoById(orderData.pedido_id);
          
          if (pedido) {
            let mensaje = '📋 *Estado de tu pedido:*\n\n';
            mensaje += `📦 *Pedido N°:* ${pedido.numero_pedido || orderData.numero_pedido}\n`;
            mensaje += `📊 *Estado:* ${this._translateEstado(pedido.estado)}\n`;
            
            if (pedido.detalles && pedido.detalles.length > 0) {
              mensaje += `\n*Productos:*\n`;
              pedido.detalles.forEach((detalle, index) => {
                const producto = detalle.producto || {};
                mensaje += `${index + 1}. ${producto.nombre || 'Producto'} - ${detalle.cantidad} unidades\n`;
              });
            } else if (orderData.productos) {
              mensaje += `\n*Productos:*\n`;
              orderData.productos.forEach((producto, index) => {
                mensaje += `${index + 1}. ${producto.nombre} - ${producto.cantidad} unidades\n`;
              });
            }
            
            mensaje += `\n💰 *Total:* S/. ${Number(pedido.total || orderData.total || 0).toFixed(2)}\n`;
            
            if (pedido.fecha_pedido) {
              mensaje += `📅 *Fecha:* ${new Date(pedido.fecha_pedido).toLocaleDateString('es-PE')}\n`;
            }
            
            if (orderData.numero_factura) {
              mensaje += `\n📄 *Factura N°:* ${orderData.numero_factura}\n`;
            }
            
            await whatsappHandler.sendMessage(phoneNumber, mensaje);
            return;
          }
        } catch (apiError) {
          logger.warn('No se pudo consultar pedido desde API, usando datos de sesión', apiError.message);
        }
      }

      // Fallback: usar datos de sesión si no hay pedido_id o falló la consulta
      if (!orderData) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📋 No tienes pedidos activos en este momento.\n\n' +
          'Puedes hacer un nuevo pedido enviándome un mensaje con los productos que deseas.'
        );
        return;
      }

      let mensaje = '📋 *Estado de tu pedido:*\n\n';
      
      if (orderData.numero_pedido) {
        mensaje += `📦 *Pedido N°:* ${orderData.numero_pedido}\n`;
      }
      
      mensaje += `📊 *Estado:* ${this.getStatusMessage(session.state)}\n\n`;

      if (orderData.productos && orderData.productos.length > 0) {
        mensaje += '*Productos:*\n';
        orderData.productos.forEach((producto, index) => {
          mensaje += `${index + 1}. ${producto.nombre} - ${producto.cantidad} unidades\n`;
        });
        mensaje += `\n💰 Total: S/. ${Number(orderData.total).toFixed(2)}\n`;
      }

      if (orderData.numero_factura) {
        mensaje += `\n📄 *Factura N°:* ${orderData.numero_factura}\n`;
      }

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al verificar estado del pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al verificar el estado de tu pedido.'
      );
    }
  }

  /**
   * Traducir estado del pedido a español
   */
  _translateEstado(estado) {
    const estados = {
      'PENDIENTE': '⏳ Pendiente',
      'APROBADO': '✅ Aprobado',
      'RECHAZADO': '❌ Rechazado',
      'EN_PROCESO': '🔄 En proceso',
      'COMPLETADO': '✅ Completado',
      'CANCELADO': '❌ Cancelado'
    };
    return estados[estado] || estado;
  }

  /**
   * Obtener mensaje de estado
   */
  getStatusMessage(state) {
    const statusMessages = {
      [sessionManager.STATES.IDLE]: 'Sin pedidos',
      [sessionManager.STATES.AWAITING_ORDER]: 'Procesando pedido',
      [sessionManager.STATES.ORDER_PENDING]: 'Pedido pendiente',
      [sessionManager.STATES.AWAITING_CONFIRMATION]: '⏳ Esperando confirmación',
      [sessionManager.STATES.PEDIDO_CREADO]: '📦 Pedido creado en sistema',
      [sessionManager.STATES.AWAITING_PAYMENT]: '💳 Esperando pago',
      [sessionManager.STATES.PAGO_CONFIRMADO]: '✅ Pago confirmado',
      [sessionManager.STATES.COMPLETED]: '✅ Pedido completado'
    };

    return statusMessages[state] || 'Desconocido';
  }

  /**
   * Obtener o crear cliente en KARDEX por número de teléfono
   */
  async _obtenerOcrearCliente(phoneNumber, sessionState = {}) {
    try {
      // Limpiar número de teléfono (quitar +, espacios, etc.)
      const numeroLimpio = phoneNumber.replace(/[^0-9]/g, '');
      
      // Si el cliente está autenticado y tiene ID, usar ese directamente
      if (sessionState.cliente && sessionState.cliente.id) {
        logger.info(`✅ Usando cliente autenticado: ${sessionState.cliente.id} - ${sessionState.cliente.nombre}`);
        return sessionState.cliente.id;
      }
      
      // Si tiene datos temporales, crear cliente con esos datos
      if (sessionState.temp_data && sessionState.temp_data.nombre && sessionState.temp_data.dni) {
        logger.info(`📝 Creando cliente temporal con datos proporcionados: ${sessionState.temp_data.nombre}`);
        
        const clienteLite = await kardexApi.registerClientLite({
          name: sessionState.temp_data.nombre,
          dni: sessionState.temp_data.dni,
          phone: sessionState.temp_data.phone || numeroLimpio
        });
        
        if (clienteLite && clienteLite.id) {
          logger.success(`✅ Cliente temporal creado: ${clienteLite.id} - ${clienteLite.nombre}`);
          return clienteLite.id;
        }
      }
      
      // Si el cliente está en sessionState pero sin ID, buscar por teléfono
      if (sessionState.cliente && sessionState.cliente.telefono) {
        try {
          const axios = require('axios');
          const config = require('../config/config');
          const response = await axios.get(`${config.kardexApi.baseUrl}/clientes`, {
            params: { search: numeroLimpio, limit: 1 },
            headers: {
              'Authorization': config.kardexApi.authToken ? `Bearer ${config.kardexApi.authToken}` : undefined
            }
          });
          
          if (response.data && response.data.success && response.data.data?.clientes?.length > 0) {
            const cliente = response.data.data.clientes[0];
            logger.info(`✅ Cliente encontrado: ${cliente.id} - ${cliente.nombre}`);
            return cliente.id;
          }
        } catch (searchError) {
          logger.debug('Cliente no encontrado por teléfono...');
        }
      }
      
      // Buscar cliente por teléfono usando axios directamente
      try {
        const axios = require('axios');
        const config = require('../config/config');
        const response = await axios.get(`${config.kardexApi.baseUrl}/clientes`, {
          params: { search: numeroLimpio, limit: 1 },
          headers: {
            'Authorization': config.kardexApi.authToken ? `Bearer ${config.kardexApi.authToken}` : undefined
          }
        });
        
        if (response.data && response.data.success && response.data.data?.clientes?.length > 0) {
          const cliente = response.data.data.clientes[0];
          logger.info(`✅ Cliente encontrado: ${cliente.id} - ${cliente.nombre}`);
          return cliente.id;
        }
      } catch (searchError) {
        logger.debug('Cliente no encontrado, creando nuevo...');
      }
      
      // Si no existe, crear cliente básico
      try {
        const axios = require('axios');
        const config = require('../config/config');
        const response = await axios.post(`${config.kardexApi.baseUrl}/clientes`, {
          nombre: `Cliente WhatsApp ${numeroLimpio.substring(0, 4)}****`,
          telefono: numeroLimpio,
          email: `whatsapp_${numeroLimpio}@cliente.com`,
          tipo_documento: 'DNI',
          numero_documento: `WHATSAPP${numeroLimpio.substring(0, 8)}`,
          activo: true
        }, {
          headers: {
            'Authorization': config.kardexApi.authToken ? `Bearer ${config.kardexApi.authToken}` : undefined
          }
        });
        
        if (response.data && response.data.success) {
          const cliente = response.data.data;
          logger.success(`✅ Cliente creado: ${cliente.id} - ${cliente.nombre}`);
          return cliente.id;
        }
      } catch (createError) {
        logger.error('Error al crear cliente:', createError);
        // Si falla, usar cliente genérico (ID 1) como fallback
        logger.warn('⚠️ Usando cliente genérico (ID 1) como fallback');
        return 1;
      }
      
      return null;
    } catch (error) {
      logger.error('Error al obtener/crear cliente:', error);
      // Fallback a cliente genérico
      return 1;
    }
  }

  /**
   * Ver historial de pedidos y compras del cliente
   */
  async viewOrderHistory(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      const userToken = sessionState.user_token || sessionState._user_token;
      
      if (!userToken) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '🔐 *Acceso restringido*\n\n' +
          'Para ver tu historial de pedidos y compras, necesitas estar autenticado.\n\n' +
          'Por favor, inicia sesión con tu contraseña de la página web o escribe *HOLA* para comenzar.'
        );
        return;
      }

      logger.info(`📋 Obteniendo historial de pedidos/compras para ${phoneNumber}`);

      // Obtener pedidos
      const pedidosResult = await kardexApi.getMisPedidos(userToken);
      const pedidos = pedidosResult.success ? pedidosResult.data : [];

      // Obtener compras
      const comprasResult = await kardexApi.getMisCompras(userToken, 1, 10);
      const compras = comprasResult.success ? comprasResult.data : [];

      if (pedidos.length === 0 && compras.length === 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📋 *Tu historial*\n\n' +
          'No tienes pedidos ni compras registradas todavía.\n\n' +
          '💡 ¡Haz tu primer pedido escribiendo lo que necesitas o diciéndolo por voz!'
        );
        return;
      }

      let mensaje = '📋 *TU HISTORIAL*\n\n';

      // Mostrar pedidos pendientes/en proceso
      if (pedidos.length > 0) {
        mensaje += '📦 *PEDIDOS*:\n\n';
        const pedidosActivos = pedidos.slice(0, 5);
        
        for (const pedido of pedidosActivos) {
          const estado = this._translateEstado(pedido.estado || 'PENDIENTE');
          const fecha = pedido.fecha_creacion 
            ? new Date(pedido.fecha_creacion).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : 'Fecha no disponible';
          
          mensaje += `• *Pedido N° ${pedido.numero_pedido || pedido.id}*\n`;
          mensaje += `  ${estado} - ${fecha}\n`;
          mensaje += `  Total: S/ ${(pedido.total || 0).toFixed(2)}\n`;
          mensaje += `  *Ver detalles:* Escribe "ver pedido ${pedido.numero_pedido || pedido.id}"\n\n`;
        }

        if (pedidos.length > 5) {
          mensaje += `_... y ${pedidos.length - 5} pedido(s) más_\n\n`;
        }
      }

      // Mostrar compras completadas
      if (compras.length > 0) {
        mensaje += '✅ *COMPRAS COMPLETADAS*:\n\n';
        const comprasRecientes = compras.slice(0, 5);
        
        for (const compra of comprasRecientes) {
          const fecha = compra.fecha_venta 
            ? new Date(compra.fecha_venta).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : 'Fecha no disponible';
          
          mensaje += `• *Compra del ${fecha}*\n`;
          mensaje += `  Total: S/ ${(compra.total || 0).toFixed(2)}\n`;
          
          if (compra.numero_factura || compra.numero_comprobante) {
            mensaje += `  Factura: ${compra.numero_factura || compra.numero_comprobante}\n`;
          }
          
          mensaje += `  *Ver detalles:* Escribe "ver compra ${compra.id}"\n\n`;
        }

        if (compras.length > 5) {
          mensaje += `_... y ${compras.length - 5} compra(s) más_\n\n`;
        }
      }

      mensaje += '💡 *Para ver más detalles:* Escribe "ver pedido N°" o "ver compra ID"\n';
      mensaje += '💡 *Para ver facturas:* Escribe "mis facturas"';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al obtener historial de pedidos/compras', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al obtener tu historial. Por favor, intenta más tarde.'
      );
    }
  }

  /**
   * Ver facturas del cliente
   */
  async viewInvoices(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      const userToken = sessionState.user_token || sessionState._user_token;
      
      if (!userToken) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '🔐 *Acceso restringido*\n\n' +
          'Para ver tus facturas, necesitas estar autenticado.\n\n' +
          'Por favor, inicia sesión con tu contraseña de la página web o escribe *HOLA* para comenzar.'
        );
        return;
      }

      logger.info(`📄 Obteniendo facturas para ${phoneNumber}`);

      const facturasResult = await kardexApi.getMisFacturas(userToken, 1, 10);
      const facturas = facturasResult.success ? facturasResult.data : [];

      if (facturas.length === 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📄 *Tus facturas*\n\n' +
          'No tienes facturas registradas todavía.\n\n' +
          '💡 Las facturas aparecerán aquí después de completar una compra.'
        );
        return;
      }

      let mensaje = '📄 *TUS FACTURAS*\n\n';

      for (const factura of facturas.slice(0, 10)) {
        const fecha = factura.fecha_emision || factura.fecha_venta
          ? new Date(factura.fecha_emision || factura.fecha_venta).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : 'Fecha no disponible';
        
        mensaje += `• *Factura ${factura.numero_factura || factura.numero_comprobante || factura.id}*\n`;
        mensaje += `  Fecha: ${fecha}\n`;
        mensaje += `  Total: S/ ${(factura.total || 0).toFixed(2)}\n`;
        
        if (factura.estado) {
          mensaje += `  Estado: ${factura.estado}\n`;
        }
        
        mensaje += '\n';
      }

      if (facturas.length > 10) {
        mensaje += `_... y ${facturas.length - 10} factura(s) más_\n\n`;
      }

      mensaje += '💡 *Para ver detalles de una compra:* Escribe "ver compra ID"';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al obtener facturas', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al obtener tus facturas. Por favor, intenta más tarde.'
      );
    }
  }

  /**
   * Ver detalle de un pedido o compra específico
   */
  async viewPurchaseDetail(phoneNumber, pedidoId, whatsappHandler, sessionState = {}) {
    try {
      if (!pedidoId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '⚠️ No especificaste el número de pedido o compra.\n\n' +
          'Ejemplo: *"ver pedido 123"* o *"ver compra 456"*'
        );
        return;
      }

      const userToken = sessionState.user_token || sessionState._user_token;
      
      if (!userToken) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '🔐 *Acceso restringido*\n\n' +
          'Para ver detalles de un pedido o compra, necesitas estar autenticado.\n\n' +
          'Por favor, inicia sesión con tu contraseña de la página web.'
        );
        return;
      }

      logger.info(`🔍 Obteniendo detalle del pedido/compra ${pedidoId}`);

      // Intentar primero como pedido
      let detalle = await kardexApi.getDetallePedido(pedidoId, userToken);
      let esPedido = detalle.success;

      // Si no es pedido, intentar como compra
      if (!esPedido) {
        detalle = await kardexApi.getDetalleCompra(pedidoId, userToken);
        esPedido = false;
      }

      if (!detalle.success || !detalle.data) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ No se encontró el pedido o compra N° ${pedidoId}.\n\n` +
          'Verifica el número o escribe *"mis pedidos"* para ver tu historial.'
        );
        return;
      }

      const data = detalle.data;
      let mensaje = esPedido ? '📦 *DETALLE DEL PEDIDO*\n\n' : '✅ *DETALLE DE LA COMPRA*\n\n';
      
      if (esPedido) {
        mensaje += `*N° Pedido:* ${data.numero_pedido || data.id}\n`;
        mensaje += `*Estado:* ${this._translateEstado(data.estado || 'PENDIENTE')}\n`;
      } else {
        mensaje += `*N° Factura:* ${data.numero_factura || data.numero_comprobante || data.id}\n`;
        mensaje += `*Estado:* ${data.estado || 'COMPLETADA'}\n`;
      }

      const fecha = data.fecha_creacion || data.fecha_venta || data.fecha
        ? new Date(data.fecha_creacion || data.fecha_venta || data.fecha).toLocaleDateString('es-PE', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'Fecha no disponible';
      
      mensaje += `*Fecha:* ${fecha}\n\n`;

      // Mostrar productos
      if (data.detalles && data.detalles.length > 0) {
        mensaje += '*PRODUCTOS:*\n\n';
        let subtotal = 0;
        
        for (const detalleItem of data.detalles) {
          const nombre = detalleItem.producto?.nombre || detalleItem.nombre_producto || 'Producto';
          const cantidad = detalleItem.cantidad || 1;
          const precio = detalleItem.precio_unitario || detalleItem.precio || 0;
          const itemTotal = cantidad * precio;
          subtotal += itemTotal;
          
          mensaje += `• ${cantidad}x *${nombre}*\n`;
          mensaje += `  S/ ${precio.toFixed(2)} c/u = S/ ${itemTotal.toFixed(2)}\n\n`;
        }
        
        mensaje += `*Subtotal:* S/ ${subtotal.toFixed(2)}\n`;
        
        if (data.igv !== undefined) {
          mensaje += `*IGV (18%):* S/ ${(data.igv || 0).toFixed(2)}\n`;
        }
        
        mensaje += `*TOTAL:* S/ ${(data.total || subtotal).toFixed(2)}\n\n`;
      }

      // Información adicional
      if (data.direccion_entrega) {
        mensaje += `*Dirección de entrega:*\n${data.direccion_entrega}\n\n`;
      }

      if (data.notas || data.comentarios) {
        mensaje += `*Notas:*\n${data.notas || data.comentarios}\n\n`;
      }

      if (esPedido && data.estado === 'PENDIENTE') {
        mensaje += '⏳ *Tu pedido está pendiente de aprobación.*\n';
        mensaje += 'Te notificaremos cuando sea procesado.\n\n';
      } else if (esPedido && data.estado === 'EN_PROCESO') {
        mensaje += '🔄 *Tu pedido está siendo procesado.*\n\n';
      } else if (!esPedido) {
        mensaje += '✅ *Compra completada*\n\n';
      }

      mensaje += '💡 Escribe *"mis pedidos"* para ver todo tu historial.';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al obtener detalle de pedido/compra', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al obtener el detalle. Por favor, intenta más tarde.'
      );
    }
  }

  /**
   * Listar productos del pedido actual
   */
  async listOrderItems(phoneNumber, whatsappHandler) {
    try {
      logger.info(`📋 Listando productos del pedido para ${phoneNumber}`);

      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📦 *Tu pedido actual*\n\n' +
          'No tienes un pedido activo.\n\n' +
          '💡 Para hacer un pedido, escribe lo que necesitas o envíalo por voz.\n' +
          'Ejemplo: *"Quiero 2 laptops HP"*'
        );
        return;
      }

      const result = await kardexApi.listarProductosPedido(pedidoId);
      
      if (!result.success || !result.productos || result.productos.length === 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '📦 *Tu pedido actual*\n\n' +
          'Tu pedido está vacío.\n\n' +
          '💡 Para agregar productos, escribe lo que necesitas o envíalo por voz.'
        );
        return;
      }

      let mensaje = '📦 *TU PEDIDO ACTUAL*\n\n';
      mensaje += `*Pedido N°:* ${result.numero_pedido || pedidoId}\n\n`;
      mensaje += '*PRODUCTOS:*\n\n';

      let total = 0;
      result.productos.forEach((item, index) => {
        const nombre = item.producto?.nombre || item.nombre || 'Producto';
        const cantidad = item.cantidad || 1;
        const precio = parseFloat(item.precio_unitario || item.precio || 0);
        const subtotal = cantidad * precio;
        total += subtotal;

        mensaje += `${index + 1}. *${nombre}*\n`;
        mensaje += `   Cantidad: ${cantidad}\n`;
        mensaje += `   Precio: S/ ${precio.toFixed(2)} c/u\n`;
        mensaje += `   Subtotal: S/ ${subtotal.toFixed(2)}\n`;
        mensaje += `   *Cambiar cantidad:* Escribe "cambiar ${nombre} a X"\n`;
        mensaje += `   *Eliminar:* Escribe "eliminar ${nombre}"\n\n`;
      });

      mensaje += '━━━━━━━━━━━━━━━━━━━━━━━━\n';
      mensaje += `💰 *TOTAL: S/ ${(result.total || total).toFixed(2)}*\n\n`;
      mensaje += '💡 *Opciones:*\n';
      mensaje += '• Escribe *"CONFIRMO"* para confirmar el pedido\n';
      mensaje += '• Escribe *"cambiar [producto] a X"* para cambiar cantidad\n';
      mensaje += '• Escribe *"eliminar [producto]"* para quitar un producto\n';
      mensaje += '• Escribe *"CANCELAR"* para cancelar el pedido';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al listar productos del pedido', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al obtener tu pedido actual. Por favor, intenta nuevamente.'
      );
    }
  }

  /**
   * Actualizar cantidad de un producto en el pedido
   */
  async updateProductQuantity(phoneNumber, productName, newQuantity, whatsappHandler) {
    try {
      if (!newQuantity || newQuantity < 1) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '⚠️ La cantidad debe ser un número mayor a 0.\n\n' +
          'Ejemplo: *"cambiar laptop a 3"*'
        );
        return;
      }

      logger.info(`🔄 Actualizando cantidad: ${productName} a ${newQuantity}`);

      const pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
      
      if (!pedidoId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          'No tienes un pedido activo. Primero haz un pedido.'
        );
        return;
      }

      // Obtener pedido actual
      const pedido = await kardexApi.getPedidoEnProceso(pedidoId);
      
      if (!pedido || !pedido.detalles || pedido.detalles.length === 0) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          'Tu pedido está vacío.'
        );
        return;
      }

      // Buscar el producto por nombre (fuzzy match)
      const productoEncontrado = pedido.detalles.find(detalle => {
        const nombreProducto = detalle.producto?.nombre?.toLowerCase() || '';
        const nombreBuscado = productName.toLowerCase();
        return nombreProducto.includes(nombreBuscado) || nombreBuscado.includes(nombreProducto);
      });

      if (!productoEncontrado) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ No encontré "${productName}" en tu pedido.\n\n` +
          'Escribe *"VER PEDIDO"* para ver los productos actuales.'
        );
        return;
      }

      // Si la cantidad nueva es 0 o negativa, eliminar el producto
      if (newQuantity <= 0) {
        const result = await kardexApi.eliminarProductoDePedido(pedidoId, productoEncontrado.id);
        
        if (!result.success) {
          await whatsappHandler.sendMessage(
            phoneNumber,
            `❌ ${result.error || 'No se pudo eliminar el producto.'}`
          );
          return;
        }

        await whatsappHandler.sendMessage(
          phoneNumber,
          `✅ Producto "${productoEncontrado.producto?.nombre || productName}" eliminado del pedido.`
        );

        // Actualizar y mostrar resumen
        const pedidoActualizado = await kardexApi.getPedidoEnProceso(pedidoId);
        if (pedidoActualizado) {
          await sessionManager.updateSessionState(
            phoneNumber,
            sessionManager.STATES.PEDIDO_EN_PROCESO,
            {
              pedido_id: pedidoId,
              numero_pedido: pedidoActualizado.numero_pedido,
              productos: pedidoActualizado.detalles?.map(d => ({
                producto_id: d.producto_id,
                nombre: d.producto?.nombre,
                cantidad: d.cantidad,
                precio_unitario: parseFloat(d.precio_unitario),
                subtotal: parseFloat(d.subtotal)
              })) || [],
              total: parseFloat(pedidoActualizado.total)
            }
          );

          if (pedidoActualizado.detalles && pedidoActualizado.detalles.length > 0) {
            const resumen = this.generateOrderSummaryFromBD(pedidoActualizado);
            await whatsappHandler.sendMessage(phoneNumber, resumen);
          } else {
            await whatsappHandler.sendMessage(
              phoneNumber,
              '📦 Tu pedido está vacío ahora.\n\n' +
              '💡 Agrega productos escribiendo lo que necesitas.'
            );
          }
        }
        return;
      }

      // Actualizar cantidad
      const result = await kardexApi.actualizarCantidadProducto(pedidoId, productoEncontrado.id, newQuantity);
      
      if (!result.success) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          `❌ ${result.error || 'No se pudo actualizar la cantidad.'}`
        );
        return;
      }

      // Actualizar sesión y mostrar resumen
      const pedidoActualizado = result.pedido || await kardexApi.getPedidoEnProceso(pedidoId);
      if (pedidoActualizado) {
        await sessionManager.updateSessionState(
          phoneNumber,
          sessionManager.STATES.PEDIDO_EN_PROCESO,
          {
            pedido_id: pedidoId,
            numero_pedido: pedidoActualizado.numero_pedido,
            productos: pedidoActualizado.detalles?.map(d => ({
              producto_id: d.producto_id,
              nombre: d.producto?.nombre,
              cantidad: d.cantidad,
              precio_unitario: parseFloat(d.precio_unitario),
              subtotal: parseFloat(d.subtotal)
            })) || [],
            total: parseFloat(pedidoActualizado.total)
          }
        );

        const resumen = this.generateOrderSummaryFromBD(pedidoActualizado);
        await whatsappHandler.sendMessage(phoneNumber, resumen);
      }

      logger.success(`✅ Cantidad actualizada: ${productName} a ${newQuantity}`);

    } catch (error) {
      logger.error('Error al actualizar cantidad de producto', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '❌ Hubo un error al actualizar la cantidad. Por favor, intenta nuevamente.'
      );
    }
  }

  /**
   * Modificar perfil del cliente - menú principal
   */
  async modifyProfile(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      const userToken = sessionState.user_token || sessionState._user_token;
      
      if (!userToken) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '🔐 *Acceso restringido*\n\n' +
          'Para modificar tu perfil, necesitas estar autenticado.\n\n' +
          'Por favor, inicia sesión con tu contraseña de la página web.'
        );
        return;
      }

      await whatsappHandler.sendMessage(
        phoneNumber,
        '⚙️ *MODIFICAR MI PERFIL*\n\n' +
        '¿Qué deseas actualizar?\n\n' +
        '1️⃣ *Cambiar teléfono* - Escribe "cambiar teléfono"\n' +
        '2️⃣ *Cambiar dirección* - Escribe "cambiar dirección"\n' +
        '3️⃣ *Cambiar email* - Escribe "cambiar email"\n\n' +
        'O escribe *CANCELAR* para volver.'
      );
    } catch (error) {
      logger.error('Error al mostrar menú de modificar perfil', error);
      await whatsappHandler.sendMessage(phoneNumber, '😅 Hubo un error. Por favor, intenta más tarde.');
    }
  }

  /**
   * Actualizar campo específico del perfil
   */
  async updateProfileField(phoneNumber, field, whatsappHandler, sessionState = {}, newValue = null) {
    try {
      const userToken = sessionState.user_token || sessionState._user_token;
      const clienteId = sessionState.cliente?.id || sessionState._client_id;
      
      if (!userToken || !clienteId) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '🔐 *Acceso restringido*\n\n' +
          'Para modificar tu perfil, necesitas estar autenticado.'
        );
        return;
      }

      const session = await sessionManager.getSession(phoneNumber);
      const stateObj = session?.current_order ? JSON.parse(session.current_order) : {};
      const currentState = session?.state || sessionManager.STATES.IDLE;

      // Determinar qué estado usar según el campo
      let awaitingState;
      let fieldName;
      let fieldLabel;
      
      if (field === 'telefono') {
        awaitingState = sessionManager.STATES.AWAITING_UPDATE_TELEFONO;
        fieldName = 'telefono';
        fieldLabel = 'teléfono';
      } else if (field === 'direccion') {
        awaitingState = sessionManager.STATES.AWAITING_UPDATE_DIRECCION;
        fieldName = 'direccion';
        fieldLabel = 'dirección';
      } else if (field === 'email') {
        awaitingState = sessionManager.STATES.AWAITING_UPDATE_EMAIL;
        fieldName = 'email';
        fieldLabel = 'correo electrónico';
      } else {
        await whatsappHandler.sendMessage(phoneNumber, '⚠️ Campo no válido para actualizar.');
        return;
      }

      // Si ya está esperando el valor y se proporciona, procesarlo
      if (currentState === awaitingState && newValue !== null) {
        const normalizedValue = field === 'telefono' 
          ? PhoneNormalizer.normalize(newValue.trim())
          : newValue.trim();

        // Validar según el campo
        if (field === 'telefono' && !PhoneNormalizer.isValidPeruvianPhone(normalizedValue)) {
          await whatsappHandler.sendMessage(
            phoneNumber,
            '❌ El número de teléfono no es válido. Por favor, ingresa un número de 9 dígitos (ejemplo: 987654321).'
          );
          return;
        }

        if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)) {
          await whatsappHandler.sendMessage(
            phoneNumber,
            '❌ El correo electrónico no es válido. Por favor, ingresa un email válido (ejemplo: nombre@correo.com).'
          );
          return;
        }

        if (field === 'direccion' && normalizedValue.length < 5) {
          await whatsappHandler.sendMessage(
            phoneNumber,
            '❌ La dirección debe tener al menos 5 caracteres. Por favor, ingresa una dirección completa.'
          );
          return;
        }

        // Actualizar en la API
        const datosActualizar = { [fieldName]: normalizedValue };
        const result = await kardexApi.actualizarCliente(clienteId, datosActualizar, userToken);

        if (!result.success) {
          await whatsappHandler.sendMessage(
            phoneNumber,
            `❌ ${result.message || 'No se pudo actualizar tu ' + fieldLabel + '.'}\n\n` +
            'Por favor, intenta más tarde o contacta con soporte.'
          );
          return;
        }

        // Actualizar sesión
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
          ...stateObj,
          [`_client_${fieldName}`]: normalizedValue
        });

        await whatsappHandler.sendMessage(
          phoneNumber,
          `✅ *${fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1)} actualizado exitosamente*\n\n` +
          `Tu nuevo ${fieldLabel} es: *${normalizedValue}*\n\n` +
          '¿Deseas actualizar algo más? Escribe *"modificar perfil"* o *CANCELAR* para volver.'
        );

        logger.success(`✅ ${fieldLabel} actualizado para cliente ${clienteId}`);
        return;
      }

      // Si no está esperando, pedir el nuevo valor
      await sessionManager.updateSessionState(phoneNumber, awaitingState, {
        ...stateObj,
        _updating_field: field
      });

      let mensaje = `📝 *Actualizar ${fieldLabel}*\n\n`;
      if (field === 'telefono') {
        mensaje += 'Por favor, ingresa tu nuevo *número de teléfono* (9 dígitos):\n\n';
        mensaje += 'Ejemplo: *987654321* o *51987654321*';
      } else if (field === 'direccion') {
        mensaje += 'Por favor, ingresa tu nueva *dirección completa*:';
      } else if (field === 'email') {
        mensaje += 'Por favor, ingresa tu nuevo *correo electrónico*:\n\n';
        mensaje += 'Ejemplo: *nombre@correo.com*';
      }

      mensaje += '\n\n❌ Escribe *CANCELAR* para volver sin guardar cambios.';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al actualizar campo del perfil', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al actualizar tu perfil. Por favor, intenta más tarde.'
      );
    }
  }

  /**
   * Ver estado de cuenta del cliente
   */
  async viewAccountStatus(phoneNumber, whatsappHandler, sessionState = {}) {
    try {
      const userToken = sessionState.user_token || sessionState._user_token;
      
      if (!userToken) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '🔐 *Acceso restringido*\n\n' +
          'Para ver tu estado de cuenta, necesitas estar autenticado.\n\n' +
          'Por favor, inicia sesión con tu contraseña de la página web.'
        );
        return;
      }

      logger.info(`📊 Obteniendo estado de cuenta para ${phoneNumber}`);

      const cuentaResult = await kardexApi.getEstadoCuenta(userToken);

      if (!cuentaResult.success || !cuentaResult.data) {
        await whatsappHandler.sendMessage(
          phoneNumber,
          '😅 No se pudo obtener tu estado de cuenta. Por favor, intenta más tarde.'
        );
        return;
      }

      const cuenta = cuentaResult.data;
      let mensaje = '📊 *MI ESTADO DE CUENTA*\n\n';

      // Información del cliente
      if (cuenta.cliente) {
        mensaje += '*INFORMACIÓN PERSONAL:*\n\n';
        mensaje += `• *Nombre:* ${cuenta.cliente.nombre || 'No especificado'}\n`;
        mensaje += `• *DNI:* ${cuenta.cliente.numero_documento || 'No especificado'}\n`;
        mensaje += `• *Teléfono:* ${cuenta.cliente.telefono || 'No especificado'}\n`;
        mensaje += `• *Email:* ${cuenta.cliente.email || 'No especificado'}\n`;
        if (cuenta.cliente.direccion) {
          mensaje += `• *Dirección:* ${cuenta.cliente.direccion}\n`;
        }
        mensaje += '\n';
      }

      // Resumen de actividad
      if (cuenta.total_compras !== undefined) {
        mensaje += '*RESUMEN DE ACTIVIDAD:*\n\n';
        mensaje += `• *Total de compras:* ${cuenta.total_compras || 0}\n`;
        if (cuenta.total_gastado !== undefined) {
          mensaje += `• *Total gastado:* S/ ${(cuenta.total_gastado || 0).toFixed(2)}\n`;
        }
        if (cuenta.pedidos_pendientes !== undefined) {
          mensaje += `• *Pedidos pendientes:* ${cuenta.pedidos_pendientes || 0}\n`;
        }
        mensaje += '\n';
      }

      // Saldo pendiente (si aplica)
      if (cuenta.saldo_pendiente !== undefined && cuenta.saldo_pendiente > 0) {
        mensaje += `⚠️ *Saldo pendiente:* S/ ${cuenta.saldo_pendiente.toFixed(2)}\n\n`;
      }

      mensaje += '💡 *Para actualizar tu información:* Escribe *"modificar perfil"*\n';
      mensaje += '💡 *Para ver tus pedidos:* Escribe *"mis pedidos"*';

      await whatsappHandler.sendMessage(phoneNumber, mensaje);

    } catch (error) {
      logger.error('Error al obtener estado de cuenta', error);
      await whatsappHandler.sendMessage(
        phoneNumber,
        '😅 Hubo un error al obtener tu estado de cuenta. Por favor, intenta más tarde.'
      );
    }
  }
}

module.exports = new OrderHandler();

