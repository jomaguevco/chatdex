require('dotenv').config();
const express = require('express');
const path = require('path');
const config = require('../config/config');
const db = require('./db');
const kardexDb = require('./kardexDb');
const logger = require('./utils/logger');
// Usar Baileys en lugar de whatsapp-web.js (más estable)
const whatsappHandler = require('./whatsapp-baileys');
const sessionManager = require('./sessionManager');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webchat REST: procesar mensajes desde el portal del cliente
app.post('/webchat/message', async (req, res) => {
  try {
    const { sessionId, text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, message: 'text es requerido' });
    }

    const nlu = require('./nlu');
    const orderHandler = require('./orderHandler');
    const sessionManager = require('./sessionManager');

    const webSessionId = sessionId || `web_${req.ip}`;
    const phoneNumber = webSessionId; // usamos sessionId como identificador de canal web

    // Asegurar sesión
    await sessionManager.getSession(phoneNumber);
    const session = await sessionManager.getSession(phoneNumber);
    const conversationHistory = await sessionManager.getConversationHistory(phoneNumber, 15);

    // Procesar NLU
    const nluResult = await nlu.processMessage(text, { ...session.state, phoneNumber }, conversationHistory, false);

    // Transportador web (captura mensajes en un array)
    const outbound = [];
    const webTransport = {
      sendMessage: async (to, message) => {
        outbound.push({ type: 'text', message });
        return true;
      },
      sendImage: async (to, bufferOrPath, caption) => {
        outbound.push({ type: 'image', caption });
        return true;
      }
    };

    // Ejecutar acciones del bot si existen
    if (nluResult?.response?.action) {
      const action = nluResult.response.action;
      const actionData = nluResult.response;
      switch (action) {
        case 'init_order':
          await orderHandler.initOrder(phoneNumber, webTransport);
          break;
        case 'add_products_to_order':
          await orderHandler.addProductsToOrder(phoneNumber, actionData, webTransport);
          break;
        case 'view_order':
          await orderHandler.viewOrder(phoneNumber, webTransport);
          break;
        case 'confirm_order':
          await orderHandler.confirmOrder(phoneNumber, webTransport);
          break;
        case 'cancel_order':
          await orderHandler.cancelOrder(phoneNumber, webTransport);
          break;
        case 'show_yape_payment':
          await orderHandler.showYapePayment(phoneNumber, actionData.orderData, webTransport);
          break;
        case 'show_plin_payment':
          await orderHandler.showPlinPayment(phoneNumber, actionData.orderData, webTransport);
          break;
        default:
          // Si solo hay mensaje
          if (nluResult.response?.message) {
            outbound.push({ type: 'text', message: nluResult.response.message });
          }
      }
    } else if (nluResult?.response?.message) {
      outbound.push({ type: 'text', message: nluResult.response.message });
    } else {
      outbound.push({ type: 'text', message: '👋 *¡Hola!* 👋\n\n📋 *¿En qué puedo ayudarte?*\n\n🛍️ *Ver productos:* Escribe *CATALOGO*\n🛒 *Hacer pedido:* Escribe lo que necesitas\n💰 *Consultar precio:* "¿Cuánto cuesta X?"\n📊 *Ver pedido:* Escribe *ESTADO*\n❓ *Ayuda:* Escribe *AYUDA*\n\n💡 También puedes enviarme una nota de voz.' });
    }

    // Guardar interacción
    await sessionManager.saveMessage(phoneNumber, 'text', text, false);
    for (const msg of outbound) {
      if (msg.type === 'text') {
        await sessionManager.saveMessage(phoneNumber, 'text', msg.message, true);
      }
    }

    res.json({
      success: true,
      messages: outbound,
      state: await sessionManager.getSession(phoneNumber)
    });
  } catch (error) {
    logger.error('Error en /webchat/message', error);
    res.status(500).json({ success: false, message: 'Error procesando mensaje' });
  }
});

// Endpoint de salud
app.get('/health', (req, res) => {
  const status = whatsappHandler.getStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp: status.connected ? 'connected' : 'disconnected',
    database: db.db ? 'connected' : 'disconnected',
    handlersConfigured: status.messageHandlersConfigured || false
  });
});

// Endpoint para forzar configuración de handlers (útil para debugging)
app.post('/force-configure-handlers', async (req, res) => {
  try {
    const result = await whatsappHandler.forceConfigureHandlers();
    const status = whatsappHandler.getStatus();
    res.json({
      success: result,
      message: result ? 'Handlers configurados exitosamente' : 'No se pudieron configurar handlers',
      connected: status.connected,
      handlersConfigured: status.messageHandlersConfigured || false
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para ver logs recientes (debugging)
app.get('/debug/logs', (req, res) => {
  // Este endpoint no puede capturar logs históricos, pero puede verificar estado
  const status = whatsappHandler.getStatus();
  res.json({
    status: 'ok',
    whatsapp: status,
    timestamp: new Date().toISOString()
  });
});

// Endpoint para verificar configuración de Ollama
app.get('/debug/ollama', async (req, res) => {
  try {
    const ollamaClient = require('./utils/ollamaClient');
    const isAvailable = await ollamaClient.isAvailable();
    const modelAvailable = await ollamaClient.checkModel();
    res.json({
      ollamaAvailable: isAvailable,
      modelAvailable: modelAvailable,
      model: ollamaClient.model,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ollamaAvailable: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para forzar verificación de conexión
app.post('/force-check-connection', async (req, res) => {
  try {
    const result = await whatsappHandler.forceCheckConnection();
    const status = whatsappHandler.getStatus();
    res.json({
      success: result,
      message: result ? 'Conexión detectada y configurada' : 'No se pudo detectar conexión',
      connected: status.connected,
      handlersConfigured: status.messageHandlersConfigured || false
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para probar envío de mensaje (útil para debugging)
app.post('/test-send-message', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber y message son requeridos'
      });
    }
    
    if (!whatsappHandler.client) {
      return res.status(500).json({
        success: false,
        error: 'Cliente de WhatsApp no está disponible'
      });
    }
    
    const result = await whatsappHandler.sendMessage(phoneNumber, message);
    
    res.json({
      success: result,
      message: result ? 'Mensaje enviado exitosamente' : 'No se pudo enviar el mensaje',
      phoneNumber,
      message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para verificar estado detallado
app.get('/debug-status', async (req, res) => {
  try {
    const debugInfo = await whatsappHandler.getDebugInfo();
    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({
    name: 'ChatDex - WhatsApp Bot',
    version: '1.0.0',
    description: 'Chatbot de WhatsApp integrado con KARDEX',
    status: 'running',
    endpoints: {
      health: '/health'
    }
  });
});

// Asegurar que las carpetas necesarias existan
async function ensureDirectories() {
  const fs = require('fs').promises;
  const rootDir = path.join(__dirname, '..');
  
  const directories = [
    path.join(rootDir, config.paths.temp),
    path.join(rootDir, config.paths.qr),
    path.join(rootDir, config.paths.data),
    path.join(rootDir, config.paths.tokens),
    path.join(rootDir, config.paths.tokens, 'tokens')
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
      logger.debug(`Directorio verificado: ${dir}`);
    } catch (error) {
      logger.error(`Error al crear directorio ${dir}`, error);
      throw error;
    }
  }
}

// Inicializar aplicación
async function initialize() {
  try {
    logger.info('🚀 Inicializando ChatDex...');
    
    // Asegurar que las carpetas existan
    logger.info('📁 Verificando directorios...');
    await ensureDirectories();
    logger.success('✅ Directorios verificados');
    
    // Inicializar base de datos local (SQLite)
    logger.info('📦 Inicializando base de datos local (SQLite)...');
    await db.initialize();
    logger.success('✅ Base de datos local inicializada');
    
    // Warmup de Whisper para descargar/preparar el modelo (evita fallos SSL en primer uso)
    try {
      const whisper = require('./whisper');
      await whisper.ensureReady();
    } catch (e) {
      logger.warn('⚠️ No se pudo ejecutar warmup de Whisper', e.message);
    }
    
    // Inicializar conexión a base de datos MySQL de Kardex
    logger.info('📦 Inicializando conexión a base de datos MySQL de Kardex...');
    const kardexDbConnected = await kardexDb.initialize();
    if (kardexDbConnected) {
      logger.success('✅ Conexión a base de datos MySQL de Kardex establecida');
    } else {
      logger.warn('⚠️ No se pudo conectar a MySQL de Kardex - Se usará solo API REST');
    }
    
    // Limpiar sesiones expiradas cada 10 minutos
    setInterval(async () => {
      await sessionManager.cleanExpiredSessions();
    }, 10 * 60 * 1000);
    
    // Iniciar servidor Express PRIMERO (no esperar a WhatsApp)
    // Esto permite que el servidor esté disponible inmediatamente
    const PORT = config.port || 3001;
    
    // Iniciar servidor Express directamente
    // Si el puerto está en uso, intentar liberarlo
    const startServer = () => {
      app.listen(PORT, () => {
        logger.success(`✅ Servidor Express iniciado en puerto ${PORT}`);
        logger.info(`🌐 Health check disponible en: http://localhost:${PORT}/health`);
      }).on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`❌ Puerto ${PORT} ya está en uso`);
          logger.warn('⚠️  Deteniendo procesos en el puerto...');
          const { exec } = require('child_process');
          exec(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, (err) => {
            if (err) {
              logger.error('❌ No se pudo detener el proceso en el puerto');
              logger.info('💡 Detén manualmente el proceso:');
              logger.info(`   lsof -ti:${PORT} | xargs kill -9`);
              logger.info('   O cambia el puerto en .env: PORT=3002');
              process.exit(1);
            } else {
              logger.info('✅ Proceso en el puerto detenido');
              logger.info('🔄 Reintentando iniciar servidor...');
              // Reintentar después de un momento
              setTimeout(() => {
                startServer();
              }, 1000);
            }
          });
        } else {
          logger.error('❌ Error al iniciar servidor Express', error);
          process.exit(1);
        }
      });
    };
    
    // Iniciar servidor INMEDIATAMENTE (no esperar a WhatsApp)
    startServer();
    
    // Inicializar WhatsApp bot EN PARALELO (no bloquear)
    logger.info('📱 Inicializando WhatsApp bot...');
    // Inicializar WhatsApp de forma asíncrona sin bloquear
    whatsappHandler.initialize().then(() => {
      const status = whatsappHandler.getStatus();
      if (status.connected) {
        logger.success('✅ WhatsApp bot inicializado y conectado');
      } else {
        logger.info('⏳ WhatsApp bot inicializado - Esperando conexión (QR)');
        logger.info('   El QR aparecerá en la consola cuando se genere');
      }
    }).catch((error) => {
      // Si es error de "Not Logged", no es crítico - el bot puede continuar esperando QR
      const errorMessage = error?.message || error?.toString() || '';
      if (errorMessage.includes('Not Logged') || errorMessage.includes('disconnected')) {
        logger.warn('⚠️ WhatsApp no conectado - Esperando QR...');
        logger.info('   El bot continuará ejecutándose y mostrará el QR cuando esté disponible');
      } else {
        // Para otros errores, loguear pero no terminar el proceso
        logger.error('⚠️ Error al inicializar WhatsApp bot', error);
        logger.info('   El bot continuará ejecutándose - Intenta reconectar...');
      }
    });
    
    // Intentar forzar configuración de handlers después de 10 segundos si no están configurados
    setTimeout(async () => {
      const status = whatsappHandler.getStatus();
      if (!status.messageHandlersConfigured && status.hasClient) {
        logger.info('🔧 Intentando configurar handlers automáticamente (10 segundos después del inicio)...');
        try {
          await whatsappHandler.forceConfigureHandlers();
        } catch (error) {
          logger.warn('⚠️ No se pudieron configurar handlers automáticamente', error.message);
        }
      }
    }, 10000); // 10 segundos después del inicio
    
    // Si WhatsApp no está conectado, mostrar instrucciones
    const status = whatsappHandler.getStatus();
    if (!status.connected) {
      logger.info('');
      logger.info('╔══════════════════════════════════════════════════════════════════════╗');
      logger.info('║          📱 ESPERANDO CONEXIÓN CON WHATSAPP                            ║');
      logger.info('╚══════════════════════════════════════════════════════════════════════╝');
      logger.info('');
      logger.info('📋 INSTRUCCIONES:');
      logger.info('   1. Espera a que aparezca el código QR en la consola');
      logger.info('   2. O verifica el archivo: qr/qr.png');
      logger.info('   3. Escanea el QR con WhatsApp (Configuración > Dispositivos vinculados)');
      logger.info('   4. El bot se conectará automáticamente');
      logger.info('');
      logger.info('💡 Si el QR no aparece:');
      logger.info('   - Elimina la sesión anterior: rm -rf tokens/whatsapp-session/');
      logger.info('   - Reinicia el bot: npm start');
      logger.info('');
    }
    
  } catch (error) {
    logger.error('❌ Error crítico al inicializar aplicación', error);
    // No terminar el proceso inmediatamente, dar tiempo para que se muestre el QR
    logger.info('⏳ Intentando continuar...');
  }
}

// Manejo de cierre graceful
process.on('SIGINT', async () => {
  logger.info('🛑 Recibida señal SIGINT, cerrando aplicación...');
  try {
    await whatsappHandler.disconnect();
    await db.close();
    await kardexDb.close();
    logger.success('✅ Aplicación cerrada correctamente');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error al cerrar aplicación', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Recibida señal SIGTERM, cerrando aplicación...');
  try {
    await whatsappHandler.disconnect();
    await db.close();
    await kardexDb.close();
    logger.success('✅ Aplicación cerrada correctamente');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error al cerrar aplicación', error);
    process.exit(1);
  }
});

// Manejo de errores no capturados
process.on('unhandledRejection', (error) => {
  logger.error('❌ Unhandled Rejection', error);
});

process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception', error);
  process.exit(1);
});

// Inicializar
initialize();

