const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const config = require('../config/config');
const logger = require('./utils/logger');
const nlu = require('./nlu');
const sessionManager = require('./sessionManager');
const orderHandler = require('./orderHandler');
const whisperTranscriber = require('./whisper');

class WhatsAppHandler {
  constructor() {
    this.sock = null;
    this.contacts = {}; // Cache manual de contactos
    this.isConnecting = false;
    this.connected = false;
    this.messageHandlersConfigured = false;
    this.qrCode = null;
    this.processedMessageIds = new Set();
    this.authState = null;
  }

  /**
   * Inicializar cliente de WhatsApp con Baileys
   */
  async initialize() {
    if (this.connected || this.isConnecting) {
      logger.warn('WhatsApp ya está conectado o conectándose');
      return;
    }

    this.isConnecting = true;

    try {
      logger.info('🔌 Iniciando conexión con WhatsApp usando Baileys...');
      logger.info('✅ Baileys es más estable y no requiere Puppeteer');

      // Asegurar que el directorio de sesión exista
      const sessionDir = path.join(__dirname, '..', config.paths.tokens, 'baileys-session');
      await fs.mkdir(sessionDir, { recursive: true });

      // Cargar estado de autenticación
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      this.authState = { state, saveCreds };

      // Obtener la última versión de Baileys
      const { version } = await fetchLatestBaileysVersion();
      logger.info(`✅ Versión de Baileys: ${version.join('.')}`);

      // Crear socket de WhatsApp
      // Crear logger compatible con Baileys (necesita método trace)
      const baileysLogger = pino({ level: 'silent' });
      // Agregar método trace si no existe (Baileys lo requiere)
      // pino ya tiene trace, pero asegurémonos de que funcione
      if (typeof baileysLogger.trace !== 'function') {
        baileysLogger.trace = function() {
          // No hacer nada, solo evitar errores
        };
      }
      
      // Asegurar que nuestro logger también tenga trace para makeCacheableSignalKeyStore
      if (typeof logger.trace !== 'function') {
        logger.trace = function() {
          // No hacer nada, solo evitar errores
        };
      }
      
      this.sock = makeWASocket({
        version,
        logger: baileysLogger, // Logger compatible con Baileys
        printQRInTerminal: false, // Generaremos nuestro propio QR
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: ['ChatDex Bot', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true
      });

      logger.info('✅ Socket de WhatsApp creado');

      // Manejar actualizaciones de contactos para cachearlos
      this.sock.ev.on('contacts.update', (updates) => {
        for (const update of updates) {
          if (update.id && update.notify) {
            this.contacts[update.id] = update;
          }
        }
      });

      // Manejar actualizaciones de credenciales
      this.sock.ev.on('creds.update', async () => {
        await saveCreds();
        logger.debug('✅ Credenciales guardadas');
      });

      // Manejar conexión
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // Generar QR code
          logger.info('📱 Generando código QR...');
          try {
            const qrImage = await qrcode.toDataURL(qr);
            const qrPath = path.join(__dirname, '..', 'qr', 'qr.png');
            await fs.mkdir(path.dirname(qrPath), { recursive: true });
            
            // Guardar QR como imagen
            const base64Data = qrImage.replace(/^data:image\/png;base64,/, '');
            await fs.writeFile(qrPath, base64Data, 'base64');
            
            this.qrCode = qr;
            
            console.log('\n');
            console.log('═'.repeat(70));
            console.log('📱 ESCANEA ESTE QR CON WHATSAPP');
            console.log('═'.repeat(70));
            console.log('   Ubicación: qr/qr.png');
            console.log('   O escanea el QR de la consola');
            console.log('═'.repeat(70));
            console.log('\n');
            
            // Mostrar QR en consola
            qrcode.toString(qr, { type: 'terminal', small: true }, (err, qrString) => {
              if (!err) {
                console.log(qrString);
                console.log('\n');
              }
            });
            
            logger.success('✅ Código QR generado en qr/qr.png');
          } catch (qrError) {
            logger.error('❌ Error al generar QR:', qrError);
          }
        }

        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            logger.warn('⚠️ Conexión cerrada, reconectando...');
            this.connected = false;
            this.isConnecting = false;
            this.messageHandlersConfigured = false; // Resetear handlers para reconexión
            // Reconectar después de un momento
            setTimeout(() => {
              this.initialize().catch(err => {
                logger.error('❌ Error al reconectar:', err);
              });
            }, 3000);
          } else {
            logger.error('❌ Sesión cerrada. Elimina la carpeta baileys-session y reinicia.');
            this.connected = false;
            this.isConnecting = false;
            this.messageHandlersConfigured = false;
          }
        } else if (connection === 'open') {
          logger.success('\n╔══════════════════════════════════════════════════════════════════════╗');
          logger.success('║              ✅ WHATSAPP CONECTADO EXITOSAMENTE                       ║');
          logger.success('╚══════════════════════════════════════════════════════════════════════╝');
          logger.success('');
          
          console.log('\n');
          console.log('═'.repeat(70));
          console.log('✅ WHATSAPP CONECTADO EXITOSAMENTE');
          console.log('═'.repeat(70));
          console.log('\n');

          this.connected = true;
          this.isConnecting = false;

          // Obtener información del socket
          const me = this.sock.user;
          if (me) {
            logger.info(`📱 Conectado como: ${me.name || me.id || 'N/A'}`);
            logger.info(`📱 ID: ${me.id || 'N/A'}`);
            console.log(`   Número: ${me.id || 'N/A'}`);
            console.log(`   Nombre: ${me.name || 'N/A'}`);
            console.log('═'.repeat(70));
            console.log('\n');
          }

          // Configurar handlers de mensajes (siempre después de reconectar)
          logger.info('📡 Configurando handlers de mensajes...');
          this.messageHandlersConfigured = false; // Resetear para forzar reconfiguración
          await this.setupMessageHandlers();
        }
      });

      logger.info('✅ Socket inicializado, esperando conexión...');

    } catch (error) {
      logger.error('❌ Error al inicializar WhatsApp:', error);
      this.isConnecting = false;
      this.connected = false;
      throw error;
    }
  }

  /**
   * Configurar handlers de mensajes
   */
  async setupMessageHandlers() {
    if (this.messageHandlersConfigured) {
      logger.warn('⚠️ Handlers ya están configurados');
      return true;
    }

    if (!this.sock) {
      logger.error('❌ No hay socket disponible para configurar handlers');
      return false;
    }

    try {
      logger.info('📡 Configurando handlers de mensajes con Baileys...');

      // Handler para mensajes
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        logger.info(`📥 Evento messages.upsert recibido - tipo: ${type}, mensajes: ${messages.length}`);
        
        // Procesar mensajes de tipo 'notify' (nuevos) y 'append' (mensajes recientes)
        // Ignorar solo otros tipos como 'update' que son actualizaciones de estado
        if (type !== 'notify' && type !== 'append') {
          logger.debug(`⚠️ Tipo de mensaje ignorado: ${type}`);
          return;
        }

        logger.info(`✅ Procesando ${messages.length} mensaje(s)... (tipo: ${type})`);
        
        // Log detallado para debug del primer audio
        if (messages.length > 0) {
          const firstMsg = messages[0];
          logger.info(`🔍 Primer mensaje - fromMe: ${firstMsg.key?.fromMe}, remoteJid: ${firstMsg.key?.remoteJid}, tipo: ${firstMsg.message ? Object.keys(firstMsg.message)[0] : 'unknown'}`);
        }

        for (const message of messages) {
          try {
            // Ignorar mensajes del propio bot
            if (message.key.fromMe) {
              logger.debug('⚠️ Ignorando mensaje del propio bot');
              continue;
            }

            // Verificar si es mensaje de grupo
            const isGroup = message.key.remoteJid?.includes('@g.us');
            
            if (isGroup) {
              logger.debug('⚠️ Ignorando mensaje de grupo');
              continue;
            }

            // Log detallado para mensajes individuales
            logger.info('═══════════════════════════════════════════════════════════');
            logger.info('📩 ========== MENSAJE INDIVIDUAL RECIBIDO ==========');
            logger.info(`📩 HORA: ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}`);
            logger.info(`📩 FROM: ${message.key.remoteJid || 'N/A'}`);
            logger.info(`📩 FROM ME: ${message.key.fromMe ? 'SÍ' : 'NO'}`);
            logger.info(`📩 IS GROUP: NO (mensaje individual)`);
            logger.info(`📩 TYPE: ${message.message ? Object.keys(message.message)[0] : 'text'}`);
            logger.info('═══════════════════════════════════════════════════════════');
            
            // Log visible en consola
            console.log('\n');
            console.log('═'.repeat(70));
            console.log('📩 ========== MENSAJE INDIVIDUAL RECIBIDO ==========');
            console.log('═'.repeat(70));
            console.log('📩 HORA: ' + new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }));
            console.log('📩 FROM: ' + (message.key.remoteJid || 'N/A'));
            console.log('📩 FROM ME: ' + (message.key.fromMe ? 'SÍ' : 'NO'));
            console.log('📩 IS GROUP: NO (mensaje individual)');
            console.log('📩 TYPE: ' + (message.message ? Object.keys(message.message)[0] : 'text'));
            console.log('═'.repeat(70));
            console.log('\n');

            // Extraer número de teléfono usando Baileys
            let phoneNumber = null;
            let realPhoneNumber = null; // Para buscar en BD
            const remoteJid = message.key.remoteJid;
            
            if (remoteJid) {
              // Usar jidDecode de Baileys para obtener el número real
              try {
                const { jidDecode, jidNormalizedUser } = require('@whiskeysockets/baileys');
                
                // Intentar decodificar el JID
                const decoded = jidDecode(remoteJid);
                if (decoded && decoded.user) {
                  phoneNumber = decoded.user;
                  logger.info(`📞 Número decodificado desde JID: ${remoteJid} -> ${phoneNumber}`);
                } else {
                  // Si no se puede decodificar, intentar normalizar
                  const normalized = jidNormalizedUser(remoteJid);
                  if (normalized) {
                    phoneNumber = normalized.replace('@s.whatsapp.net', '').replace('@c.us', '');
                    logger.info(`📞 Número normalizado desde JID: ${remoteJid} -> ${phoneNumber}`);
                  } else {
                    // Fallback: extraer manualmente
                    if (remoteJid.includes('@s.whatsapp.net')) {
                      phoneNumber = remoteJid.replace('@s.whatsapp.net', '');
                    } else if (remoteJid.includes('@c.us')) {
                      phoneNumber = remoteJid.replace('@c.us', '');
                    } else if (remoteJid.includes('@')) {
                      phoneNumber = remoteJid.split('@')[0];
                      logger.warn(`⚠️ JID especial detectado, usando parte antes de @: ${phoneNumber}`);
                    } else {
                      phoneNumber = remoteJid;
                    }
                  }
                }
                
                // Intentar obtener el número real del contacto desde el store de Baileys
                // Esto es necesario porque cuando el JID termina en @lid, es un ID interno
                try {
                  if (this.sock && remoteJid.includes('@lid')) {
                    logger.info(`🔍 JID termina en @lid, buscando número real desde store...`);
                    
                    // Intentar obtener el número real del contacto
                    let contact = null;
                    
                    // Método 1: Buscar en nuestro cache de contactos
                    if (this.contacts && this.contacts[remoteJid]) {
                      contact = this.contacts[remoteJid];
                      logger.info(`📞 Contacto encontrado en cache local`);
                      
                      // Extraer el número real del contacto
                      if (contact.jid) {
                        realPhoneNumber = contact.jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
                        logger.info(`✅ Número real obtenido desde cache contact.jid: ${realPhoneNumber}`);
                      } else if (contact.id) {
                        realPhoneNumber = contact.id.replace('@s.whatsapp.net', '').replace('@c.us', '');
                        logger.info(`✅ Número real obtenido desde cache contact.id: ${realPhoneNumber}`);
                      }
                    }
                    
                    // Método 2: Intentar con onWhatsApp usando el número extraído
                    if (!realPhoneNumber && this.sock.onWhatsApp && phoneNumber) {
                      logger.info(`🔍 Intentando obtener número con onWhatsApp usando: ${phoneNumber}...`);
                      try {
                        // onWhatsApp necesita el número en formato @s.whatsapp.net
                        const checkJid = `${phoneNumber}@s.whatsapp.net`;
                        const result = await this.sock.onWhatsApp(checkJid);
                        if (result && result.length > 0 && result[0].exists && result[0].jid) {
                          realPhoneNumber = result[0].jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
                          logger.info(`✅ Número real obtenido desde onWhatsApp: ${realPhoneNumber}`);
                        } else {
                          logger.warn(`⚠️ onWhatsApp no encontró número para ${checkJid}`);
                        }
                      } catch (onWhatsAppError) {
                        logger.warn(`⚠️ Error en onWhatsApp: ${onWhatsAppError.message}`);
                      }
                    }
                    
                    // Método 3: Buscar en nuestro cache de contactos
                    if (!realPhoneNumber && this.contacts) {
                      logger.info(`🔍 Buscando en cache de contactos...`);
                      try {
                        for (const [jid, contactData] of Object.entries(this.contacts)) {
                          if (jid === remoteJid || (contactData && (contactData.id === remoteJid || contactData.jid === remoteJid))) {
                            const foundJid = contactData?.jid || jid;
                            if (foundJid && foundJid.includes('@s.whatsapp.net')) {
                              realPhoneNumber = foundJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
                              logger.info(`✅ Número real encontrado en cache: ${realPhoneNumber}`);
                              break;
                            }
                          }
                        }
                      } catch (cacheError) {
                        logger.warn(`⚠️ Error al buscar en cache: ${cacheError.message}`);
                      }
                    }
                  }
                } catch (contactError) {
                  logger.error(`❌ Error al obtener número real desde contacto: ${contactError.message}`);
                  logger.error(`   Stack: ${contactError.stack?.substring(0, 300)}`);
                }
                
              } catch (e) {
                // Fallback manual si falla la decodificación
                logger.warn(`⚠️ Error al decodificar JID, usando método manual: ${e.message}`);
                if (remoteJid.includes('@s.whatsapp.net')) {
                  phoneNumber = remoteJid.replace('@s.whatsapp.net', '');
                } else if (remoteJid.includes('@c.us')) {
                  phoneNumber = remoteJid.replace('@c.us', '');
                } else if (remoteJid.includes('@')) {
                  phoneNumber = remoteJid.split('@')[0];
                } else {
                  phoneNumber = remoteJid;
                }
              }
            }
            
            if (!phoneNumber) {
              logger.error('❌ ERROR: No se pudo extraer el número de teléfono del JID:', remoteJid);
              return;
            }
            
            // Usar el número real si está disponible, de lo contrario usar el extraído
            const phoneForSearch = realPhoneNumber || phoneNumber;
            
            // Log del formato original para debug
            logger.info(`📞 JID original: ${remoteJid}`);
            logger.info(`📞 Número extraído: ${phoneNumber}`);
            if (realPhoneNumber) {
              logger.info(`📞 Número real obtenido: ${realPhoneNumber}`);
            }
            logger.info(`📞 Número a usar para búsqueda: ${phoneForSearch}`);

            // Verificar si ya procesamos este mensaje
            const messageId = message.key.id;
            if (this.processedMessageIds.has(messageId)) {
              logger.debug('⚠️ Mensaje ya procesado, ignorando');
              return;
            }
            this.processedMessageIds.add(messageId);

            // Limpiar IDs antiguos (mantener solo los últimos 1000)
            if (this.processedMessageIds.size > 1000) {
              const idsArray = Array.from(this.processedMessageIds);
              this.processedMessageIds = new Set(idsArray.slice(-500));
            }

            logger.info(`📨 Mensaje recibido de ${phoneNumber} (JID: ${remoteJid})`);

            // Actualizar estado de conexión
            if (!this.connected) {
              this.connected = true;
              logger.info('✅ Conexión confirmada por recepción de mensaje');
            }

            // Procesar mensaje de texto
            if (message.message?.conversation || message.message?.extendedTextMessage?.text) {
              const text = message.message.conversation || message.message.extendedTextMessage?.text || '';
              logger.info(`📝 Mensaje de texto: ${text.substring(0, 100)}`);
              
              // Guardar el remoteJid original para usar en respuestas
              // Pasar phoneForSearch para buscar en BD y phoneNumber para sesión
              await this.processTextMessage(phoneForSearch, text, remoteJid);
            }
            // Procesar mensaje de voz
            else if (message.message?.audioMessage || message.message?.pttMessage) {
              logger.info('🎤 Mensaje de voz recibido');
              
              const audioMessage = message.message.audioMessage || message.message.pttMessage;
              if (audioMessage) {
                logger.debug('Audio message details:', {
                  hasAudioMessage: !!message.message.audioMessage,
                  hasPttMessage: !!message.message.pttMessage,
                  audioMessageKeys: audioMessage ? Object.keys(audioMessage) : []
                });
                // Guardar el remoteJid original para usar en respuestas
                // Pasar phoneForSearch para buscar en BD y phoneNumber para sesión
                try {
                  await this.processVoiceMessageBaileys(phoneForSearch, audioMessage, remoteJid);
                } catch (voiceError) {
                  logger.error('❌ Error al procesar mensaje de voz:', {
                    error: voiceError.message,
                    stack: voiceError.stack,
                    phoneNumber: phoneForSearch
                  });
                  // Enviar mensaje de error al usuario
                  await this.sendMessage(remoteJid || `${phoneForSearch}@s.whatsapp.net`,
                    '😅 Lo siento, hubo un error al procesar tu mensaje de voz.\n\n' +
                    '💡 Por favor, intenta enviarlo nuevamente o escribe tu mensaje.'
                  );
                }
              } else {
                logger.warn('⚠️ Audio message object es null o undefined');
              }
            }
            // Otros tipos de mensaje
            else {
              logger.info('⚠️ Tipo de mensaje no soportado:', Object.keys(message.message || {})[0]);
              await this.sendMessage(remoteJid, 'Lo siento, solo puedo procesar mensajes de texto y voz.');
            }

          } catch (msgError) {
            logger.error('❌ Error al procesar mensaje:', msgError);
            logger.error('Stack:', msgError.stack?.substring(0, 500));
          }
        }
      });

      this.messageHandlersConfigured = true;
      logger.success('✅ Handlers de mensajes configurados exitosamente');
      logger.info('📱 El bot está listo para recibir mensajes');

      return true;

    } catch (error) {
      logger.error('❌ Error al configurar handlers de mensajes', error);
      return false;
    }
  }

  /**
   * Procesar mensaje de texto
   */
  async processTextMessage(phoneNumber, text, remoteJid = null) {
    const jidToUse = remoteJid || (phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`);
    
    // Log detallado al inicio
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('📝 [TEXTO] Iniciando procesamiento de mensaje de texto');
    logger.info(`📝 [TEXTO] Phone: ${phoneNumber}, JID: ${jidToUse}`);
    logger.info(`📝 [TEXTO] Texto: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
    logger.info(`📝 [TEXTO] Timestamp: ${new Date().toISOString()}`);
    
    try {
      const PhoneNormalizer = require('./utils/phoneNormalizer');
      const kardexApi = require('./kardexApi');
      const kardexDb = require('./kardexDb');
      const smsService = require('./services/smsService');
      
      // Obtener o crear sesión
      logger.info(`📝 [TEXTO] Obteniendo sesión para: ${phoneNumber}`);
      let session = await sessionManager.getSession(phoneNumber);
      if (!session) {
        logger.info(`📝 [TEXTO] Creando nueva sesión para: ${phoneNumber}`);
        session = await sessionManager.createSession(phoneNumber);
      }
      
      const stateObj = session.current_order ? JSON.parse(session.current_order) : {};
      const currentState = session.state || sessionManager.STATES.IDLE;
      
      logger.info(`📱 [TEXTO] Procesando mensaje - Estado actual: ${currentState}`);
      
      // ELIMINADO: Verificación que mostraba "Ya confirmamos que eres cliente registrado" sin autenticación real
      // Ahora el flujo correcto es: hacer pedido → mostrar factura/precio → pedir confirmación → luego autenticación
      
      // FLUJO 0: Si está esperando confirmación si es cliente registrado (ANTES de cancelación universal)
      if (currentState === sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION) {
        try {
          // Usar detector de intenciones mejorado
          const intentDetector = require('./utils/intentDetector');
          const correctedText = require('./utils/textCorrector').correctText(text);
          const intentResult = await intentDetector.detectIntent(correctedText, {
            state: currentState,
            ...stateObj
          }, []);
          
          logger.info(`[ClientConfirmation] Intención detectada: ${intentResult.intent} (confianza: ${intentResult.confidence})`);
          
          // Limpiar signos de puntuación y normalizar para mejor detección
          const textLower = correctedText.toLowerCase()
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
            .replace(/[¡!¿?.,;:]/g, '') // Quitar signos de puntuación
            .trim();
          
          const yesKeywords = ['si', 'sí', 's', 'yes', 'y', 'cliente', 'registrado', 'tengo cuenta', 'ya tengo', 'correcto', 'si soy', 'si soy cliente', 'soy cliente', 'soy registrado', 'si estoy', 'sí soy', 'sí soy cliente'];
          const noKeywords = ['no', 'n', 'tampoco', 'no soy', 'no estoy', 'no tengo', 'no tengo cuenta', 'todavia no', 'todavía no', 'aun no', 'aún no'];
          
          logger.info(`🔍 [TEXTO] Verificando confirmación de cliente - texto limpio: "${textLower}"`);
          
          // Detección mejorada: usar detector de intenciones + keywords (sin signos de puntuación)
          const isYes = intentResult.intent === 'yes' || yesKeywords.some(keyword => {
            const keywordLower = keyword.toLowerCase();
            return textLower === keywordLower || 
                   textLower.startsWith(keywordLower) || 
                   textLower.includes(keywordLower) ||
                   textLower.endsWith(keywordLower) ||
                   (textLower.includes('si') && textLower.includes('cliente')) ||
                   (textLower.includes('sí') && textLower.includes('cliente'));
          });
          const isNo = intentResult.intent === 'no' || noKeywords.some(keyword => {
            const keywordLower = keyword.toLowerCase();
            return textLower === keywordLower || 
                   textLower.startsWith(keywordLower) || 
                   textLower.includes(keywordLower);
          });
          
          if (isYes) {
            // Usuario es cliente, buscar automáticamente por el número del remitente
            logger.info(`🔍 [TEXTO] Usuario confirmó que es cliente, buscando por número del remitente: ${phoneNumber}`);
            
            // Extraer el número real del remitente (puede venir como JID completo)
            let realPhoneForSearch = phoneNumber;
            
            // Si phoneNumber contiene @, extraer solo la parte numérica
            if (phoneNumber.includes('@')) {
              realPhoneForSearch = phoneNumber.split('@')[0];
              logger.info(`🔍 [TEXTO] Extraído número del JID: ${realPhoneForSearch}`);
            }
            
            // Si el número es muy largo (más de 15 dígitos), probablemente es un ID interno, intentar obtener el número real
            if (realPhoneForSearch.length > 15) {
              logger.warn(`⚠️ [TEXTO] Número muy largo (${realPhoneForSearch.length} dígitos), puede ser ID interno. Intentando obtener número real...`);
              // Intentar obtener el número real desde el remoteJid si está disponible
              if (jidToUse && jidToUse.includes('@lid')) {
                try {
                  // Buscar en cache de contactos
                  if (this.contacts && this.contacts[jidToUse]) {
                    const contact = this.contacts[jidToUse];
                    if (contact.jid) {
                      realPhoneForSearch = contact.jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
                      logger.info(`✅ [TEXTO] Número real obtenido desde cache: ${realPhoneForSearch}`);
                    } else if (contact.id) {
                      realPhoneForSearch = contact.id.replace('@s.whatsapp.net', '').replace('@c.us', '');
                      logger.info(`✅ [TEXTO] Número real obtenido desde cache (id): ${realPhoneForSearch}`);
                    }
                  }
                } catch (contactError) {
                  logger.warn(`⚠️ [TEXTO] Error al obtener número real: ${contactError.message}`);
                }
              }
            }
            
            // Normalizar el número del remitente
            const PhoneNormalizer = require('./utils/phoneNormalizer');
            const remitenteNormalized = PhoneNormalizer.normalize(realPhoneForSearch);
            logger.info(`🔍 [TEXTO] Número del remitente normalizado: ${remitenteNormalized} (original: ${realPhoneForSearch})`);
            
            // Buscar cliente por el número del remitente
            const clienteRemitente = await kardexApi.getClientByPhone(remitenteNormalized);
            
            if (clienteRemitente) {
              // Cliente encontrado por número del remitente
              logger.info(`✅ [TEXTO] Cliente encontrado por número del remitente: ${clienteRemitente.nombre}`);
              await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
                _client_id: clienteRemitente.id,
                _client_phone: remitenteNormalized,
                _client_name: clienteRemitente.nombre
              });
              await this.sendMessage(jidToUse,
                `✅ Ya confirmamos que eres cliente registrado, *${clienteRemitente.nombre}*.\n\n` +
                `🔐 Por favor, *escribe* tu *contraseña* para acceder a tu cuenta.\n\n` +
                `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
                `💡 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
                `💡 O si quieres hacer un pedido sin ingresar, escribe *PEDIDO*`
              );
              return;
            } else {
              // Cliente no encontrado por número del remitente, pedir número manualmente
              logger.warn(`⚠️ [TEXTO] Cliente no encontrado por número del remitente: ${remitenteNormalized}`);
              await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PHONE, {});
              await this.sendMessage(jidToUse,
                `✅ Perfecto, eres cliente registrado.\n\n` +
                `📞 Por favor, ingresa tu *número de teléfono* registrado (9 dígitos):\n\n` +
                `Ejemplo: *987654321* o *51987654321*`
              );
              return;
            }
          } else if (isNo) {
            // Usuario NO es cliente, mostrar opciones
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
            await this.sendMessage(jidToUse,
              `👋 *¡Perfecto! Bienvenido a KARDEX* 👋\n\n` +
              `📋 *¿Qué deseas hacer?*\n\n` +
              `1️⃣ *REGISTRAR* - Crear una cuenta nueva\n` +
              `2️⃣ *PEDIDO* - Hacer un pedido (solo nombre y DNI)\n` +
              `3️⃣ *CATALOGO* - Ver productos disponibles\n` +
              `4️⃣ Escribe tu pedido directamente, ejemplo: *"quiero una laptop"*\n\n` +
              `💡 También puedes enviarme una nota de voz con lo que necesitas.`
            );
            return;
          } else {
            // Respuesta no clara, usar sugerencias inteligentes
            const suggestions = this._generateSuggestions(textLower);
            await this.sendMessage(jidToUse,
              `❓ No estoy seguro de entender tu respuesta.\n\n` +
              `Por favor, responde claramente:\n` +
              `• *SÍ* o *SI* si eres cliente registrado\n` +
              `• *NO* si no eres cliente registrado\n\n` +
              (suggestions ? `💡 ¿Quisiste decir: ${suggestions}?\n\n` : '') +
              `O escribe *CANCELAR* para volver al inicio.`
            );
            return;
          }
        } catch (confirmationError) {
          logger.error('[ClientConfirmation] Error al procesar confirmación:', confirmationError);
          // Fallback básico
          await this.sendMessage(jidToUse,
            `❓ Por favor, responde *SÍ* o *NO* para continuar.\n\n` +
            `• *SÍ* si eres cliente registrado\n` +
            `• *NO* si no eres cliente registrado`
          );
          return;
        }
      }
      
      // DETECCIÓN UNIVERSAL: Comandos de cancelación/salida que funcionan en CUALQUIER estado
      // EXCEPTO AWAITING_CLIENT_CONFIRMATION (ya se procesó arriba)
      // NOTA: "no" NO está en esta lista para evitar conflictos con respuestas SÍ/NO
      const textLower = text.toLowerCase().trim();
      const cancelKeywords = [
        'salir', 'salirme', 'cancelar', 'cancel', 'volver', 'volver atrás', 'volver atras',
        'volver al inicio', 'inicio', 'empezar de nuevo', 'comenzar de nuevo', 'reiniciar',
        'resetear', 'cerrar', 'terminar', 'acabar', 'parar', 'detener', 'mejor no',
        'déjalo', 'dejalo', 'no importa', 'olvídalo', 'olvidalo', 'ya no quiero',
        'déjame en paz', 'déjame tranquilo', 'adiós', 'adios', 'chau', 'bye',
        'cancelar todo', 'cancelar operacion', 'cancelar operación'
      ];
      
      // NO considerar "no" como cancelación si está en estado de confirmación de cliente o esperando contraseña
      const isCancelCommand = (currentState === sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION || 
                                currentState === sessionManager.STATES.AWAITING_PASSWORD)
        ? false 
        : cancelKeywords.some(keyword => textLower.includes(keyword));
      
      if (isCancelCommand && currentState !== sessionManager.STATES.IDLE && 
          currentState !== sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION &&
          currentState !== sessionManager.STATES.AWAITING_PASSWORD) {
        // Cancelar operación actual y volver al inicio
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
        await this.sendMessage(jidToUse,
          `👋 *Entendido, operación cancelada.* 👋\n\n` +
          `🔄 He vuelto al menú principal. ¿En qué puedo ayudarte?\n\n` +
          `💡 Escribe *HOLA* para comenzar o ver las opciones disponibles.`
        );
        return;
      }
      
      // FLUJO ESPECIAL (TEXTO): Si está esperando contraseña - DEBE ESTAR ANTES DE AWAITING_PHONE
      if (currentState === sessionManager.STATES.AWAITING_PASSWORD) {
        // Limpiar texto para mejor detección
        const textLower = text.toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
          .replace(/[¡!¿?.,;:]/g, '') // Quitar signos de puntuación
          .trim();
        
        // PRIORIDAD 1: Detectar CANCELAR (incluyendo variantes de transcripción)
        const cancelKeywords = [
          'cancelar', 'cancel', 'cancela', 'cancelar todo', 'cancelar operacion',
          'gonzilar', 'gonzillar', 'gonzil', 'cancilar', 'cancillar', // Variantes de transcripción
          'volver', 'volver atras', 'volver atrás', 'inicio', 'salir'
        ];
        const isCancel = cancelKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return textLower === keywordLower || 
                 textLower.includes(keywordLower) ||
                 textLower.startsWith(keywordLower) ||
                 textLower.endsWith(keywordLower);
        });
        
        if (isCancel) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: undefined,
            _client_id: undefined,
            _client_phone: undefined,
            _client_name: undefined
          });
          await this.sendMessage(jidToUse,
            '❌ Verificación cancelada.\n\n' +
            '💬 Escribe *HOLA* para comenzar de nuevo.'
          );
          return;
        }
        
        // PRIORIDAD 2: Detectar "si soy cliente" o variantes (por si el usuario se confundió)
        const yesKeywords = ['si', 'sí', 's', 'yes', 'y', 'cliente', 'registrado', 'tengo cuenta', 'ya tengo', 'si soy', 'si soy cliente', 'soy cliente', 'soy registrado', 'si estoy', 'sí soy', 'sí soy cliente'];
        const isYes = yesKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return textLower === keywordLower || 
                 textLower.startsWith(keywordLower) || 
                 textLower.includes(keywordLower) ||
                 textLower.endsWith(keywordLower) ||
                 (textLower.includes('si') && textLower.includes('cliente')) ||
                 (textLower.includes('sí') && textLower.includes('cliente'));
        });
        
        if (isYes) {
          // El usuario dice "si soy cliente" pero ya está en flujo de contraseña
          // Esto significa que ya confirmó antes, solo necesita la contraseña
          const clientName = stateObj._client_name || 'Cliente';
          await this.sendMessage(jidToUse,
            `✅ Ya confirmamos que eres cliente registrado, *${clientName}*.\n\n` +
            '🔐 Ahora necesitamos tu *contraseña* para acceder a tu cuenta.\n\n' +
            '💡 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"*\n' +
            '❌ O escribe *CANCELAR* para volver al inicio.'
          );
          return;
        }
        
        // PRIORIDAD 3: Detectar si el usuario dice que olvidó su contraseña
        const forgotPasswordKeywords = [
          'olvide', 'olvidé', 'olvido', 'olvidó', 'olvido mi contraseña',
          'olvide contraseña', 'olvidé contraseña', 'no recuerdo',
          'no recuerdo mi contraseña', 'olvide mi password',
          'perdi mi contraseña', 'perdí mi contraseña', 'recuperar',
          'recuperar contraseña', 'cambiar contraseña', 'resetear contraseña'
        ];
        
        const isForgotPassword = forgotPasswordKeywords.some(keyword => 
          textLower.includes(keyword)
        );
        
        if (isForgotPassword) {
          // Usuario olvidó su contraseña, enviar código SMS
          const smsService = require('./services/smsService');
          const clientPhone = stateObj._client_phone || phoneNumber;
          const clientName = stateObj._client_name || 'Usuario';
          
          // Generar código de verificación
          const smsCode = smsService.generateVerificationCode();
          const codeExpiresAt = Date.now() + (10 * 60 * 1000); // 10 minutos
          
          // Intentar enviar SMS (en desarrollo, se envía por WhatsApp)
          const smsSent = await smsService.sendVerificationCode(clientPhone, smsCode, this, jidToUse);
          
          if (smsSent) {
            // Guardar código en sesión
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
              ...stateObj,
              _sms_code: smsCode,
              _sms_code_expires: codeExpiresAt,
              _sms_attempts: 0
            });
            
            await this.sendMessage(jidToUse,
              `🔐 *Recuperación de contraseña* 🔐\n\n` +
              `Hola *${clientName}*,\n\n` +
              `📱 Hemos enviado un código de verificación de 6 dígitos a tu número de teléfono *${PhoneNormalizer.format(clientPhone)}*.\n\n` +
              `💬 *También te lo enviamos por WhatsApp arriba.*\n\n` +
              `🔢 Por favor, ingresa el código que recibiste:\n\n` +
              `⏰ *El código expira en 10 minutos.*\n\n` +
              `❌ Si no recibiste el código, escribe *CANCELAR* para volver al inicio.`
            );
          } else {
            // Error al enviar SMS, ofrecer alternativa
            await this.sendMessage(jidToUse,
              `❌ No pudimos enviar el SMS al número registrado.\n\n` +
              `Por favor, contacta con soporte o intenta ingresar tu contraseña nuevamente.\n\n` +
              `Si no recuerdas tu contraseña, puedes escribir *CANCELAR* para volver al inicio.`
            );
          }
          return;
        }
        
        // Si no es ninguna de las opciones anteriores, es una contraseña
        const password = text.replace(/[^a-zA-Z0-9]/g, '').trim();
        logger.info(`🔐 [TEXTO] Contraseña recibida (original): "${text}" -> (limpio): "${password}"`);
        
        if (!password || password.length === 0) {
          await this.sendMessage(jidToUse,
            '❌ No pude detectar tu contraseña en el mensaje.\n\n' +
            '💡 Por favor, escribe tu contraseña correctamente.\n\n' +
            '🔐 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"*'
          );
          return;
        }
        
        const clientPhone = stateObj._client_phone || phoneNumber;
        const clientId = stateObj._client_id; // Usar el ID que ya tenemos en el estado
        
        logger.info(`🔐 [TEXTO] Verificando contraseña para cliente: ${clientPhone}, contraseña limpia: "${password}", clientId: ${clientId || 'NO DISPONIBLE'}`);
        logger.info(`🔐 [TEXTO] Estado actual: ${JSON.stringify({ clientPhone, password, clientId, stateObj: { _client_phone: stateObj._client_phone, _client_id: stateObj._client_id, _client_name: stateObj._client_name, _return_to_confirm: stateObj._return_to_confirm, pedido_id: stateObj.pedido_id } })}`);
        
        try {
          const verifyResult = await kardexApi.verifyClientPassword(clientPhone, password, clientId);
          
          logger.info(`🔐 [TEXTO] Resultado completo de verificación: ${JSON.stringify({ success: verifyResult.success, hasCliente: !!verifyResult.cliente, hasToken: !!verifyResult.token, message: verifyResult.message })}`);
          
          if (verifyResult && verifyResult.success) {
            // Contraseña correcta, usuario autenticado
            logger.success(`✅ [TEXTO] Contraseña correcta! Autenticando usuario...`);
            
            // Verificar si había un pedido pendiente de confirmación
            const hadPendingConfirm = stateObj._return_to_confirm === true || stateObj._pending_confirm === true;
            logger.info(`🔍 [TEXTO] Verificando pedido pendiente: hadPendingConfirm=${hadPendingConfirm}, pedido_id=${stateObj.pedido_id || stateObj._pedido_id || 'NO'}`);
            
            // Obtener pedido_id desde la sesión si no está en stateObj
            // Buscar usando el phoneNumber actual y también usando el número de teléfono del cliente
            let pedidoId = stateObj.pedido_id || stateObj._pedido_id;
            if (!pedidoId) {
              // Intentar con el phoneNumber actual
              pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
              logger.info(`🔍 [TEXTO] Pedido ID obtenido de sesión (phoneNumber): ${pedidoId || 'NO'}`);
              
              // Si no se encuentra, intentar con el número de teléfono del cliente
              if (!pedidoId && clientPhone && clientPhone !== phoneNumber) {
                const clientPhoneNormalized = clientPhone.replace(/[^0-9]/g, ''); // Limpiar el número
                const phoneNumberNormalized = phoneNumber.replace(/[^0-9]/g, ''); // Limpiar el phoneNumber
                
                // Si son diferentes, buscar con el número del cliente
                if (clientPhoneNormalized !== phoneNumberNormalized) {
                  pedidoId = await sessionManager.getActiveOrderId(clientPhone);
                  logger.info(`🔍 [TEXTO] Pedido ID obtenido de sesión (clientPhone): ${pedidoId || 'NO'}`);
                }
              }
              
              // Si aún no se encuentra, buscar en TODAS las sesiones activas que tengan pedidos (sin filtrar por phoneNumber)
              if (!pedidoId) {
                try {
                  const db = require('./db');
                  // Buscar pedidos activos en TODAS las sesiones
                  const activeSessions = await db.all(
                    `SELECT phone_number, current_order FROM sessions 
                     WHERE current_order LIKE '%pedido_id%'`
                  );
                  
                  logger.info(`🔍 [TEXTO] Buscando en ${activeSessions.length} sesiones con pedidos activos`);
                  
                  for (const sessionRow of activeSessions) {
                    try {
                      const sessionOrder = JSON.parse(sessionRow.current_order || '{}');
                      if (sessionOrder.pedido_id) {
                        // Verificar si el pedido existe y está en estado EN_PROCESO
                        const kardexApi = require('./kardexApi');
                        const pedido = await kardexApi.getPedidoEnProceso(sessionOrder.pedido_id);
                        
                        if (pedido && pedido.estado === 'EN_PROCESO') {
                          // Verificar si el pedido pertenece al cliente autenticado (por teléfono o cliente_id)
                          const pedidoClienteId = pedido.cliente_id;
                          const clienteIdAutenticado = verifyResult.cliente?.id || verifyResult.user?.id;
                          
                          // Si el pedido no tiene cliente_id asignado o coincide con el cliente autenticado, usarlo
                          if (!pedidoClienteId || pedidoClienteId === clienteIdAutenticado) {
                            pedidoId = sessionOrder.pedido_id;
                            logger.info(`🔍 [TEXTO] Pedido ID encontrado en sesión alternativa: ${pedidoId} (cliente_id: ${pedidoClienteId || 'NO ASIGNADO'})`);
                            break;
                          }
                        }
                      }
                    } catch (e) {
                      // Ignorar errores de parsing
                    }
                  }
                } catch (dbError) {
                  logger.error('Error al buscar pedido en sesiones alternativas:', dbError);
                }
              }
              
              // Si aún no se encuentra, buscar directamente en la base de datos de pedidos
              // Buscar primero TODOS los pedidos en EN_PROCESO (sin filtrar por cliente_id)
              if (!pedidoId) {
                try {
                  logger.info(`🔍 [TEXTO] Buscando pedidos activos directamente en BD (sin filtrar por cliente_id)`);
                  const kardexDb = require('./kardexDb');
                  if (kardexDb.isConnected()) {
                    const pool = kardexDb.getPool();
                    // Buscar el pedido más reciente en EN_PROCESO
                    const [pedidos] = await pool.execute(
                      `SELECT id, numero_pedido, cliente_id, estado FROM pedidos 
                       WHERE estado = 'EN_PROCESO' 
                       ORDER BY id DESC LIMIT 5`
                    );
                    
                    if (pedidos && pedidos.length > 0) {
                      const clienteIdAutenticado = verifyResult.cliente?.id || verifyResult.user?.id;
                      
                      // Buscar el pedido que no tenga cliente_id asignado o que pertenezca al cliente autenticado
                      const pedidoEncontrado = pedidos.find(p => !p.cliente_id || p.cliente_id === clienteIdAutenticado);
                      
                      if (pedidoEncontrado) {
                        pedidoId = pedidoEncontrado.id;
                        logger.info(`🔍 [TEXTO] Pedido activo encontrado directamente en BD: ${pedidoId} (cliente_id: ${pedidoEncontrado.cliente_id || 'NO ASIGNADO'})`);
                      } else {
                        // Si no encuentra uno específico, usar el más reciente
                        pedidoId = pedidos[0].id;
                        logger.info(`🔍 [TEXTO] Usando pedido más reciente en BD: ${pedidoId}`);
                      }
                    }
                  }
                } catch (bdError) {
                  logger.error('Error al buscar pedido directamente en BD:', bdError);
                }
              }
            }
            
            // Actualizar estado con autenticación, preservando datos del pedido
            const newStateObj = {
              _authenticated: true,
              _client_id: verifyResult.cliente?.id || verifyResult.user?.id,
              _client_name: verifyResult.cliente?.nombre || verifyResult.user?.nombre_completo,
              _user_token: verifyResult.token,
              // Preservar datos del pedido si existían
              pedido_id: pedidoId,
              _pedido_id: pedidoId
            };
            
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, newStateObj);
            
            // Si había un pedido pendiente de confirmación O si se encontró un pedido activo, mostrar bienvenida con pedido
            if ((hadPendingConfirm || pedidoId) && pedidoId) {
              logger.info(`📦 [TEXTO] Usuario autenticado con pedido pendiente (ID: ${pedidoId}), mostrando información del pedido...`);
              
              try {
                // Obtener detalles del pedido
                const kardexApi = require('./kardexApi');
                const pedido = await kardexApi.getPedidoEnProceso(pedidoId);
                
                if (pedido) {
                  // Construir mensaje con información del pedido
                  let mensajePedido = `✅ *¡Bienvenido *${verifyResult.cliente?.nombre || verifyResult.user?.nombre_completo || 'Cliente'}*!* ✅\n\n`;
                  mensajePedido += `🛒 *Tu pedido se confirmará después del pago*\n\n`;
                  
                  // Agregar información del pedido
                  if (pedido.numero_pedido) {
                    mensajePedido += `📦 *Pedido:* ${pedido.numero_pedido}\n\n`;
                  }
                  
                  // Agregar productos del pedido
                  if (pedido.detalles && pedido.detalles.length > 0) {
                    mensajePedido += `*Productos:*\n`;
                    pedido.detalles.forEach((detalle, index) => {
                      const productoNombre = detalle.producto?.nombre || detalle.nombre_producto || 'Producto';
                      const cantidad = Number(detalle.cantidad) || 1;
                      const precio = Number(detalle.precio_unitario || detalle.precio || 0);
                      const subtotal = cantidad * precio;
                      mensajePedido += `${index + 1}. *${productoNombre}*\n`;
                      mensajePedido += `   ${cantidad} x S/. ${precio.toFixed(2)} = S/. ${subtotal.toFixed(2)}\n\n`;
                    });
                  }
                  
                  // Agregar total
                  const total = Number(pedido.total || pedido.monto_total || 0);
                  mensajePedido += `💰 *Total: S/. ${total.toFixed(2)}*\n\n`;
                  
                  // Pedir método de pago
                  mensajePedido += `💳 *Por favor, selecciona tu método de pago:*\n\n`;
                  mensajePedido += `• *TRANSFERENCIA* - Transferencia bancaria\n`;
                  mensajePedido += `• *EFECTIVO* - Pago en efectivo\n`;
                  mensajePedido += `• *YAPE* - Pago por Yape\n`;
                  mensajePedido += `• *PLIN* - Pago por Plin\n\n`;
                  mensajePedido += `Responde con el nombre del método de pago que deseas usar.`;
                  
                  // Actualizar estado para esperar método de pago
                  await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PAYMENT_METHOD, {
                    ...newStateObj,
                    _awaiting_payment_method: true
                  });
                  
                  await this.sendMessage(jidToUse, mensajePedido);
                  return;
                } else {
                  logger.warn(`⚠️ [TEXTO] No se pudo obtener detalles del pedido ${pedidoId}`);
                }
              } catch (pedidoError) {
                logger.error(`❌ [TEXTO] Error al obtener detalles del pedido:`, pedidoError);
              }
            }
            
            // Si no había pedido pendiente, mostrar mensaje de bienvenida normal
            await this.sendMessage(jidToUse,
              `✅ *¡Bienvenido *${verifyResult.cliente?.nombre || verifyResult.user?.nombre_completo || 'Cliente'}*!* ✅\n\n` +
              `🎯 *¿Qué deseas hacer hoy?*\n\n` +
              `🛍️ Ver catálogo: escribe *CATALOGO*\n` +
              `🛒 Hacer pedido: escribe tu pedido\n` +
              `📊 Ver mis pedidos: escribe *MIS PEDIDOS*\n` +
              `❓ Ayuda: escribe *AYUDA*`
            );
            return;
          } else {
            logger.warn(`🔐 [TEXTO] Contraseña incorrecta para cliente: ${clientPhone}, contraseña intentada: "${password}", mensaje: ${verifyResult?.message || 'Sin mensaje'}`);
            await this.sendMessage(jidToUse,
              `❌ Contraseña incorrecta.\n\n` +
              `💡 La contraseña que intentaste fue: *${password}*\n\n` +
              `Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
              `O escribe *CANCELAR* para volver al inicio.`
            );
            return;
          }
        } catch (passwordError) {
          logger.error('Error al verificar contraseña', passwordError);
          await this.sendMessage(jidToUse,
            `❌ Hubo un error al verificar tu contraseña.\n\n` +
            `Por favor, intenta nuevamente o escribe *CANCELAR* para volver al inicio.`
          );
          return;
        }
      }
      
      // FLUJO 0.5: Si está esperando método de pago
      if (currentState === sessionManager.STATES.AWAITING_PAYMENT_METHOD) {
        const transcriptionCorrector = require('./utils/transcriptionCorrector');
        const intencion = transcriptionCorrector.detectarIntencion(text);
        const textLower = text.toLowerCase().trim();
        
        // Mapeo de intenciones a métodos de pago
        const metodosPago = {
          'pago_transferencia': 'TRANSFERENCIA',
          'pago_efectivo': 'EFECTIVO',
          'pago_yape': 'YAPE',
          'pago_plin': 'PLIN'
        };
        
        // Buscar método de pago usando el corrector
        let metodoSeleccionado = metodosPago[intencion] || null;
        
        // Si no se detectó por intención, buscar por palabras clave
        if (!metodoSeleccionado) {
          if (transcriptionCorrector.coincide(textLower, transcriptionCorrector.correcciones.transferencia)) {
            metodoSeleccionado = 'TRANSFERENCIA';
          } else if (transcriptionCorrector.coincide(textLower, transcriptionCorrector.correcciones.efectivo)) {
            metodoSeleccionado = 'EFECTIVO';
          } else if (transcriptionCorrector.coincide(textLower, transcriptionCorrector.correcciones.yape)) {
            metodoSeleccionado = 'YAPE';
          } else if (transcriptionCorrector.coincide(textLower, transcriptionCorrector.correcciones.plin)) {
            metodoSeleccionado = 'PLIN';
          }
        }
        
        if (metodoSeleccionado) {
          logger.info(`💳 [TEXTO] Método de pago seleccionado: ${metodoSeleccionado}`);
          
          const pedidoId = stateObj.pedido_id || stateObj._pedido_id;
          if (pedidoId) {
            // Confirmar pedido con método de pago
            const orderHandler = require('./orderHandler');
            const sessionStateWithPayment = {
              state: sessionManager.STATES.IDLE,
              phoneNumber,
              nombreCliente: stateObj._client_name || 'Cliente',
              remoteJid: jidToUse,
              authenticated: true,
              user_token: stateObj._user_token,
              _authenticated: true,
              _user_token: stateObj._user_token,
              _client_id: stateObj._client_id,
              _client_name: stateObj._client_name,
              pedido_id: pedidoId,
              metodo_pago: metodoSeleccionado,
              ...stateObj
            };
            
            // Confirmar pedido con método de pago
            await orderHandler.confirmOrder(phoneNumber, this, sessionStateWithPayment);
            return;
          } else {
            await this.sendMessage(jidToUse,
              `❌ No se encontró un pedido activo. Por favor, inicia un nuevo pedido.`
            );
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
              ...stateObj,
              _awaiting_payment_method: false
            });
            return;
          }
        } else {
          await this.sendMessage(jidToUse,
            `❌ Método de pago no reconocido.\n\n` +
            `Por favor, selecciona uno de los siguientes métodos:\n\n` +
            `• *TRANSFERENCIA* - Transferencia bancaria\n` +
            `• *EFECTIVO* - Pago en efectivo\n` +
            `• *YAPE* - Pago por Yape\n` +
            `• *PLIN* - Pago por Plin\n\n` +
            `O escribe *CANCELAR* para cancelar el pedido.`
          );
          return;
        }
      }
      
      // FLUJO 1: Si está esperando número de teléfono
      if (currentState === sessionManager.STATES.AWAITING_PHONE) {
        // PRIORIDAD: Detectar CANCELAR antes de procesar como número
        const textLowerForCancel = text.toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
          .replace(/[¡!¿?.,;:]/g, '') // Quitar signos de puntuación
          .trim();
        
        const cancelKeywords = [
          'cancelar', 'cancel', 'cancela', 'cancelar todo', 'cancelar operacion',
          'gonzilar', 'gonzillar', 'gonzil', 'cancilar', 'cancillar', // Variantes de transcripción
          'volver', 'volver atras', 'volver atrás', 'inicio', 'salir'
        ];
        const isCancel = cancelKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return textLowerForCancel === keywordLower || 
                 textLowerForCancel.includes(keywordLower) ||
                 textLowerForCancel.startsWith(keywordLower) ||
                 textLowerForCancel.endsWith(keywordLower);
        });
        
        if (isCancel) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: undefined,
            _client_id: undefined,
            _client_phone: undefined,
            _client_name: undefined
          });
          await this.sendMessage(jidToUse,
            '❌ Operación cancelada.\n\n' +
            '💬 Escribe *HOLA* para comenzar de nuevo.'
          );
          return;
        }
        
        // Limpiar transcripción: quitar TODOS los caracteres que no sean números
        // Whisper a veces transcribe "9 9 3 0 4 3 1 1 2" o "99, 30, 43, 1, 1, 2" o "99-30-43-1-1-2" o "9-9-3-0-4-3-1-1"
        const cleanedText = text.replace(/[^0-9]/g, '');
        logger.info(`📞 [TEXTO] Número recibido (original): "${text}" -> (limpio): "${cleanedText}"`);
        
        // Si después de limpiar no hay números, es un error
        if (!cleanedText || cleanedText.length === 0) {
          await this.sendMessage(jidToUse, 
            '❌ No pude detectar un número de teléfono en tu mensaje.\n\n' +
            '💡 Por favor, escribe tu número de 9 dígitos (ejemplo: 987654321) o con código de país (51987654321).\n\n' +
            '❌ O escribe *CANCELAR* para volver al inicio.'
          );
          return;
        }
        
        const phoneInput = PhoneNormalizer.normalize(cleanedText);
        if (!PhoneNormalizer.isValidPeruvianPhone(phoneInput)) {
          await this.sendMessage(jidToUse, 
            `❌ El número de teléfono no es válido.\n\n` +
            `📞 Detecté: *${cleanedText}*\n\n` +
            `Por favor, ingresa un número de 9 dígitos (ejemplo: 987654321) o con código de país (51987654321).`
          );
          return;
        }
        
        // Actualizar sesión con el número ingresado
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
          _input_phone: phoneInput
        });
        
        // Buscar cliente con el número ingresado
        let cliente = null;
        if (kardexDb.isConnected()) {
          cliente = await kardexDb.buscarClientePorTelefono(phoneInput);
        }
        if (!cliente) {
          cliente = await kardexApi.getClientByPhone(phoneInput);
        }
        
        // Si el cliente existe y tiene nombre, pedir contraseña
        if (cliente && cliente.nombre) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
            _client_id: cliente.id,
            _client_phone: phoneInput,
            _client_name: cliente.nombre
          });
          await this.sendMessage(jidToUse,
            `👋 ¡Hola *${cliente.nombre}*! 👋\n\n` +
            `Para acceder a tu cuenta y ver tus pedidos, por favor *escribe* tu *contraseña* de la página web.\n\n` +
            `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
            `🔐 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
            `Si no tienes contraseña, puedes registrarte escribiendo *REGISTRAR*`
          );
          return;
        } else {
          // Cliente no encontrado, ofrecer registro
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: phoneInput
          });
          await this.sendMessage(jidToUse,
            `👋 ¡Hola! 👋\n\n` +
            `No encontré una cuenta registrada con el número *${PhoneNormalizer.format(phoneInput)}*.\n\n` +
            `📋 *¿Qué deseas hacer?*\n\n` +
            `1️⃣ *REGISTRAR* - Crear una cuenta nueva (email, contraseña, nombre, DNI)\n` +
            `2️⃣ *PEDIDO* - Hacer un pedido sin registro (solo nombre y DNI)\n\n` +
            `Escribe *REGISTRAR* o *PEDIDO* según lo que prefieras.`
          );
          return;
        }
      }
      
      // FLUJO 2: Si está esperando contraseña
      if (currentState === sessionManager.STATES.AWAITING_PASSWORD) {
        // Limpiar texto para mejor detección
        const textLower = text.toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
          .replace(/[¡!¿?.,;:]/g, '') // Quitar signos de puntuación
          .trim();
        
        // PRIORIDAD 1: Detectar CANCELAR (incluyendo variantes de transcripción)
        const cancelKeywords = [
          'cancelar', 'cancel', 'cancela', 'cancelar todo', 'cancelar operacion',
          'gonzilar', 'gonzillar', 'gonzil', 'cancilar', 'cancillar', // Variantes de transcripción
          'volver', 'volver atras', 'volver atrás', 'inicio', 'salir'
        ];
        const isCancel = cancelKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return textLower === keywordLower || 
                 textLower.includes(keywordLower) ||
                 textLower.startsWith(keywordLower) ||
                 textLower.endsWith(keywordLower);
        });
        
        if (isCancel) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: undefined,
            _client_id: undefined,
            _client_phone: undefined,
            _client_name: undefined
          });
          await this.sendMessage(jidToUse,
            '❌ Verificación cancelada.\n\n' +
            '💬 Escribe *HOLA* para comenzar de nuevo.'
          );
          return;
        }
        
        // PRIORIDAD 2: Detectar "si soy cliente" o variantes (por si el usuario se confundió)
        const yesKeywords = ['si', 'sí', 's', 'yes', 'y', 'cliente', 'registrado', 'tengo cuenta', 'ya tengo', 'si soy', 'si soy cliente', 'soy cliente', 'soy registrado', 'si estoy', 'sí soy', 'sí soy cliente'];
        const isYes = yesKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return textLower === keywordLower || 
                 textLower.includes(keywordLower) ||
                 textLower.startsWith(keywordLower) ||
                 textLower.endsWith(keywordLower) ||
                 (textLower.includes('si') && textLower.includes('cliente')) ||
                 (textLower.includes('sí') && textLower.includes('cliente'));
        });
        
        if (isYes) {
          // El usuario dice "si soy cliente" pero ya está en flujo de contraseña
          // Esto significa que ya confirmó antes, solo necesita la contraseña
          const clientName = stateObj._client_name || 'Cliente';
          await this.sendMessage(jidToUse,
            `✅ Ya confirmamos que eres cliente registrado, *${clientName}*.\n\n` +
            '🔐 Ahora necesitamos tu *contraseña* para acceder a tu cuenta.\n\n' +
            '💡 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"*\n' +
            '❌ O escribe *CANCELAR* para volver al inicio.'
          );
          return;
        }
        
        // PRIORIDAD 3: Detectar si el usuario dice que olvidó su contraseña
        const forgotPasswordKeywords = [
          'olvide', 'olvidé', 'olvido', 'olvidó', 'olvido mi contraseña',
          'olvide contraseña', 'olvidé contraseña', 'no recuerdo',
          'no recuerdo mi contraseña', 'olvide mi password',
          'perdi mi contraseña', 'perdí mi contraseña', 'recuperar',
          'recuperar contraseña', 'cambiar contraseña', 'resetear contraseña'
        ];
        
        const isForgotPassword = forgotPasswordKeywords.some(keyword => 
          textLower.includes(keyword)
        );
        
        if (isForgotPassword) {
          // Usuario olvidó su contraseña, enviar código SMS
          const clientPhone = stateObj._client_phone || phoneNumber;
          const clientName = stateObj._client_name || 'Usuario';
          
          // Generar código de verificación
          const smsCode = smsService.generateVerificationCode();
          const codeExpiresAt = Date.now() + (10 * 60 * 1000); // 10 minutos
          
          // Intentar enviar SMS (en desarrollo, se envía por WhatsApp)
          const smsSent = await smsService.sendVerificationCode(clientPhone, smsCode, this, jidToUse);
          
          if (smsSent) {
            // Guardar código en sesión
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
              ...stateObj,
              _sms_code: smsCode,
              _sms_code_expires: codeExpiresAt,
              _sms_attempts: 0
            });
            
            await this.sendMessage(jidToUse,
              `🔐 *Recuperación de contraseña* 🔐\n\n` +
              `Hola *${clientName}*,\n\n` +
              `📱 Hemos enviado un código de verificación de 6 dígitos a tu número de teléfono *${PhoneNormalizer.format(clientPhone)}*.\n\n` +
              `💬 *También te lo enviamos por WhatsApp arriba.*\n\n` +
              `🔢 Por favor, ingresa el código que recibiste:\n\n` +
              `⏰ *El código expira en 10 minutos.*\n\n` +
              `❌ Si no recibiste el código, escribe *CANCELAR* para volver al inicio.`
            );
          } else {
            // Error al enviar SMS, ofrecer alternativa
            await this.sendMessage(jidToUse,
              `❌ No pudimos enviar el SMS al número registrado.\n\n` +
              `Por favor, contacta con soporte o intenta ingresar tu contraseña nuevamente.\n\n` +
              `Si no recuerdas tu contraseña, puedes escribir *CANCELAR* para volver al inicio.`
            );
          }
          return;
        }
        
        // Si no es "olvidé contraseña", intentar verificar contraseña normal
        // Limpiar contraseña: quitar TODOS los caracteres que no sean alfanuméricos (comas, espacios, guiones, puntos, etc.)
        // Por si viene de copiar/pegar o dictado con comas/guiones
        const password = text.replace(/[^a-zA-Z0-9]/g, '').trim();
        logger.info(`🔐 [TEXTO] Contraseña recibida (original): "${text}" -> (limpio): "${password}"`);
        
        if (!password || password.length === 0) {
          await this.sendMessage(jidToUse,
            '❌ No pude detectar tu contraseña en el mensaje.\n\n' +
            '💡 Por favor, escribe tu contraseña correctamente.\n\n' +
            '🔐 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"*'
          );
          return;
        }
        
        const clientPhone = stateObj._client_phone || phoneNumber;
        const clientId = stateObj._client_id; // Usar el ID que ya tenemos en el estado
        
        logger.info(`🔐 [TEXTO] Verificando contraseña para cliente: ${clientPhone}, contraseña limpia: "${password}", clientId: ${clientId || 'NO DISPONIBLE'}`);
          logger.info(`🔐 [TEXTO] Estado actual: ${JSON.stringify({ clientPhone, password, clientId, stateObj: { _client_phone: stateObj._client_phone, _client_id: stateObj._client_id, _client_name: stateObj._client_name, _return_to_confirm: stateObj._return_to_confirm, pedido_id: stateObj.pedido_id } })}`);
        
        try {
          const verifyResult = await kardexApi.verifyClientPassword(clientPhone, password, clientId);
          
          logger.info(`🔐 [TEXTO] Resultado completo de verificación: ${JSON.stringify({ success: verifyResult.success, hasCliente: !!verifyResult.cliente, hasToken: !!verifyResult.token, message: verifyResult.message })}`);
          
          if (verifyResult && verifyResult.success) {
            // Contraseña correcta, usuario autenticado
            logger.success(`✅ [TEXTO] Contraseña correcta! Autenticando usuario...`);
            
            // Verificar si había un pedido pendiente de confirmación
            const hadPendingConfirm = stateObj._return_to_confirm === true || stateObj._pending_confirm === true;
            logger.info(`🔍 [TEXTO] Verificando pedido pendiente: hadPendingConfirm=${hadPendingConfirm}, pedido_id=${stateObj.pedido_id || stateObj._pedido_id || 'NO'}`);
            
            // Obtener pedido_id desde la sesión si no está en stateObj
            // Buscar usando el phoneNumber actual y también usando el número de teléfono del cliente
            let pedidoId = stateObj.pedido_id || stateObj._pedido_id;
            if (!pedidoId) {
              // Intentar con el phoneNumber actual
              pedidoId = await sessionManager.getActiveOrderId(phoneNumber);
              logger.info(`🔍 [TEXTO] Pedido ID obtenido de sesión (phoneNumber): ${pedidoId || 'NO'}`);
              
              // Si no se encuentra, intentar con el número de teléfono del cliente
              if (!pedidoId && clientPhone && clientPhone !== phoneNumber) {
                const clientPhoneNormalized = clientPhone.replace(/[^0-9]/g, ''); // Limpiar el número
                const phoneNumberNormalized = phoneNumber.replace(/[^0-9]/g, ''); // Limpiar el phoneNumber
                
                // Si son diferentes, buscar con el número del cliente
                if (clientPhoneNormalized !== phoneNumberNormalized) {
                  pedidoId = await sessionManager.getActiveOrderId(clientPhone);
                  logger.info(`🔍 [TEXTO] Pedido ID obtenido de sesión (clientPhone): ${pedidoId || 'NO'}`);
                }
              }
              
              // Si aún no se encuentra, buscar en todas las sesiones activas que tengan pedidos
              if (!pedidoId) {
                try {
                  const db = require('./db');
                  // Buscar pedidos activos en TODAS las sesiones (sin filtrar por phoneNumber)
                  const activeSessions = await db.all(
                    `SELECT phone_number, current_order FROM sessions 
                     WHERE current_order LIKE '%pedido_id%'`
                  );
                  
                  logger.info(`🔍 [TEXTO] Buscando en ${activeSessions.length} sesiones con pedidos activos`);
                  
                  for (const sessionRow of activeSessions) {
                    try {
                      const sessionOrder = JSON.parse(sessionRow.current_order || '{}');
                      if (sessionOrder.pedido_id) {
                        // Verificar si el pedido existe y está en estado EN_PROCESO
                        const kardexApi = require('./kardexApi');
                        const pedido = await kardexApi.getPedidoEnProceso(sessionOrder.pedido_id);
                        
                        if (pedido && pedido.estado === 'EN_PROCESO') {
                          // Verificar si el pedido pertenece al cliente autenticado (por teléfono o cliente_id)
                          const pedidoClienteId = pedido.cliente_id;
                          const clienteIdAutenticado = verifyResult.cliente?.id || verifyResult.user?.id;
                          
                          // Si el pedido no tiene cliente_id asignado o coincide con el cliente autenticado, usarlo
                          if (!pedidoClienteId || pedidoClienteId === clienteIdAutenticado) {
                            pedidoId = sessionOrder.pedido_id;
                            logger.info(`🔍 [TEXTO] Pedido ID encontrado en sesión alternativa: ${pedidoId} (cliente_id: ${pedidoClienteId || 'NO ASIGNADO'})`);
                            break;
                          }
                        }
                      }
                    } catch (e) {
                      // Ignorar errores de parsing
                    }
                  }
                  
                  // Si aún no se encuentra, buscar directamente en la base de datos de pedidos
                  if (!pedidoId) {
                    try {
                      const clienteIdAutenticado = verifyResult.cliente?.id || verifyResult.user?.id;
                      if (clienteIdAutenticado) {
                        logger.info(`🔍 [TEXTO] Buscando pedidos activos directamente en BD para cliente_id: ${clienteIdAutenticado}`);
                        const kardexDb = require('./kardexDb');
                        if (kardexDb.isConnected()) {
                          const pool = kardexDb.getPool();
                          const [pedidos] = await pool.execute(
                            `SELECT id, numero_pedido, cliente_id, estado FROM pedidos 
                             WHERE estado = 'EN_PROCESO' 
                             AND (cliente_id = ? OR cliente_id IS NULL)
                             ORDER BY id DESC LIMIT 1`,
                            [clienteIdAutenticado]
                          );
                          
                          if (pedidos && pedidos.length > 0) {
                            pedidoId = pedidos[0].id;
                            logger.info(`🔍 [TEXTO] Pedido activo encontrado directamente en BD: ${pedidoId}`);
                          }
                        }
                      }
                    } catch (bdError) {
                      logger.error('Error al buscar pedido directamente en BD:', bdError);
                    }
                  }
                } catch (dbError) {
                  logger.error('Error al buscar pedido en sesiones alternativas:', dbError);
                }
              }
            }
            
            // Actualizar estado con autenticación, preservando datos del pedido
            const newStateObj = {
              _authenticated: true,
              _client_id: verifyResult.cliente?.id || verifyResult.user?.id,
              _client_name: verifyResult.cliente?.nombre || verifyResult.user?.nombre_completo,
              _user_token: verifyResult.token,
              // Preservar datos del pedido si existían
              pedido_id: pedidoId,
              _pedido_id: pedidoId
            };
            
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, newStateObj);
            
            // Si había un pedido pendiente de confirmación O si se encontró un pedido activo, mostrar bienvenida con pedido
            if ((hadPendingConfirm || pedidoId) && pedidoId) {
              logger.info(`📦 [TEXTO] Usuario autenticado con pedido pendiente (ID: ${pedidoId}), mostrando información del pedido...`);
              
              try {
                // Obtener detalles del pedido
                const kardexApi = require('./kardexApi');
                const pedido = await kardexApi.getPedidoEnProceso(pedidoId);
                
                if (pedido) {
                  // Construir mensaje con información del pedido
                  let mensajePedido = `✅ *¡Bienvenido *${verifyResult.cliente?.nombre || verifyResult.user?.nombre_completo || 'Cliente'}*!* ✅\n\n`;
                  mensajePedido += `🛒 *Tu pedido se confirmará después del pago*\n\n`;
                  
                  // Agregar información del pedido
                  if (pedido.numero_pedido) {
                    mensajePedido += `📦 *Pedido:* ${pedido.numero_pedido}\n\n`;
                  }
                  
                  // Agregar productos del pedido
                  if (pedido.detalles && pedido.detalles.length > 0) {
                    mensajePedido += `*Productos:*\n`;
                    pedido.detalles.forEach((detalle, index) => {
                      const productoNombre = detalle.producto?.nombre || detalle.nombre_producto || 'Producto';
                      const cantidad = Number(detalle.cantidad) || 1;
                      const precio = Number(detalle.precio_unitario || detalle.precio || 0);
                      const subtotal = cantidad * precio;
                      mensajePedido += `${index + 1}. *${productoNombre}*\n`;
                      mensajePedido += `   ${cantidad} x S/. ${precio.toFixed(2)} = S/. ${subtotal.toFixed(2)}\n\n`;
                    });
                  }
                  
                  // Agregar total
                  const total = Number(pedido.total || pedido.monto_total || 0);
                  mensajePedido += `💰 *Total: S/. ${total.toFixed(2)}*\n\n`;
                  
                  // Pedir método de pago
                  mensajePedido += `💳 *Por favor, selecciona tu método de pago:*\n\n`;
                  mensajePedido += `• *TRANSFERENCIA* - Transferencia bancaria\n`;
                  mensajePedido += `• *EFECTIVO* - Pago en efectivo\n`;
                  mensajePedido += `• *YAPE* - Pago por Yape\n`;
                  mensajePedido += `• *PLIN* - Pago por Plin\n\n`;
                  mensajePedido += `Responde con el nombre del método de pago que deseas usar.`;
                  
                  // Actualizar estado para esperar método de pago
                  await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PAYMENT_METHOD, {
                    ...newStateObj,
                    _awaiting_payment_method: true
                  });
                  
                  await this.sendMessage(jidToUse, mensajePedido);
                  return;
                } else {
                  logger.warn(`⚠️ [TEXTO] No se pudo obtener detalles del pedido ${pedidoId}`);
                }
              } catch (pedidoError) {
                logger.error(`❌ [TEXTO] Error al obtener detalles del pedido:`, pedidoError);
              }
            }
            
            // Si no había pedido pendiente, mostrar mensaje de bienvenida normal
            await this.sendMessage(jidToUse,
              `✅ *¡Bienvenido *${verifyResult.cliente?.nombre || verifyResult.user?.nombre_completo || 'Cliente'}*!* ✅\n\n` +
              `🎯 *¿Qué deseas hacer hoy?*\n\n` +
              `🛍️ Ver catálogo: escribe *CATALOGO*\n` +
              `🛒 Hacer pedido: escribe tu pedido\n` +
              `📊 Ver mis pedidos: escribe *MIS PEDIDOS*\n` +
              `❓ Ayuda: escribe *AYUDA*`
            );
            return;
          } else {
            logger.warn(`🔐 [TEXTO] Contraseña incorrecta para cliente: ${clientPhone}, contraseña intentada: "${password}", mensaje: ${verifyResult?.message || 'Sin mensaje'}`);
            await this.sendMessage(jidToUse,
              `❌ Contraseña incorrecta.\n\n` +
              `💡 La contraseña que intentaste fue: *${password}*\n\n` +
              `Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
              `O escribe *CANCELAR* para volver al inicio.`
            );
            return;
          }
        } catch (verifyError) {
          logger.error(`🔐 [TEXTO] Error al verificar contraseña:`, verifyError);
          await this.sendMessage(jidToUse,
            `❌ Error al verificar tu contraseña. Por favor, intenta de nuevo.\n\n` +
            `Si el problema persiste, escribe *"olvidé mi contraseña"* para recuperar tu cuenta.`
          );
          return;
        }
      }
      
      // FLUJO 2.5: Si está esperando código SMS de verificación
      if (currentState === sessionManager.STATES.AWAITING_SMS_CODE) {
        const textLower = text.toLowerCase().trim();
        
        // Si escribe CANCELAR, volver al inicio
        if (textLower === 'cancelar' || textLower === 'cancel') {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            ...stateObj,
            _sms_code: undefined,
            _sms_code_expires: undefined,
            _sms_attempts: undefined
          });
          await this.sendMessage(jidToUse, '❌ Verificación cancelada. Escribe *HOLA* para comenzar de nuevo.');
          return;
        }
        
        // Extraer código numérico del mensaje
        const codeMatch = text.match(/\d{6}/);
        const enteredCode = codeMatch ? codeMatch[0] : text.trim().replace(/[^0-9]/g, '');
        
        if (enteredCode.length !== 6) {
          const attempts = (stateObj._sms_attempts || 0) + 1;
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
            ...stateObj,
            _sms_attempts: attempts
          });
          
          if (attempts >= 3) {
            await this.sendMessage(jidToUse,
              `❌ Has excedido el número de intentos.\n\n` +
              `Por favor, escribe *"olvidé mi contraseña"* nuevamente para recibir un nuevo código, o escribe *CANCELAR* para volver al inicio.`
            );
            return;
          }
          
          await this.sendMessage(jidToUse,
            `❌ Código inválido. Por favor, ingresa el código de 6 dígitos que recibiste por SMS.\n\n` +
            `Ejemplo: *123456*\n\n` +
            `⏰ Recuerda que el código expira en 10 minutos.\n` +
            `❌ Escribe *CANCELAR* si no recibiste el código.`
          );
          return;
        }
        
        // Verificar código
        const storedCode = stateObj._sms_code;
        const codeExpires = stateObj._sms_code_expires || 0;
        const attempts = (stateObj._sms_attempts || 0) + 1;
        
        // Verificar si el código expiró
        if (Date.now() > codeExpires) {
          await this.sendMessage(jidToUse,
            `❌ El código de verificación ha expirado.\n\n` +
            `Por favor, escribe *"olvidé mi contraseña"* nuevamente para recibir un nuevo código.`
          );
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            ...stateObj,
            _sms_code: undefined,
            _sms_code_expires: undefined,
            _sms_attempts: undefined
          });
          return;
        }
        
        // Verificar si el código es correcto
        if (enteredCode === storedCode) {
          // Código correcto, autenticar usuario
          const clientPhone = stateObj._client_phone || phoneNumber;
          const clientName = stateObj._client_name || 'Usuario';
          
          // Obtener cliente completo para autenticación
          let cliente = null;
          if (kardexDb.isConnected()) {
            cliente = await kardexDb.buscarClientePorTelefono(clientPhone);
          }
          if (!cliente) {
            cliente = await kardexApi.getClientByPhone(clientPhone);
          }
          
          if (cliente && cliente.nombre) {
            // Autenticar sin contraseña (verificado por SMS)
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
              _authenticated: true,
              _client_id: cliente.id,
              _client_name: cliente.nombre,
              _sms_verified: true, // Marcar como verificado por SMS
              _sms_code: undefined,
              _sms_code_expires: undefined,
              _sms_attempts: undefined
            });
            
            await this.sendMessage(jidToUse,
              `✅ *¡Verificación exitosa!* ✅\n\n` +
              `👋 *¡Bienvenido *${cliente.nombre}*!* 👋\n\n` +
              `🎯 *¿Qué deseas hacer hoy?*\n\n` +
              `🛍️ Ver catálogo: escribe *CATALOGO*\n` +
              `🛒 Hacer pedido: escribe tu pedido\n` +
              `📊 Ver mis pedidos: escribe *MIS PEDIDOS*\n` +
              `❓ Ayuda: escribe *AYUDA*\n\n` +
              `💡 *Recuerda:* Tu verificación es válida solo para esta sesión.`
            );
          } else {
            await this.sendMessage(jidToUse,
              `❌ Error: No se pudo autenticar tu cuenta. Por favor, contacta con soporte.`
            );
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
          }
          return;
        } else {
          // Código incorrecto
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
            ...stateObj,
            _sms_attempts: attempts
          });
          
          if (attempts >= 3) {
            await this.sendMessage(jidToUse,
              `❌ Has excedido el número de intentos (3 intentos máximos).\n\n` +
              `Por favor, escribe *"olvidé mi contraseña"* nuevamente para recibir un nuevo código, o escribe *CANCELAR* para volver al inicio.`
            );
            return;
          }
          
          await this.sendMessage(jidToUse,
            `❌ Código incorrecto. Te quedan *${3 - attempts}* intentos.\n\n` +
            `Por favor, verifica el código que recibiste por SMS e ingrésalo nuevamente.\n\n` +
            `❌ Escribe *CANCELAR* si no recibiste el código.`
          );
          return;
        }
      }
      
      // FLUJO 3: Si está esperando datos de registro
      if (currentState === sessionManager.STATES.AWAITING_REG_NAME) {
        const nombre = text.trim();
        if (nombre.length < 2) {
          await this.sendMessage(jidToUse, '❌ El nombre debe tener al menos 2 caracteres. Por favor ingresa tu nombre completo.');
          return;
        }
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_REG_DNI, {
          ...stateObj,
          _reg_nombre: nombre
        });
        await this.sendMessage(jidToUse, `✅ Nombre guardado: *${nombre}*\n\nAhora ingresa tu *DNI* (8 dígitos):`);
        return;
      }
      
      if (currentState === sessionManager.STATES.AWAITING_REG_DNI) {
        const dni = text.trim().replace(/[^0-9]/g, '');
        if (dni.length !== 8 || !/^[0-9]{8}$/.test(dni)) {
          await this.sendMessage(jidToUse, '❌ El DNI debe tener 8 dígitos. Por favor ingresa tu DNI correctamente:');
          return;
        }
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_REG_EMAIL, {
          ...stateObj,
          _reg_dni: dni
        });
        await this.sendMessage(jidToUse, `✅ DNI guardado: *${dni}*\n\nAhora ingresa tu *correo electrónico*:`);
        return;
      }
      
      if (currentState === sessionManager.STATES.AWAITING_REG_EMAIL) {
        const email = text.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await this.sendMessage(jidToUse, '❌ El correo electrónico no es válido. Por favor ingresa un correo válido (ejemplo: juan@email.com):');
          return;
        }
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_REG_PASSWORD, {
          ...stateObj,
          _reg_email: email
        });
        await this.sendMessage(jidToUse, `✅ Correo guardado: *${email}*\n\nAhora ingresa tu *contraseña* (mínimo 6 caracteres):`);
        return;
      }
      
      if (currentState === sessionManager.STATES.AWAITING_REG_PASSWORD) {
        const password = text.trim();
        if (password.length < 6) {
          await this.sendMessage(jidToUse, '❌ La contraseña debe tener al menos 6 caracteres. Por favor ingresa una contraseña más segura:');
          return;
        }
        
        // Registrar cliente completo
        const registerData = {
          nombre: stateObj._reg_nombre,
          email: stateObj._reg_email,
          telefono: stateObj._input_phone || phoneNumber,
          numero_documento: stateObj._reg_dni,
          contrasena: password
        };
        
        const registerResult = await kardexApi.registerClientFull(registerData);
        
        if (registerResult.success) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _authenticated: true,
            _client_id: registerResult.cliente.id,
            _client_name: registerResult.cliente.nombre || registerData.nombre,
            _user_token: registerResult.token
          });
          
          await this.sendMessage(jidToUse,
            `✅ *¡Registro exitoso!* ✅\n\n` +
            `👤 Nombre: *${registerData.nombre}*\n` +
            `📧 Email: *${registerData.email}*\n` +
            `🆔 DNI: *${registerData.numero_documento}*\n\n` +
            `🎯 *¿Qué deseas hacer ahora?*\n\n` +
            `🛍️ Ver catálogo: escribe *CATALOGO*\n` +
            `🛒 Hacer pedido: escribe tu pedido\n` +
            `📊 Ver mis pedidos: escribe *MIS PEDIDOS*`
          );
          return;
        } else {
          await this.sendMessage(jidToUse,
            `❌ Error al registrar: ${registerResult.message || 'Error desconocido'}\n\n` +
            `Por favor intenta de nuevo escribiendo *REGISTRAR* o contacta con soporte.`
          );
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
          return;
        }
      }
      
      // FLUJO 4: Si está esperando datos para pedido temporal
      if (currentState === sessionManager.STATES.AWAITING_TEMP_NAME) {
        const nombre = text.trim();
        if (nombre.length < 2) {
          await this.sendMessage(jidToUse, '❌ El nombre debe tener al menos 2 caracteres. Por favor ingresa tu nombre completo:');
          return;
        }
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_TEMP_DNI, {
          ...stateObj,
          _temp_nombre: nombre
        });
        await this.sendMessage(jidToUse, `✅ Nombre guardado: *${nombre}*\n\nAhora ingresa tu *DNI* (8 dígitos) para el pedido:`);
        return;
      }
      
      if (currentState === sessionManager.STATES.AWAITING_TEMP_DNI) {
        const dni = text.trim().replace(/[^0-9]/g, '');
        if (dni.length !== 8 || !/^[0-9]{8}$/.test(dni)) {
          await this.sendMessage(jidToUse, '❌ El DNI debe tener 8 dígitos. Por favor ingresa tu DNI correctamente:');
          return;
        }
        
        // Guardar datos temporales y permitir hacer pedido
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
          ...stateObj,
          _temp_dni: dni,
          _temp_phone: stateObj._input_phone || phoneNumber
        });
        
        await this.sendMessage(jidToUse,
          `✅ Datos guardados para el pedido:\n` +
          `👤 Nombre: *${stateObj._temp_nombre}*\n` +
          `🆔 DNI: *${dni}*\n\n` +
          `🛒 *Ahora puedes hacer tu pedido.*\n` +
          `Escribe lo que necesitas o escribe *CATALOGO* para ver productos disponibles.`
        );
        return;
      }
      
      // FLUJO 5: Comandos especiales al inicio (ya se normalizó textLower arriba)
      
      // Si escribe REGISTRAR, iniciar proceso de registro
      if (textLower === 'registrar' || textLower.includes('registrar')) {
        // Si tiene número ingresado, verificar si ya está registrado
        const phoneToCheck = stateObj._input_phone || stateObj._client_phone || null;
        
        if (phoneToCheck) {
          // Verificar si el número ya está registrado
          logger.info(`🔍 Verificando si el número ${phoneToCheck} ya está registrado...`);
          
          let clienteExistente = null;
          if (kardexDb.isConnected()) {
            clienteExistente = await kardexDb.buscarClientePorTelefono(phoneToCheck);
          }
          if (!clienteExistente) {
            clienteExistente = await kardexApi.getClientByPhone(phoneToCheck);
          }
          
          if (clienteExistente && clienteExistente.nombre) {
            // El número ya está registrado
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
              _input_phone: phoneToCheck
            });
            await this.sendMessage(jidToUse,
              `ℹ️ *Ya tienes una cuenta registrada* ℹ️\n\n` +
              `El número *${PhoneNormalizer.format(phoneToCheck)}* ya está asociado a la cuenta:\n` +
              `👤 *${clienteExistente.nombre}*\n\n` +
              `🔐 *Para acceder a tu cuenta, escribe tu contraseña:*\n\n` +
              `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
              `Si no recuerdas tu contraseña o no tienes una, escribe *AYUDA* para más opciones.`
            );
            
            // Cambiar estado a esperando contraseña
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
              _client_id: clienteExistente.id,
              _client_phone: phoneToCheck,
              _client_name: clienteExistente.nombre
            });
            return;
          }
        }
        
        // Si no tiene número ingresado o el número no está registrado, continuar con registro
        if (!stateObj._input_phone && !phoneToCheck) {
          // Pedir número primero si no lo tiene
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PHONE, {});
          await this.sendMessage(jidToUse,
            `📝 *REGISTRO DE NUEVO CLIENTE*\n\n` +
            `Por favor, ingresa tu *número de teléfono* (9 dígitos):`
          );
          return;
        }
        
        // Número no registrado, continuar con el proceso de registro
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_REG_NAME, {
          ...stateObj,
          _input_phone: phoneToCheck || stateObj._input_phone || phoneNumber
        });
        
        await this.sendMessage(jidToUse,
          `📝 *REGISTRO DE NUEVO CLIENTE*\n\n` +
          `Por favor ingresa tu información:\n\n` +
          `1️⃣ Ingresa tu *nombre completo*:`
        );
        return;
      }
      
      // Si escribe PEDIDO, iniciar proceso de pedido temporal
      if (textLower === 'pedido' || textLower.includes('hacer pedido') || textLower.includes('quiero hacer pedido')) {
        if (!stateObj._input_phone) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PHONE, {});
          await this.sendMessage(jidToUse,
            `🛒 *PEDIDO SIN REGISTRO*\n\n` +
            `Para hacer un pedido necesitamos algunos datos:\n\n` +
            `Por favor, ingresa tu *número de teléfono* (9 dígitos):`
          );
          return;
        }
        
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_TEMP_NAME, {
          _input_phone: stateObj._input_phone || phoneNumber
        });
        await this.sendMessage(jidToUse,
          `🛒 *PEDIDO SIN REGISTRO*\n\n` +
          `Ingresa tu *nombre completo* para el pedido:`
        );
        return;
      }
      
      // FLUJO 0 ya se procesó arriba (antes de la detección universal de cancelación)
      
      // FLUJO 6: Si no está autenticado y no está en ningún flujo, verificar si es un número de teléfono
      if (currentState === sessionManager.STATES.IDLE && !stateObj._authenticated && !stateObj._temp_nombre) {
        // Detectar si el mensaje es un número de teléfono (9 dígitos o con código de país)
        // Limpiar transcripción de voz: quitar comas, espacios, puntos y guiones
        const cleanedText = text.replace(/[,.\s-]/g, '');
        const phoneInput = PhoneNormalizer.normalize(cleanedText);
        if (PhoneNormalizer.isValidPeruvianPhone(phoneInput)) {
          // Es un número de teléfono válido, procesarlo como entrada de teléfono
          logger.info(`📞 Número detectado automáticamente: ${phoneInput}`);
          
          // Actualizar sesión con el número ingresado
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: phoneInput
          });
          
          // Buscar cliente con el número ingresado
          let cliente = null;
          if (kardexDb.isConnected()) {
            cliente = await kardexDb.buscarClientePorTelefono(phoneInput);
          }
          if (!cliente) {
            cliente = await kardexApi.getClientByPhone(phoneInput);
          }
          
          // Si el cliente existe y tiene nombre, pedir contraseña
          if (cliente && cliente.nombre) {
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
              _client_id: cliente.id,
              _client_phone: phoneInput,
              _client_name: cliente.nombre
            });
            await this.sendMessage(jidToUse,
              `👋 ¡Hola *${cliente.nombre}*! 👋\n\n` +
              `Para acceder a tu cuenta y ver tus pedidos, por favor *escribe* tu *contraseña* de la página web.\n\n` +
              `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
              `Si no tienes contraseña, puedes registrarte escribiendo *REGISTRAR*`
            );
            return;
          } else {
            // Cliente no encontrado, ofrecer registro
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
              _input_phone: phoneInput
            });
            await this.sendMessage(jidToUse,
              `👋 ¡Hola! 👋\n\n` +
              `No encontré una cuenta registrada con el número *${PhoneNormalizer.format(phoneInput)}*.\n\n` +
              `📋 *¿Qué deseas hacer?*\n\n` +
              `1️⃣ *REGISTRAR* - Crear una cuenta nueva (email, contraseña, nombre, DNI)\n` +
              `2️⃣ *PEDIDO* - Hacer un pedido sin registro (solo nombre y DNI)\n\n` +
              `Escribe *REGISTRAR* o *PEDIDO* según lo que prefieras.`
            );
            return;
          }
        }
        
        // Para números nuevos: primero intentar usar el número del remitente para buscar cliente
        if (!stateObj._input_phone) {
          // Intentar buscar cliente usando el número del remitente directamente
          const remitenteNormalized = PhoneNormalizer.normalize(phoneNumber);
          logger.info(`🔍 Buscando cliente con número del remitente: ${remitenteNormalized}`);
          
          let clienteRemitente = null;
          if (kardexDb.isConnected()) {
            clienteRemitente = await kardexDb.buscarClientePorTelefono(remitenteNormalized);
          }
          if (!clienteRemitente) {
            clienteRemitente = await kardexApi.getClientByPhone(remitenteNormalized);
          }
          
          // Si encontramos un cliente con ese número, guardarlo en sesión
          if (clienteRemitente && clienteRemitente.nombre) {
            logger.info(`✅ Cliente encontrado con número del remitente: ${clienteRemitente.nombre}`);
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
              _input_phone: remitenteNormalized,
              _client_id: clienteRemitente.id,
              _client_phone: remitenteNormalized,
              _client_name: clienteRemitente.nombre
            });
            await this.sendMessage(jidToUse,
              `👋 ¡Hola *${clienteRemitente.nombre}*! 👋\n\n` +
              `Te reconocí por tu número de WhatsApp.\n\n` +
              `Para acceder a tu cuenta y ver tus pedidos, por favor *escribe* tu *contraseña* de la página web.\n\n` +
              `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
              `🔐 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
              `💡 O si quieres hacer un pedido sin ingresar, escribe *PEDIDO*`
            );
            return;
          } else {
            // No se encontró cliente, guardar el número del remitente y continuar
            logger.info(`⚠️ No se encontró cliente con número del remitente: ${remitenteNormalized}`);
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
              _input_phone: remitenteNormalized
            });
            // Continuar procesando el mensaje
          }
        }
        
        // SIEMPRE intentar procesar con NLU primero (más inteligente)
        const nlu = require('./nlu');
        const conversationHistory = await sessionManager.getConversationHistory(phoneNumber, 5);
        
        logger.info(`🤖 Procesando mensaje con NLU para número nuevo: ${text.substring(0, 50)}...`);
        
        const nluResult = await nlu.processMessage(text, { 
          ...session.state, 
          phoneNumber,
          _input_phone: stateObj._input_phone || PhoneNormalizer.normalize(phoneNumber)
        }, conversationHistory, false);
        
        // Si NLU detectó una intención válida, procesarla
        if (nluResult?.response?.action) {
          logger.info(`✅ NLU detectó acción: ${nluResult.response.action}`);
          await this.handleAction(nluResult.response.action, nluResult.response, jidToUse, {
            ...session.state,
            phoneNumber,
            _input_phone: stateObj._input_phone || PhoneNormalizer.normalize(phoneNumber),
            _temp_phone: stateObj._input_phone || PhoneNormalizer.normalize(phoneNumber)
          });
          return;
        }
        
        // NO preguntar si es cliente registrado si hay un pedido en proceso
        // El flujo correcto es: hacer pedido → mostrar factura/precio → pedir confirmación → luego autenticación
        const hasActiveOrder = await sessionManager.getActiveOrderId(phoneNumber);
        const isInOrderState = currentState === sessionManager.STATES.PEDIDO_EN_PROCESO || 
                               currentState === sessionManager.STATES.AWAITING_CONFIRMATION ||
                               currentState === sessionManager.STATES.ORDER_PENDING;
        
        if (!hasActiveOrder && !isInOrderState) {
          // Solo preguntar si NO hay pedido en proceso
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION, {});
          await this.sendMessage(jidToUse,
            `👋 *¡Hola! ¡Bienvenido a KARDEX!* 👋\n\n` +
            `❓ *¿Eres cliente registrado?*\n\n` +
            `Responde:\n` +
            `• *SÍ* si ya tienes una cuenta registrada\n` +
            `• *NO* si no tienes cuenta\n\n` +
            `💡 Esto nos ayudará a darte el mejor servicio.`
          );
          return;
        }
        // Si hay pedido en proceso, continuar con el flujo normal (no preguntar autenticación todavía)
      }
      
      // FLUJO 6.5: Si está esperando confirmación de cancelación
      if (currentState === sessionManager.STATES.AWAITING_CANCEL_CONFIRMATION) {
        const textLower = text.toLowerCase().trim();
        const confirmKeywords = ['si', 'sí', 'confirmo', 'confirmar', 'acepto', 'aceptar', 'ok', 'okay', 'yes'];
        const cancelKeywords = ['no', 'cancelar', 'cancel', 'volver'];
        
        if (confirmKeywords.some(keyword => textLower === keyword || textLower.includes(keyword))) {
          // Confirmar cancelación, el método cancelOrder ya maneja esto
          await orderHandler.cancelOrder(phoneNumber, this, {
            ...session.state,
            phoneNumber,
            user_token: stateObj._user_token || null,
            _user_token: stateObj._user_token || null
          });
          return;
        } else if (cancelKeywords.some(keyword => textLower === keyword || textLower.includes(keyword))) {
          // Cancelar la operación de cancelación
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            ...stateObj,
            _pedido_a_cancelar: undefined
          });
          await this.sendMessage(jidToUse,
            '✅ Operación cancelada.\n\n' +
            'Tu pedido sigue activo. ¿En qué más puedo ayudarte?'
          );
          return;
        } else {
          // Respuesta no clara, pedir confirmación de nuevo
          await this.sendMessage(jidToUse,
            '⚠️ *Por favor, confirma tu respuesta*\n\n' +
            'Escribe *"SI"* o *"CONFIRMO"* para cancelar el pedido.\n' +
            'O escribe *"NO"* o *"CANCELAR"* para volver.'
          );
          return;
        }
      }
      
      // FLUJO 6.75: Si está esperando actualización de perfil
      if (currentState === sessionManager.STATES.AWAITING_UPDATE_TELEFONO ||
          currentState === sessionManager.STATES.AWAITING_UPDATE_DIRECCION ||
          currentState === sessionManager.STATES.AWAITING_UPDATE_EMAIL) {
        const field = stateObj._updating_field;
        if (field) {
          await orderHandler.updateProfileField(phoneNumber, field, this, {
            ...session.state,
            phoneNumber,
            user_token: stateObj._user_token || null,
            _user_token: stateObj._user_token || null,
            cliente: { id: stateObj._client_id },
            _client_id: stateObj._client_id
          }, text);
        }
        return;
      }
      
      // FLUJO 7: Usuario autenticado o con datos temporales, procesar mensaje normal
      let cliente = null;
      let nombreCliente = 'Cliente';
      
      // Si está autenticado, obtener cliente
      if (stateObj._authenticated && stateObj._client_id) {
        if (kardexDb.isConnected()) {
          try {
            const [clientes] = await kardexDb.pool.execute('SELECT * FROM clientes WHERE id = ?', [stateObj._client_id]);
            if (clientes && clientes.length > 0) {
              cliente = clientes[0];
              nombreCliente = cliente.nombre || stateObj._client_name || 'Cliente';
            }
          } catch (error) {
            logger.error('Error al obtener cliente autenticado', error);
          }
        }
        
        // Si no se encontró en BD, usar datos guardados
        if (!cliente && stateObj._client_name) {
          nombreCliente = stateObj._client_name;
        }
      } else if (stateObj._temp_nombre && stateObj._temp_dni) {
        // Usuario temporal con datos para pedido
        nombreCliente = stateObj._temp_nombre;
        cliente = {
          id: null,
          nombre: stateObj._temp_nombre,
          numero_documento: stateObj._temp_dni,
          telefono: stateObj._temp_phone || phoneNumber,
          es_temporal: true
        };
      }

      // Guardar mensaje del usuario en historial
      await sessionManager.saveMessage(phoneNumber, 'text', text, false);

      // Obtener historial de conversación reciente (últimos 10 mensajes)
      const conversationHistory = await sessionManager.getConversationHistory(phoneNumber, 10);

      // Procesar con NLU (mensaje de texto, no voz)
      // Pasar phoneNumber y nombreCliente en sessionState para que basicBot pueda usarlo
      const sessionStateWithPhone = { 
        ...session.state, 
        phoneNumber,
        nombreCliente,
        cliente: cliente || null,
        remoteJid: jidToUse, // Guardar JID original para usar en respuestas
        authenticated: stateObj._authenticated || false,
        user_token: stateObj._user_token || null,
        temp_data: stateObj._temp_nombre ? {
          nombre: stateObj._temp_nombre,
          dni: stateObj._temp_dni,
          phone: stateObj._temp_phone
        } : null
      };
      
      let nluResult = null;
      let nluError = null;
      
      // Procesar con NLU con timeout y manejo de errores robusto
      try {
        logger.info(`📝 [TEXTO] Llamando a NLU para procesar mensaje...`);
        const nluPromise = nlu.processMessage(text, sessionStateWithPhone, conversationHistory, false);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('NLU timeout después de 30 segundos')), 30000)
        );
        
        nluResult = await Promise.race([nluPromise, timeoutPromise]);
        logger.info(`🔍 [TEXTO] NLU detectó: intent=${nluResult.intent}, tiene response=${!!nluResult.response}`);
      } catch (nluErr) {
        nluError = nluErr;
        logger.error(`❌ [TEXTO] Error en NLU:`, {
          error: nluErr.message,
          stack: nluErr.stack?.substring(0, 500)
        });
        // Crear resultado de fallback
        nluResult = {
          intent: 'error',
          response: {
            message: '😅 Lo siento, hubo un problema al procesar tu mensaje.\n\n' +
              '💡 Por favor intenta:\n' +
              '• Reformular tu mensaje\n' +
              '• Escribir *AYUDA* para ver opciones\n' +
              '• Intentar de nuevo en unos momentos'
          }
        };
      }

      // Manejar respuesta del NLU - SIEMPRE enviar una respuesta
      let responseSent = false;
      
      try {
        if (nluResult && nluResult.response) {
          // Si tiene acción, manejarla (pasar jidToUse en lugar de phoneNumber)
          if (nluResult.response.action) {
            logger.info(`📝 [TEXTO] Ejecutando acción: ${nluResult.response.action}`);
            await this.handleAction(jidToUse, nluResult.response.action, nluResult.response, sessionStateWithPhone);
            responseSent = true;
          } 
          // Si tiene mensaje, enviarlo
          else if (nluResult.response.message) {
            logger.info(`📝 [TEXTO] Enviando mensaje del NLU`);
            await this.sendMessage(jidToUse, nluResult.response.message);
            // Guardar respuesta del bot en historial
            await sessionManager.saveMessage(phoneNumber, 'text', nluResult.response.message, true);
            responseSent = true;
          }
          // Si tiene productos (catálogo), enviar mensaje formateado
          else if (nluResult.response.productos) {
            logger.info(`📝 [TEXTO] Enviando catálogo de productos`);
            await this.sendMessage(jidToUse, nluResult.response.message || 'Catálogo de productos');
            await sessionManager.saveMessage(phoneNumber, 'text', nluResult.response.message || 'Catálogo de productos', true);
            responseSent = true;
          }
        }
        
        // Si no se envió respuesta, enviar opciones útiles
        if (!responseSent) {
          logger.warn('⚠️ [TEXTO] NLU no devolvió respuesta válida, enviando opciones útiles');
          await this.sendMessage(jidToUse, 
            `👋 *¡Hola!* 👋\n\n` +
            `📋 *¿En qué puedo ayudarte?*\n\n` +
            `🛍️ *Ver productos:* Escribe *CATALOGO*\n` +
            `🛒 *Hacer pedido:* Escribe lo que necesitas\n` +
            `💰 *Consultar precio:* "¿Cuánto cuesta X?"\n` +
            `📊 *Ver pedido:* Escribe *ESTADO*\n` +
            `❓ *Ayuda:* Escribe *AYUDA*\n\n` +
            `💡 También puedes enviarme una nota de voz.`
          );
          responseSent = true;
        }
      } catch (sendError) {
        logger.error(`❌ [TEXTO] Error al enviar respuesta del NLU:`, sendError);
        // Último intento de enviar mensaje
        try {
          await this.sendMessage(jidToUse, 
            `😅 Lo siento, hubo un problema. Por favor intenta de nuevo o escribe *AYUDA*.`
          );
        } catch (finalError) {
          logger.error(`❌ [TEXTO] Error crítico: No se pudo enviar mensaje final`, finalError);
        }
      }
      
      logger.info(`📝 [TEXTO] Procesamiento de mensaje de texto completado`);

    } catch (error) {
      logger.error('═══════════════════════════════════════════════════════════');
      logger.error('❌ [TEXTO] ERROR CRÍTICO al procesar mensaje de texto');
      logger.error(`❌ [TEXTO] Error: ${error.message}`);
      logger.error(`❌ [TEXTO] Stack: ${error.stack?.substring(0, 1000)}`);
      logger.error(`❌ [TEXTO] Phone: ${phoneNumber}, JID: ${jidToUse}`);
      logger.error(`❌ [TEXTO] Texto: "${text.substring(0, 100)}"`);
      logger.error('═══════════════════════════════════════════════════════════');
      
      // SIEMPRE intentar enviar una respuesta, incluso en caso de error
      let responseSent = false;
      
      // Intentar recuperación inteligente con timeout
      try {
        logger.info(`📝 [TEXTO] Intentando recuperación inteligente...`);
        const intentDetector = require('./utils/intentDetector');
        const fallbackPromise = intentDetector.detectIntent(text, { state: 'idle' }, []);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout en recuperación')), 5000)
        );
        
        const fallbackIntent = await Promise.race([fallbackPromise, timeoutPromise]);
        
        logger.info(`📝 [TEXTO] Intención de fallback detectada: ${fallbackIntent.intent} (confianza: ${fallbackIntent.confidence})`);
        
        // Si se puede detectar la intención, responder apropiadamente
        if (fallbackIntent.intent !== 'unknown' && fallbackIntent.confidence > 0.5) {
          // Responder según la intención detectada
          if (fallbackIntent.intent === 'help') {
            await this.sendMessage(jidToUse, 
              `👋 *¡Hola! Parece que hubo un problema, pero puedo ayudarte.* 👋\n\n` +
              `📋 *Opciones disponibles:*\n\n` +
              `🛍️ *Ver productos:* Escribe *CATALOGO*\n` +
              `🛒 *Hacer pedido:* Escribe lo que necesitas\n` +
              `📝 *Registrarse:* Escribe *REGISTRAR*\n` +
              `❓ *Ayuda:* Escribe *AYUDA*\n\n` +
              `💡 Si el problema persiste, intenta enviar tu mensaje de nuevo.`
            );
            responseSent = true;
          } else if (fallbackIntent.intent === 'greeting') {
            await this.sendMessage(jidToUse,
              `👋 *¡Hola! ¡Bienvenido a KARDEX!* 👋\n\n` +
              `❓ *¿Eres cliente registrado?*\n\n` +
              `Responde:\n` +
              `• *SÍ* si ya tienes una cuenta registrada\n` +
              `• *NO* si no tienes cuenta`
            );
            responseSent = true;
          }
        }
      } catch (recoveryError) {
        logger.error(`❌ [TEXTO] Error en recuperación inteligente: ${recoveryError.message}`);
      }
      
      // Si no se envió respuesta, enviar mensaje genérico
      if (!responseSent) {
        try {
          logger.info(`📝 [TEXTO] Enviando mensaje de error genérico...`);
          await this.sendMessage(jidToUse, 
            `😅 Lo siento, hubo un error al procesar tu mensaje.\n\n` +
            `💡 Por favor intenta:\n` +
            `• Reformular tu mensaje\n` +
            `• Escribir *AYUDA* para ver opciones\n` +
            `• O enviar un mensaje de texto más claro\n\n` +
            `🔄 Si el problema persiste, intenta de nuevo en unos momentos.`
          );
          responseSent = true;
        } catch (sendError) {
          logger.error(`❌ [TEXTO] Error crítico: No se pudo enviar mensaje de error`, {
            error: sendError.message,
            stack: sendError.stack?.substring(0, 500)
          });
          
          // Último intento con mensaje muy simple
          try {
            await this.sendMessage(jidToUse, 
              `😅 Error. Escribe *AYUDA*.`
            );
          } catch (finalError) {
            logger.error(`❌ [TEXTO] ERROR CRÍTICO: No se pudo enviar ningún mensaje`, finalError);
          }
        }
      }
      
      logger.info(`📝 [TEXTO] Manejo de error completado, respuesta enviada: ${responseSent}`);
    }
  }

  /**
   * Manejar acciones del NLU
   * phoneNumberOrJid puede ser un JID completo o un número de teléfono
   */
  async handleAction(phoneNumberOrJid, action, actionData, sessionState) {
    // Extraer número de teléfono del sessionState si está disponible, de lo contrario del parámetro
    const phoneNumber = sessionState.phoneNumber || (phoneNumberOrJid.includes('@') ? phoneNumberOrJid.split('@')[0] : phoneNumberOrJid);
    
    switch (action) {
      case 'create_pending_order':
        await orderHandler.createPendingOrder(phoneNumber, actionData, this, sessionState);
        break;

      case 'add_products_to_order':
        await orderHandler.addProductsToOrder(phoneNumber, actionData, this, sessionState);
        break;

      case 'init_order':
        await orderHandler.initOrder(phoneNumber, this, sessionState);
        break;

      case 'confirm_order':
        await orderHandler.confirmOrder(phoneNumber, this, sessionState);
        break;

      case 'cancel_order':
        await orderHandler.cancelOrder(phoneNumber, this, sessionState);
        break;

      case 'payment_confirmed':
        await orderHandler.handlePaymentConfirmed(phoneNumber, this, sessionState);
        break;

      case 'check_status':
      case 'view_order':
        await orderHandler.viewOrder(phoneNumber, this, sessionState);
        break;

      case 'show_yape_payment':
        await orderHandler.showYapePayment(phoneNumber, actionData.orderData, this);
        break;

      case 'show_plin_payment':
        await orderHandler.showPlinPayment(phoneNumber, actionData.orderData, this);
        break;

      case 'remove_product':
        await orderHandler.removeProductFromOrder(phoneNumber, actionData.productName, this);
        break;

      case 'view_order_history':
        await orderHandler.viewOrderHistory(phoneNumber, this, sessionState);
        break;

      case 'view_invoice':
        await orderHandler.viewInvoices(phoneNumber, this, sessionState);
        break;

      case 'view_purchase_detail':
        await orderHandler.viewPurchaseDetail(phoneNumber, actionData?.pedidoId, this, sessionState);
        break;

      case 'list_order_items':
        await orderHandler.listOrderItems(phoneNumber, this);
        break;

      case 'update_product_quantity':
        await orderHandler.updateProductQuantity(phoneNumber, actionData?.productName, actionData?.newQuantity, this);
        break;

      case 'cancel_confirmed_order':
        await orderHandler.cancelConfirmedOrder(phoneNumber, actionData?.pedidoId, this, sessionState);
        break;

      case 'modify_profile':
        await orderHandler.modifyProfile(phoneNumber, this, sessionState);
        break;

      case 'update_profile_field':
        await orderHandler.updateProfileField(phoneNumber, actionData?.field, this, sessionState);
        break;

      case 'view_account_status':
        await orderHandler.viewAccountStatus(phoneNumber, this, sessionState);
        break;

      default:
        logger.warn(`Acción desconocida: ${action}`);
    }
  }

  /**
   * Procesar mensaje de voz (versión Baileys)
   */
  async processVoiceMessageBaileys(phoneNumber, audioMessage, remoteJid = null) {
    const jidToUse = remoteJid || (phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`);
    let audioPath = null;
    let transcription = undefined;
    
    // Log detallado al inicio
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('🎤 [VOZ] Iniciando procesamiento de mensaje de voz');
    logger.info(`🎤 [VOZ] Phone: ${phoneNumber}, JID: ${jidToUse}`);
    logger.info(`🎤 [VOZ] Timestamp: ${new Date().toISOString()}`);
    
    try {
      logger.info('🎤 [VOZ] Procesando mensaje de voz...');
      await this.sendMessage(jidToUse, '🎤 Procesando tu mensaje de voz...');

      // Descargar audio
      logger.info('📥 Descargando audio de WhatsApp...');
      
      let buffer;
      try {
        logger.info('Llamando a downloadMediaMessage con type="buffer"...');
        // Baileys downloadMediaMessage requiere especificar el tipo
        // Usamos la función directamente desde el módulo de Baileys
        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        
        // Crear el mensaje completo para downloadMediaMessage
        const fullMessage = {
          message: {
            audioMessage: audioMessage
          }
        };
        
        // Descargar como buffer directamente
        buffer = await downloadMediaMessage(fullMessage, 'buffer', {}, { sock: this.sock });
        
        if (!buffer || !Buffer.isBuffer(buffer)) {
          throw new Error('No se pudo obtener el buffer del audio');
        }
        
        if (buffer.length === 0) {
          throw new Error('El buffer del audio está vacío');
        }
        
        logger.info(`✅ Buffer creado: ${buffer.length} bytes`);
      } catch (downloadError) {
        logger.error('❌ Error al descargar audio de WhatsApp', {
          error: downloadError.message,
          stack: downloadError.stack
        });
        throw new Error(`Error al descargar audio: ${downloadError.message}`);
      }
      
      audioPath = path.join(__dirname, '..', 'temp', `audio_${Date.now()}.ogg`);
      await fs.mkdir(path.dirname(audioPath), { recursive: true });
      
      await fs.writeFile(audioPath, buffer);

      const fileSize = (buffer.length / 1024).toFixed(2);
      logger.info(`✅ Audio descargado: ${audioPath} (${fileSize} KB)`);

      // Verificar que el archivo existe y tiene contenido
      const stats = await fs.stat(audioPath);
      if (stats.size === 0) {
        throw new Error('El archivo de audio está vacío');
      }

      logger.debug(`📊 Tamaño del audio: ${stats.size} bytes`);

      // Transcribir con Whisper
      logger.info('🎙️ Iniciando transcripción...');
      let transcription;
      try {
        transcription = await whisperTranscriber.transcribe(audioPath);
        logger.info('✅ Transcripción completada');
      } catch (transcribeError) {
        logger.error('❌ Error en transcripción:', {
          error: transcribeError.message,
          stack: transcribeError.stack
        });
        // En lugar de lanzar error, enviar mensaje amigable y continuar
        await this.sendMessage(jidToUse,
          `😅 Lo siento, no pude procesar tu mensaje de voz en este momento.\n\n` +
          `💡 Por favor, intenta:\n` +
          `• Grabar el audio nuevamente\n` +
          `• Enviar un mensaje de texto\n` +
          `• Asegúrate de que el audio sea claro y no tenga mucho ruido\n\n` +
          `🔄 Si el problema persiste, escribe *HOLA* para comenzar de nuevo.`
        );
        // Limpiar archivo temporal antes de salir
        if (audioPath) {
          await fs.unlink(audioPath).catch(() => {});
        }
        return; // Salir sin procesar más
      }
      
      // Limpiar archivo temporal
      await fs.unlink(audioPath).catch(() => {});
      audioPath = null;

      if (!transcription || transcription.trim().length === 0) {
        logger.warn('⚠️ Transcripción vacía o inválida');
        await this.sendMessage(jidToUse,
          `😅 Lo siento, no pude entender tu mensaje de voz.\n\n` +
          `💡 Por favor, intenta:\n` +
          `• Grabar el audio nuevamente con más claridad\n` +
          `• Hablar más cerca del micrófono\n` +
          `• Enviar un mensaje de texto si es más fácil\n\n` +
          `🔄 Si el problema persiste, escribe *HOLA* para comenzar de nuevo.`
        );
        return; // Salir sin procesar más
      }

      logger.success(`🎤 Transcripción exitosa: "${transcription}"`);

      // Validar que la transcripción no esté vacía
      if (!transcription || transcription.trim().length === 0) {
        logger.warn('⚠️ Transcripción vacía, solicitando al usuario que repita');
        await this.sendMessage(jidToUse, 
          `😅 No pude entender tu mensaje de voz.\n\n` +
          `Por favor, intenta:\n` +
          `• Hablar más claro y cerca del micrófono\n` +
          `• Enviar un mensaje de texto en su lugar\n` +
          `• Escribir *AYUDA* para ver las opciones`
        );
        return;
      }

      // Usar el corrector de transcripciones robusto
      const transcriptionCorrector = require('./utils/transcriptionCorrector');
      
      // Aplicar correcciones exhaustivas a la transcripción
      let transcriptionCorregida = transcriptionCorrector.corregir(transcription);
      
      // Mostrar al usuario qué entendió el bot (con correcciones aplicadas)
      await this.sendMessage(jidToUse, `🎤 Entendí: "${transcriptionCorregida}"`);

      // Guardar transcripción corregida en historial
      await sessionManager.saveMessage(phoneNumber, 'voice', transcriptionCorregida, false);

      // Obtener sesión e historial
      let session = await sessionManager.getSession(phoneNumber);
      if (!session) {
        session = await sessionManager.createSession(phoneNumber);
      }
      const conversationHistory = await sessionManager.getConversationHistory(phoneNumber, 10);
      
      const stateObj = session.current_order ? JSON.parse(session.current_order) : {};
      const currentState = session.state || sessionManager.STATES.IDLE;
      
      // Usar transcripción corregida para el resto del procesamiento
      transcription = transcriptionCorregida;
      
      // ELIMINADO: Verificación que mostraba "Ya confirmamos que eres cliente registrado" sin autenticación real
      // Ahora el flujo correcto es: hacer pedido → mostrar factura/precio → pedir confirmación → luego autenticación
      
      // FLUJO 0.5: Si está esperando método de pago
      if (currentState === sessionManager.STATES.AWAITING_PAYMENT_METHOD) {
        const intencion = transcriptionCorrector.detectarIntencion(transcription);
        const transcriptionLower = transcription.toLowerCase().trim();
        
        // Mapeo de intenciones a métodos de pago
        const metodosPago = {
          'pago_transferencia': 'TRANSFERENCIA',
          'pago_efectivo': 'EFECTIVO',
          'pago_yape': 'YAPE',
          'pago_plin': 'PLIN'
        };
        
        // Buscar método de pago usando el corrector
        let metodoSeleccionado = metodosPago[intencion] || null;
        
        // Si no se detectó por intención, buscar por palabras clave
        if (!metodoSeleccionado) {
          if (transcriptionCorrector.coincide(transcriptionLower, transcriptionCorrector.correcciones.transferencia)) {
            metodoSeleccionado = 'TRANSFERENCIA';
          } else if (transcriptionCorrector.coincide(transcriptionLower, transcriptionCorrector.correcciones.efectivo)) {
            metodoSeleccionado = 'EFECTIVO';
          } else if (transcriptionCorrector.coincide(transcriptionLower, transcriptionCorrector.correcciones.yape)) {
            metodoSeleccionado = 'YAPE';
          } else if (transcriptionCorrector.coincide(transcriptionLower, transcriptionCorrector.correcciones.plin)) {
            metodoSeleccionado = 'PLIN';
          }
        }
        
        if (metodoSeleccionado) {
          logger.info(`💳 [VOZ] Método de pago seleccionado: ${metodoSeleccionado}`);
          
          const pedidoId = stateObj.pedido_id || stateObj._pedido_id;
          if (pedidoId) {
            // Confirmar pedido con método de pago
            const orderHandler = require('./orderHandler');
            const sessionStateWithPayment = {
              state: sessionManager.STATES.IDLE,
              phoneNumber,
              nombreCliente: stateObj._client_name || 'Cliente',
              remoteJid: jidToUse,
              authenticated: true,
              user_token: stateObj._user_token,
              _authenticated: true,
              _user_token: stateObj._user_token,
              _client_id: stateObj._client_id,
              _client_name: stateObj._client_name,
              pedido_id: pedidoId,
              metodo_pago: metodoSeleccionado,
              ...stateObj
            };
            
            // Confirmar pedido con método de pago
            await orderHandler.confirmOrder(phoneNumber, this, sessionStateWithPayment);
            return;
          } else {
            await this.sendMessage(jidToUse,
              `❌ No se encontró un pedido activo. Por favor, inicia un nuevo pedido.`
            );
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
              ...stateObj,
              _awaiting_payment_method: false
            });
            return;
          }
        } else {
          await this.sendMessage(jidToUse,
            `❌ Método de pago no reconocido.\n\n` +
            `Por favor, *escribe* (no hables) uno de los siguientes métodos:\n\n` +
            `• *TRANSFERENCIA* - Transferencia bancaria\n` +
            `• *EFECTIVO* - Pago en efectivo\n` +
            `• *YAPE* - Pago por Yape\n` +
            `• *PLIN* - Pago por Plin\n\n` +
            `O escribe *CANCELAR* para cancelar el pedido.`
          );
          return;
        }
      }
      
      // PRIORIDAD ABSOLUTA 0: Si es CONFIRMO, procesar confirmación DIRECTAMENTE
      // Usar el corrector de transcripciones para detectar intención
      const intencion = transcriptionCorrector.detectarIntencion(transcription);
      const transcriptionLower = transcription.toLowerCase().trim();
      
      // Variantes comunes de "pedido" en transcripciones (ya corregidas)
      const pedidoVariants = [
        'pedido', 'periodo', 'perió', 'pevivo', 'teído', 'producto', 
        'pediro', 'pedio', 'período', 'perido', 'pevido'
      ];
      
      // Verificar si contiene palabras de confirmación usando el corrector
      const hasConfirmKeyword = transcriptionCorrector.coincide(
        transcriptionLower, 
        transcriptionCorrector.correcciones.confirmo
      );
      
      // Verificar si contiene variantes de "pedido"
      const hasPedidoVariant = pedidoVariants.some(variant => 
        transcriptionLower.includes(variant)
      );
      
      // Detectar patrones específicos: "confirmar periodo", "confirmar perió", etc.
      const explicitConfirmPattern = /confirmar?\s*(?:el\s*)?(?:pedido|periodo|perió|pevivo|teído|producto|pediro|pedio|período)/i;
      const isExplicitConfirm = explicitConfirmPattern.test(transcription) || intencion === 'confirmar_pedido';
      
      // Verificar si hay un pedido activo (buscar en sesión primero)
      let hasActiveOrder = await sessionManager.getActiveOrderId(phoneNumber);
      
      // Si no se encuentra en sesión, buscar en la BD directamente
      if (!hasActiveOrder) {
        try {
          const kardexDb = require('./kardexDb');
          if (kardexDb.isConnected()) {
            const pool = kardexDb.getPool();
            // Buscar el pedido más reciente en EN_PROCESO
            const [pedidos] = await pool.execute(
              `SELECT id, numero_pedido, cliente_id, estado FROM pedidos 
               WHERE estado = 'EN_PROCESO' 
               ORDER BY id DESC LIMIT 1`
            );
            
            if (pedidos && pedidos.length > 0) {
              hasActiveOrder = pedidos[0].id;
              logger.info(`🔍 [VOZ] Pedido activo encontrado en BD: ${hasActiveOrder}`);
            }
          }
        } catch (bdError) {
          logger.error('Error al buscar pedido en BD:', bdError);
        }
      }
      
      // También verificar si hay pedido_id en el stateObj
      if (!hasActiveOrder && (stateObj.pedido_id || stateObj._pedido_id)) {
        hasActiveOrder = stateObj.pedido_id || stateObj._pedido_id;
        logger.info(`🔍 [VOZ] Pedido activo encontrado en stateObj: ${hasActiveOrder}`);
      }
      
      // Estados que indican que hay un pedido en proceso
      const isInOrderState = currentState === sessionManager.STATES.PEDIDO_EN_PROCESO || 
                             currentState === sessionManager.STATES.AWAITING_CONFIRMATION ||
                             currentState === sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION ||
                             hasActiveOrder;
      
      // Si tiene palabra de confirmación Y (variante de pedido O está en estado de pedido O hay pedido activo)
      // También aceptar solo "confirmo/confirmar" si hay un pedido activo (para manejar transcripciones erróneas)
      // Priorizar detección si hay pedido activo y dice alguna palabra de confirmación
      const isConfirm = (hasConfirmKeyword && (hasPedidoVariant || isInOrderState || hasActiveOrder)) || 
                        isExplicitConfirm ||
                        (hasConfirmKeyword && hasActiveOrder); // Si dice "confirmo/confirmar" y hay pedido activo, aceptar siempre
      
      logger.info('🔍 Verificando confirmación', {
        transcription: transcription.substring(0, 50),
        hasConfirmKeyword,
        hasPedidoVariant,
        isExplicitConfirm,
        isInOrderState,
        hasActiveOrder,
        currentState,
        isConfirm
      });
      
      // Procesar confirmación si se detecta Y (está en estado de pedido O hay pedido activo)
      if (isConfirm && (isInOrderState || hasActiveOrder)) {
        logger.info('✅ PRIORIDAD: Confirmación de pedido detectada');
        try {
          const orderHandler = require('./orderHandler');
          const sessionStateWithPhone = { 
            state: currentState,
            phoneNumber,
            nombreCliente: 'Cliente',
            remoteJid: jidToUse,
            authenticated: stateObj._authenticated || false,
            pedido_id: hasActiveOrder,
            ...stateObj
          };
          await orderHandler.confirmOrder(phoneNumber, this, sessionStateWithPhone);
          return; // Salir inmediatamente
        } catch (confirmError) {
          logger.error('Error al confirmar pedido', confirmError);
          // Continuar con el flujo normal si falla
        }
      }
      
      // PRIORIDAD ABSOLUTA 1: Si es un PEDIDO, procesarlo DIRECTAMENTE
      // Detectar múltiples variaciones de pedidos (incluso con errores de transcripción)
      // Incluir "quiera" porque Whisper a veces transcribe "quiero" como "quiera"
      // Incluir "periodo", "pevivo", "pediro", "pedio" porque Whisper transcribe mal "pedido"
      // EXCLUIR "confirmar pedido" que ya se maneja arriba
      const isConfirmRequest = /confirmar?\s+(?:el\s+)?(?:pedido|periodo|pevivo)/i.test(transcription.trim());
      // Patrón mejorado para detectar pedidos con errores de transcripción
      const orderPattern = /(?:quiero hacer un (?:pedido|periodo|pevivo|pediro|pedio)|quiera hacer un (?:pedido|periodo|pevivo|pediro|pedio)|quiero hacer (?:pedido|periodo|pevivo)|quiera hacer (?:pedido|periodo|pevivo)|quiero pedir|quiera pedir|vamos a hacer un (?:pedido|periodo|pevivo)|vamos a hacer (?:pedido|periodo|pevivo)|vamos a pedir|va a ser un (?:pedido|periodo|pevivo)|va a ser (?:pedido|periodo|pevivo)|tras ser un (?:pedido|periodo|pevivo|período)|tras ser (?:pedido|periodo|pevivo|período)|ser un (?:pedido|periodo|pevivo)|hacer un (?:pedido|periodo|pevivo)|hacer (?:pedido|periodo|pevivo)|necesito comprar|quiero comprar|quiera comprar|hacer una compra|hacer compra|necesito pedir|pedidoss|pedidos de)/i;
      // Detectar también: "va a ser un periodo de..." donde "periodo" = "pedido"
      const periodOrderPattern = /(?:va a ser un?\s*(?:periodo|pedido|pevivo))\s+(?:de\s+)?(?:un|una|el|la)?/i;
      const isOrder = (orderPattern.test(transcription) || periodOrderPattern.test(transcription)) && !isConfirmRequest;
      
      logger.info('🔍 Verificando si es pedido', {
        transcription: transcription.substring(0, 50),
        isOrder,
        matches: transcription.match(orderPattern)
      });
      
      if (isOrder) {
        logger.info('🛒 PRIORIDAD: Pedido detectado, procesando directamente');
        
        try {
          const productExtractorAI = require('./productExtractorAI');
          const productInfo = await productExtractorAI.extractProductInfo(transcription);
          
          logger.info('✅ Información extraída para pedido', {
            producto: productInfo.producto,
            intencion: productInfo.intencion,
            marca: productInfo.marca
          });
          
          if (productInfo && productInfo.producto && productInfo.producto.length > 2) {
            const producto = await productExtractorAI.searchProduct(productInfo);
            
            if (producto) {
              const precio = typeof producto.precio_venta === 'number' 
                ? producto.precio_venta.toFixed(2) 
                : parseFloat(producto.precio_venta || 0).toFixed(2);
              
              const stock = producto.stock_actual || 0;
              
              if (stock > 0) {
                // Iniciar flujo de pedido
                const orderHandler = require('./orderHandler');
                const kardexApi = require('./kardexApi');
                const cantidad = 1; // Por defecto 1 cuando dice "un balón"
                
                // Si hay un pedido en proceso, cancelarlo primero para crear uno nuevo
                // Cuando el usuario dice "quiero hacer un pedido", quiere un pedido nuevo
                const pedidoIdExistente = await sessionManager.getActiveOrderId(phoneNumber);
                if (pedidoIdExistente) {
                  logger.info(`🔄 Cancelando pedido anterior ${pedidoIdExistente} para crear uno nuevo`);
                  try {
                    await kardexApi.cancelarPedidoEnProceso(pedidoIdExistente);
                    // Limpiar pedido activo de la sesión
                    await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
                      pedido_id: undefined,
                      _pedido_id: undefined,
                      numero_pedido: undefined
                    });
                  } catch (cancelError) {
                    logger.warn('No se pudo cancelar pedido anterior, continuando...', cancelError);
                  }
                }
                
                // Agregar producto al pedido (addProductToOrder ya maneja los mensajes)
                const result = await orderHandler.addProductToOrder(
                  phoneNumber, 
                  producto.id, 
                  cantidad, 
                  producto.nombre, 
                  this, // whatsappHandler
                  jidToUse // JID correcto para enviar mensajes
                );
                
                // Solo enviar mensaje si addProductToOrder fue exitoso
                // El mensaje de resumen ya fue enviado por addProductToOrder
                return; // Salir inmediatamente
              } else {
                await this.sendMessage(jidToUse,
                  `😅 Lo siento, *${producto.nombre}* está agotado.\n\n` +
                  `💡 Puedo ayudarte a buscar productos similares. Escribe *CATALOGO* para ver otros productos disponibles.`
                );
                return;
              }
            } else {
              logger.warn(`⚠️ No se encontró producto para pedido: "${productInfo.producto}"`);
              await this.sendMessage(jidToUse,
                `😅 No encontré "${productInfo.producto}" en nuestro catálogo.\n\n` +
                `💡 Puedo ayudarte a buscar productos similares. Escribe *CATALOGO* para ver todos nuestros productos.`
              );
              return;
            }
          } else {
            logger.warn('⚠️ No se pudo extraer producto del pedido, intentando búsqueda directa');
            
            // Intentar búsqueda directa con palabras clave del mensaje
            const kardexDb = require('./kardexDb');
            const kardexApi = require('./kardexApi');
            
            // Extraer palabras clave: disco, duro, kingston, ssd, terabyte, etc.
            const keywords = transcription.toLowerCase()
              .replace(/[^a-z0-9\s]/g, ' ')
              .split(/\s+/)
              .filter(w => w.length > 3 && !['quiero', 'hacer', 'pedido', 'comprar', 'necesito', 'dame', 'deme'].includes(w));
            
            logger.info('Buscando producto con palabras clave', { keywords });
            
            for (const keyword of keywords) {
              if (keyword.length < 3) continue;
              
              let productos = null;
              if (kardexDb.isConnected()) {
                productos = await kardexDb.buscarProductos(keyword, 5);
              }
              if (!productos || productos.length === 0) {
                productos = await kardexApi.buscarProductos(keyword);
              }
              
              if (productos && productos.length > 0) {
                const producto = productos[0];
                const precio = typeof producto.precio_venta === 'number' 
                  ? producto.precio_venta.toFixed(2) 
                  : parseFloat(producto.precio_venta || 0).toFixed(2);
                
                const stock = producto.stock_actual || 0;
                
                if (stock > 0) {
                  const orderHandler = require('./orderHandler');
                  // addProductToOrder ya maneja los mensajes internamente
                  await orderHandler.addProductToOrder(phoneNumber, producto.id, 1, producto.nombre, this);
                  return; // El mensaje ya fue enviado por addProductToOrder
                }
              }
            }
            
            // Si no se encuentra, continuar con el flujo normal
            logger.warn('⚠️ No se encontró producto después de búsqueda directa');
          }
        } catch (orderError) {
          logger.error('Error al procesar pedido', orderError);
          // Continuar con el flujo normal si falla
        }
      }
      
      // PRIORIDAD ABSOLUTA 2: Si es consulta de precio/producto, procesarla DIRECTAMENTE
      // Esto debe estar ANTES de cualquier otro flujo, incluso autenticación
      const priceQueryPattern = /(?:cuánto|cuanto|precio|vale|cuesta|a cuánto|a cuanto|cuánto sale|cuanto sale|cuánto vale|cuanto vale|precio de|cuál es el precio|cual es el precio|cuánto está|cuanto esta|cuánto esta|cuanto está|quiero saber|necesito saber|dime|dime el precio|dime cuánto|cuál es|cuál|cuanto|cuánto)/i;
      const productQueryPattern = /(?:tienes|hay|disponible|stock|tienen|queda|producto|productos|balón|balon|pelota|camiseta|laptop|mouse|teclado)/i;
      const isProductQuery = priceQueryPattern.test(transcription) || productQueryPattern.test(transcription);
      
      if (isProductQuery) {
        logger.info('🔍 PRIORIDAD: Consulta de precio/producto detectada, procesando ANTES de cualquier otro flujo');
        
        try {
          const productExtractorAI = require('./productExtractorAI');
          const productInfo = await productExtractorAI.extractProductInfo(transcription);
          
          logger.info('✅ Información extraída por IA', {
            producto: productInfo.producto,
            intencion: productInfo.intencion,
            marca: productInfo.marca
          });
          
          if (productInfo && productInfo.producto && productInfo.producto.length > 2) {
            const producto = await productExtractorAI.searchProduct(productInfo);
            
            if (producto) {
              const precio = typeof producto.precio_venta === 'number' 
                ? producto.precio_venta.toFixed(2) 
                : parseFloat(producto.precio_venta || 0).toFixed(2);
              
              const stock = producto.stock_actual || 0;
              const stockMsg = stock > 0 ? `✅ Disponible (${stock} unidades)` : '❌ Agotado';
              
              logger.success(`✅ Producto encontrado: ${producto.nombre} - S/ ${precio}`);
              
              await this.sendMessage(jidToUse,
                `💰 *${producto.nombre}*\n\n` +
                `Precio: *S/ ${precio}*\n` +
                `Stock: ${stockMsg}\n\n` +
                `💬 ¿Te interesa? Puedes pedirlo escribiendo el nombre o enviando una nota de voz.`
              );
              return; // Salir inmediatamente, no procesar más
            } else {
              logger.warn(`⚠️ No se encontró producto: "${productInfo.producto}"`);
              await this.sendMessage(jidToUse,
                `😅 No encontré "${productInfo.producto}" en nuestro catálogo.\n\n` +
                `💡 Puedo ayudarte a buscar productos similares. Escribe *CATALOGO* para ver todos nuestros productos.`
              );
              return; // Salir inmediatamente
            }
          }
        } catch (productError) {
          logger.error('Error al procesar consulta de producto (prioridad)', productError);
          // Si falla, continuar con el flujo normal
        }
      }
      
      // FLUJO 0 (VOZ): Si está esperando confirmación si es cliente registrado (ANTES de cancelación universal)
      if (currentState === sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION) {
        // Limpiar signos de puntuación y normalizar para mejor detección
        const transcriptionLowerForYesNo = transcription.toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
          .replace(/[¡!¿?.,;:]/g, '') // Quitar signos de puntuación
          .trim();
        
        const yesKeywords = ['si', 'sí', 's', 'yes', 'y', 'cliente', 'registrado', 'tengo cuenta', 'ya tengo', 'si soy', 'si soy cliente', 'soy cliente', 'soy registrado', 'si estoy', 'sí soy', 'sí soy cliente'];
        const noKeywords = ['no', 'n', 'tampoco', 'no soy', 'no estoy', 'no tengo', 'no tengo cuenta'];
        
        logger.info(`🔍 [VOZ] Verificando confirmación de cliente - transcripción limpia: "${transcriptionLowerForYesNo}"`);
        
        // Detección mejorada: buscar keywords en la transcripción completa (sin signos de puntuación)
        const isYes = yesKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return transcriptionLowerForYesNo === keywordLower || 
                 transcriptionLowerForYesNo.includes(keywordLower) ||
                 transcriptionLowerForYesNo.startsWith(keywordLower) ||
                 transcriptionLowerForYesNo.endsWith(keywordLower) ||
                 transcriptionLowerForYesNo.includes('si') && transcriptionLowerForYesNo.includes('cliente') ||
                 transcriptionLowerForYesNo.includes('sí') && transcriptionLowerForYesNo.includes('cliente');
        });
        const isNo = noKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return transcriptionLowerForYesNo === keywordLower || 
                 transcriptionLowerForYesNo.includes(keywordLower);
        });
        
        if (isYes) {
          // Usuario es cliente, buscar automáticamente por el número del remitente
          logger.info(`🔍 [VOZ] Usuario confirmó que es cliente, buscando por número del remitente: ${phoneNumber}`);
          
          // Extraer el número real del remitente (puede venir como JID completo)
          let realPhoneForSearch = phoneNumber;
          
          // Si phoneNumber contiene @, extraer solo la parte numérica
          if (phoneNumber.includes('@')) {
            realPhoneForSearch = phoneNumber.split('@')[0];
            logger.info(`🔍 [VOZ] Extraído número del JID: ${realPhoneForSearch}`);
          }
          
          // Si el número es muy largo (más de 15 dígitos), probablemente es un ID interno, intentar obtener el número real
          if (realPhoneForSearch.length > 15) {
            logger.warn(`⚠️ [VOZ] Número muy largo (${realPhoneForSearch.length} dígitos), puede ser ID interno. Intentando obtener número real...`);
            // Intentar obtener el número real desde el remoteJid si está disponible
            if (remoteJid && remoteJid.includes('@lid')) {
              try {
                // Buscar en cache de contactos
                if (this.contacts && this.contacts[remoteJid]) {
                  const contact = this.contacts[remoteJid];
                  if (contact.jid) {
                    realPhoneForSearch = contact.jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
                    logger.info(`✅ [VOZ] Número real obtenido desde cache: ${realPhoneForSearch}`);
                  } else if (contact.id) {
                    realPhoneForSearch = contact.id.replace('@s.whatsapp.net', '').replace('@c.us', '');
                    logger.info(`✅ [VOZ] Número real obtenido desde cache (id): ${realPhoneForSearch}`);
                  }
                }
              } catch (contactError) {
                logger.warn(`⚠️ [VOZ] Error al obtener número real: ${contactError.message}`);
              }
            }
          }
          
          // Normalizar el número del remitente
          const PhoneNormalizer = require('./utils/phoneNormalizer');
          const kardexApi = require('./kardexApi');
          const remitenteNormalized = PhoneNormalizer.normalize(realPhoneForSearch);
          logger.info(`🔍 [VOZ] Número del remitente normalizado: ${remitenteNormalized} (original: ${realPhoneForSearch})`);
          
          // Buscar cliente por el número del remitente
          const clienteRemitente = await kardexApi.getClientByPhone(remitenteNormalized);
          
          if (clienteRemitente) {
            // Cliente encontrado por número del remitente
            logger.info(`✅ [VOZ] Cliente encontrado por número del remitente: ${clienteRemitente.nombre}`);
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
              _client_id: clienteRemitente.id,
              _client_phone: remitenteNormalized,
              _client_name: clienteRemitente.nombre
            });
            await this.sendMessage(jidToUse,
              `✅ Ya confirmamos que eres cliente registrado, *${clienteRemitente.nombre}*.\n\n` +
              `🔐 Por favor, *escribe* tu *contraseña* para acceder a tu cuenta.\n\n` +
              `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
              `💡 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
              `💡 O si quieres hacer un pedido sin ingresar, escribe *PEDIDO*`
            );
            return;
          } else {
            // Cliente no encontrado por número del remitente, pedir número manualmente
            logger.warn(`⚠️ [VOZ] Cliente no encontrado por número del remitente: ${remitenteNormalized}`);
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PHONE, {});
            await this.sendMessage(jidToUse,
              `✅ Perfecto, eres cliente registrado.\n\n` +
              `📞 Por favor, ingresa tu *número de teléfono* registrado (9 dígitos):\n\n` +
              `Ejemplo: *987654321* o *51987654321*`
            );
            return;
          }
        } else if (isNo) {
          // Usuario NO es cliente, mostrar opciones
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
          await this.sendMessage(jidToUse,
            `👋 *¡Perfecto! Bienvenido a KARDEX* 👋\n\n` +
            `📋 *¿Qué deseas hacer?*\n\n` +
            `1️⃣ *REGISTRAR* - Crear una cuenta nueva\n` +
            `2️⃣ *PEDIDO* - Hacer un pedido (solo nombre y DNI)\n` +
            `3️⃣ *CATALOGO* - Ver productos disponibles\n` +
            `4️⃣ Escribe tu pedido directamente, ejemplo: *"quiero una laptop"*\n\n` +
            `💡 También puedes enviarme una nota de voz con lo que necesitas.`
          );
          return;
        } else {
          // Respuesta no clara, pedir clarificación
          await this.sendMessage(jidToUse,
            `❓ No entendí tu respuesta.\n\n` +
            `Por favor, responde:\n` +
            `• *SÍ* si eres cliente registrado\n` +
            `• *NO* si no eres cliente registrado\n\n` +
            `O escribe *CANCELAR* para volver al inicio.`
          );
          return;
        }
      }
      
      // FLUJO ESPECIAL (VOZ): Si está esperando contraseña - DEBE ESTAR ANTES DE AWAITING_PHONE
      if (currentState === sessionManager.STATES.AWAITING_PASSWORD) {
        // Limpiar transcripción para mejor detección
        const transcriptionLower = transcription.toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
          .replace(/[¡!¿?.,;:]/g, '') // Quitar signos de puntuación
          .trim();
        
        // PRIORIDAD 1: Detectar CANCELAR (incluyendo variantes de transcripción)
        const cancelKeywords = [
          'cancelar', 'cancel', 'cancela', 'cancelar todo', 'cancelar operacion',
          'gonzilar', 'gonzillar', 'gonzil', 'cancilar', 'cancillar', // Variantes de transcripción
          'volver', 'volver atras', 'volver atrás', 'inicio', 'salir'
        ];
        const isCancel = cancelKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return transcriptionLower === keywordLower || 
                 transcriptionLower.includes(keywordLower) ||
                 transcriptionLower.startsWith(keywordLower) ||
                 transcriptionLower.endsWith(keywordLower);
        });
        
        if (isCancel) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: undefined,
            _client_id: undefined,
            _client_phone: undefined,
            _client_name: undefined
          });
          await this.sendMessage(jidToUse,
            '❌ Verificación cancelada.\n\n' +
            '💬 Escribe *HOLA* para comenzar de nuevo.'
          );
          return;
        }
        
        // PRIORIDAD 2: Detectar "si soy cliente" o variantes (por si el usuario se confundió)
        const yesKeywords = ['si', 'sí', 's', 'yes', 'y', 'cliente', 'registrado', 'tengo cuenta', 'ya tengo', 'si soy', 'si soy cliente', 'soy cliente', 'soy registrado', 'si estoy', 'sí soy', 'sí soy cliente'];
        const isYes = yesKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return transcriptionLower === keywordLower || 
                 transcriptionLower.includes(keywordLower) ||
                 transcriptionLower.startsWith(keywordLower) ||
                 transcriptionLower.endsWith(keywordLower) ||
                 (transcriptionLower.includes('si') && transcriptionLower.includes('cliente')) ||
                 (transcriptionLower.includes('sí') && transcriptionLower.includes('cliente'));
        });
        
        if (isYes) {
          // El usuario dice "si soy cliente" pero ya está en flujo de contraseña
          // Esto significa que ya confirmó antes, solo necesita la contraseña
          const clientName = stateObj._client_name || 'Cliente';
          await this.sendMessage(jidToUse,
            `✅ Ya confirmamos que eres cliente registrado, *${clientName}*.\n\n` +
            '🔐 Ahora necesitamos tu *contraseña* para acceder a tu cuenta.\n\n' +
            '🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n' +
            '💡 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"*\n' +
            '❌ O escribe *CANCELAR* para volver al inicio.'
          );
          return;
        }
        
        // PRIORIDAD 3: Detectar si el usuario dice que olvidó su contraseña
        const forgotPasswordKeywords = [
          'olvide', 'olvidé', 'olvido', 'olvidó', 'olvido mi contraseña',
          'olvide contraseña', 'olvidé contraseña', 'no recuerdo',
          'no recuerdo mi contraseña', 'olvide mi password',
          'perdi mi contraseña', 'perdí mi contraseña', 'recuperar',
          'recuperar contraseña', 'cambiar contraseña', 'resetear contraseña'
        ];
        
        const isForgotPassword = forgotPasswordKeywords.some(keyword => 
          transcriptionLower.includes(keyword)
        );
        
        if (isForgotPassword) {
          // Usuario olvidó su contraseña, enviar código SMS
          const PhoneNormalizer = require('./utils/phoneNormalizer');
          const smsService = require('./services/smsService');
          const clientPhone = stateObj._client_phone || phoneNumber;
          const clientName = stateObj._client_name || 'Usuario';
          
          // Generar código de verificación
          const smsCode = smsService.generateVerificationCode();
          const codeExpiresAt = Date.now() + (10 * 60 * 1000); // 10 minutos
          
          // Intentar enviar SMS (en desarrollo, se envía por WhatsApp)
          const smsSent = await smsService.sendVerificationCode(clientPhone, smsCode, this, jidToUse);
          
          if (smsSent) {
            // Guardar código en sesión
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
              ...stateObj,
              _sms_code: smsCode,
              _sms_code_expires: codeExpiresAt,
              _sms_attempts: 0
            });
            
            await this.sendMessage(jidToUse,
              `🔐 *Recuperación de contraseña* 🔐\n\n` +
              `Hola *${clientName}*,\n\n` +
              `📱 Hemos enviado un código de verificación de 6 dígitos a tu número de teléfono *${PhoneNormalizer.format(clientPhone)}*.\n\n` +
              `💬 *También te lo enviamos por WhatsApp arriba.*\n\n` +
              `🔢 Por favor, ingresa el código que recibiste:\n\n` +
              `⏰ *El código expira en 10 minutos.*\n\n` +
              `❌ Si no recibiste el código, escribe *CANCELAR* para volver al inicio.`
            );
          } else {
            // Error al enviar SMS, ofrecer alternativa
            await this.sendMessage(jidToUse,
              `❌ No pudimos enviar el SMS al número registrado.\n\n` +
              `Por favor, contacta con soporte o intenta ingresar tu contraseña nuevamente.\n\n` +
              `Si no recuerdas tu contraseña, puedes escribir *CANCELAR* para volver al inicio.`
            );
          }
          return;
        }
        
        // Si no es "olvidé contraseña", el usuario está intentando enviar contraseña por voz
        // Por seguridad, no aceptamos contraseñas por voz
        await this.sendMessage(jidToUse,
          '🔒 *Por seguridad, no aceptamos contraseñas por audio.*\n\n' +
          '📝 Por favor, *escribe* tu contraseña por texto para acceder a tu cuenta.\n\n' +
          '💡 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación.\n\n' +
          '❌ O escribe *CANCELAR* para volver al inicio.'
        );
        return;
      }
      
      // FLUJO 1 (VOZ): Si está esperando número de teléfono
      if (currentState === sessionManager.STATES.AWAITING_PHONE) {
        const PhoneNormalizer = require('./utils/phoneNormalizer');
        const kardexApi = require('./kardexApi');
        const kardexDb = require('./kardexDb');
        
        // PRIORIDAD: Detectar CANCELAR antes de procesar como número
        const transcriptionLower = transcription.toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
          .replace(/[¡!¿?.,;:]/g, '') // Quitar signos de puntuación
          .trim();
        
        const cancelKeywords = [
          'cancelar', 'cancel', 'cancela', 'cancelar todo', 'cancelar operacion',
          'gonzilar', 'gonzillar', 'gonzil', 'cancilar', 'cancillar', // Variantes de transcripción
          'volver', 'volver atras', 'volver atrás', 'inicio', 'salir'
        ];
        const isCancel = cancelKeywords.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          return transcriptionLower === keywordLower || 
                 transcriptionLower.includes(keywordLower) ||
                 transcriptionLower.startsWith(keywordLower) ||
                 transcriptionLower.endsWith(keywordLower);
        });
        
        if (isCancel) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: undefined,
            _client_id: undefined,
            _client_phone: undefined,
            _client_name: undefined
          });
          await this.sendMessage(jidToUse,
            '❌ Operación cancelada.\n\n' +
            '💬 Escribe *HOLA* para comenzar de nuevo.'
          );
          return;
        }
        
        // Limpiar transcripción de voz: quitar TODOS los caracteres que no sean números
        // Whisper a veces transcribe "9 9 3 0 4 3 1 1 2" o "99, 30, 43, 1, 1, 2" o "99-30-43-1-1-2" o "99,30,4312" o "9-9-3-0-4-3-1-1"
        // Usar una expresión más agresiva: solo dejar números
        const cleanedText = transcription.replace(/[^0-9]/g, '');
        logger.info(`📞 [VOZ] Número recibido (original): "${transcription}" -> (limpio): "${cleanedText}"`);
        
        // Si después de limpiar no hay números, es un error
        if (!cleanedText || cleanedText.length === 0) {
          await this.sendMessage(jidToUse, 
            '❌ No pude detectar un número de teléfono en tu mensaje.\n\n' +
            '💡 Por favor, dicta tu número claramente, por ejemplo: "9 9 3 0 4 3 1 1 2"\n\n' +
            '❌ O di *CANCELAR* para volver al inicio.'
          );
          return;
        }
        
        const phoneInput = PhoneNormalizer.normalize(cleanedText);
        if (!PhoneNormalizer.isValidPeruvianPhone(phoneInput)) {
          await this.sendMessage(jidToUse, 
            `❌ El número de teléfono no es válido.\n\n` +
            `📞 Detecté: *${cleanedText}*\n\n` +
            `Por favor, ingresa un número de 9 dígitos (ejemplo: 987654321) o con código de país (51987654321).`
          );
          return;
        }
        
        // Actualizar sesión con el número ingresado
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
          _input_phone: phoneInput
        });
        
        // Buscar cliente con el número ingresado
        let cliente = null;
        if (kardexDb.isConnected()) {
          cliente = await kardexDb.buscarClientePorTelefono(phoneInput);
        }
        if (!cliente) {
          cliente = await kardexApi.getClientByPhone(phoneInput);
        }
        
        if (cliente && cliente.nombre) {
          // Cliente encontrado, pedir contraseña
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
            _input_phone: phoneInput,
            _client_id: cliente.id,
            _client_phone: phoneInput,
            _client_name: cliente.nombre
          });
          await this.sendMessage(jidToUse,
            `✅ Cliente encontrado: *${cliente.nombre}*\n\n` +
            `🔐 Por favor, *escribe* tu *contraseña* para acceder a tu cuenta.\n\n` +
            `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
            `💡 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"*`
          );
        } else {
          // Cliente no encontrado, ofrecer registro
          await this.sendMessage(jidToUse,
            `❌ No encontramos una cuenta registrada con el número *${PhoneNormalizer.format(phoneInput)}*.\n\n` +
            `📋 *¿Qué deseas hacer?*\n\n` +
            `1️⃣ *REGISTRAR* - Crear una cuenta nueva\n` +
            `2️⃣ *PEDIDO* - Hacer un pedido sin cuenta\n` +
            `3️⃣ *CATALOGO* - Ver productos disponibles\n\n` +
            `💡 También puedes escribir *CANCELAR* para volver al inicio.`
          );
        }
        return;
      }
      
      // FLUJO 2.5 (VOZ): Si está esperando código SMS de verificación
      if (currentState === sessionManager.STATES.AWAITING_SMS_CODE) {
        const transcriptionLower = transcription.toLowerCase().trim();
        
        // Si dice CANCELAR, volver al inicio
        if (transcriptionLower === 'cancelar' || transcriptionLower === 'cancel' || transcriptionLower.includes('cancelar')) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            ...stateObj,
            _sms_code: undefined,
            _sms_code_expires: undefined,
            _sms_attempts: undefined
          });
          await this.sendMessage(jidToUse, 
            '❌ Verificación cancelada.\n\n' +
            '💬 Escribe *HOLA* para comenzar de nuevo.'
          );
          return;
        }
        
        // Extraer código numérico del mensaje
        const codeMatch = transcription.match(/\d{6}/);
        const enteredCode = codeMatch ? codeMatch[0] : transcription.replace(/[^0-9]/g, '');
        
        if (enteredCode.length !== 6) {
          const attempts = (stateObj._sms_attempts || 0) + 1;
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
            ...stateObj,
            _sms_attempts: attempts
          });
          
          if (attempts >= 3) {
            await this.sendMessage(jidToUse,
              `❌ Has excedido el número de intentos.\n\n` +
              `Por favor, di *"olvidé mi contraseña"* nuevamente para recibir un nuevo código, o di *CANCELAR* para volver al inicio.`
            );
            return;
          }
          
          await this.sendMessage(jidToUse,
            `❌ Código inválido. Por favor, ingresa el código de 6 dígitos que recibiste.\n\n` +
            `Ejemplo: *123456*\n\n` +
            `⏰ Recuerda que el código expira en 10 minutos.\n` +
            `❌ Di *CANCELAR* si no recibiste el código.`
          );
          return;
        }
        
        // Verificar código
        const storedCode = stateObj._sms_code;
        const codeExpires = stateObj._sms_code_expires || 0;
        const attempts = (stateObj._sms_attempts || 0) + 1;
        
        // Verificar si el código expiró
        if (Date.now() > codeExpires) {
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
            ...stateObj,
            _sms_code: undefined,
            _sms_code_expires: undefined,
            _sms_attempts: undefined
          });
          await this.sendMessage(jidToUse,
            `⏰ El código ha expirado.\n\n` +
            `Por favor, di *"olvidé mi contraseña"* nuevamente para recibir un nuevo código.`
          );
          return;
        }
        
        // Verificar si el código es correcto
        if (enteredCode === storedCode) {
          // Código correcto, autenticar usuario
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            ...stateObj,
            _authenticated: true,
            _user_token: stateObj._client_id ? `whatsapp_${stateObj._client_id}` : null,
            _sms_verified: true,
            _sms_code: undefined,
            _sms_code_expires: undefined,
            _sms_attempts: undefined
          });
          
          await this.sendMessage(jidToUse,
            `✅ *Código verificado correctamente*\n\n` +
            `¡Bienvenido de nuevo, *${stateObj._client_name || 'Cliente'}*!\n\n` +
            `Ahora puedes hacer pedidos y consultar tu información.\n\n` +
            `💬 Escribe *PEDIDO* para hacer un pedido o *CATALOGO* para ver productos.`
          );
          return;
        } else {
          // Código incorrecto
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_SMS_CODE, {
            ...stateObj,
            _sms_attempts: attempts
          });
          
          if (attempts >= 3) {
            await this.sendMessage(jidToUse,
              `❌ Has excedido el número de intentos.\n\n` +
              `Por favor, di *"olvidé mi contraseña"* nuevamente para recibir un nuevo código, o di *CANCELAR* para volver al inicio.`
            );
            return;
          }
          
          await this.sendMessage(jidToUse,
            `❌ Código incorrecto. Por favor, verifica el código que recibiste e ingrésalo nuevamente.\n\n` +
            `💡 Recuerda que el código tiene 6 dígitos.\n` +
            `❌ Di *CANCELAR* si no recibiste el código.`
          );
          return;
        }
      }

      // Verificar si el usuario está autenticado, tiene datos temporales, O está en proceso de autenticación
      // Si está en AWAITING_PASSWORD, ya tiene los datos del cliente guardados, no pedir número
      // Para números nuevos, intentar usar el número del remitente primero
      if (!stateObj._input_phone && !stateObj._authenticated && !stateObj._temp_nombre) {
        // Importar PhoneNormalizer aquí para evitar errores de scope
        const PhoneNormalizer = require('./utils/phoneNormalizer');
        const kardexApi = require('./kardexApi');
        const kardexDb = require('./kardexDb');
        
        // Intentar buscar cliente usando el número del remitente directamente
        const remitenteNormalized = PhoneNormalizer.normalize(phoneNumber);
        logger.info(`🔍 [VOZ] Buscando cliente con número del remitente: ${remitenteNormalized}`);
        
        let clienteRemitente = null;
        if (kardexDb.isConnected()) {
          clienteRemitente = await kardexDb.buscarClientePorTelefono(remitenteNormalized);
        }
        if (!clienteRemitente) {
          clienteRemitente = await kardexApi.getClientByPhone(remitenteNormalized);
        }
        
        // Si encontramos un cliente con ese número, guardarlo en sesión
        if (clienteRemitente && clienteRemitente.nombre) {
          logger.info(`✅ [VOZ] Cliente encontrado con número del remitente: ${clienteRemitente.nombre}`);
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PASSWORD, {
            _input_phone: remitenteNormalized,
            _client_id: clienteRemitente.id,
            _client_phone: remitenteNormalized,
            _client_name: clienteRemitente.nombre
          });
          await this.sendMessage(jidToUse,
            `👋 ¡Hola *${clienteRemitente.nombre}*! 👋\n\n` +
            `Te reconocí por tu número de WhatsApp.\n\n` +
            `Para acceder a tu cuenta y ver tus pedidos, por favor *escribe* tu *contraseña* de la página web.\n\n` +
            `🔒 *Por seguridad, escribe tu contraseña por texto (no por audio).*\n\n` +
            `🔐 Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
            `💡 O si quieres hacer un pedido sin ingresar, escribe *PEDIDO*`
          );
          return;
        } else {
          // No se encontró cliente, guardar el número del remitente y continuar
          logger.info(`⚠️ [VOZ] No se encontró cliente con número del remitente: ${remitenteNormalized}`);
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _input_phone: remitenteNormalized
          });
        }
      }
      
      // Si no es consulta de producto, verificar si necesita flujo inicial
      const needsInitialFlow = !stateObj._authenticated && 
                         !stateObj._temp_nombre && 
                         !stateObj._input_phone &&
                         currentState !== sessionManager.STATES.AWAITING_PASSWORD &&
                         currentState !== sessionManager.STATES.AWAITING_SMS_CODE &&
                         currentState !== sessionManager.STATES.AWAITING_REG_NAME &&
                         currentState !== sessionManager.STATES.AWAITING_REG_DNI &&
                         currentState !== sessionManager.STATES.AWAITING_REG_EMAIL &&
                         currentState !== sessionManager.STATES.AWAITING_REG_PASSWORD &&
                         currentState !== sessionManager.STATES.AWAITING_TEMP_NAME &&
                         currentState !== sessionManager.STATES.AWAITING_TEMP_DNI &&
                         currentState !== sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION;
      
      if (needsInitialFlow) {
        // NO preguntar si es cliente registrado si hay un pedido en proceso
        // El flujo correcto es: hacer pedido → mostrar factura/precio → pedir confirmación → luego autenticación
        const hasActiveOrder = await sessionManager.getActiveOrderId(phoneNumber);
        const isInOrderState = currentState === sessionManager.STATES.PEDIDO_EN_PROCESO || 
                               currentState === sessionManager.STATES.AWAITING_CONFIRMATION ||
                               currentState === sessionManager.STATES.ORDER_PENDING;
        
        if (!hasActiveOrder && !isInOrderState) {
          // Solo preguntar si NO hay pedido en proceso
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION, {});
          await this.sendMessage(jidToUse,
            `👋 *¡Hola! ¡Bienvenido a KARDEX!* 👋\n\n` +
            `❓ *¿Eres cliente registrado?*\n\n` +
            `Responde:\n` +
            `• *SÍ* si ya tienes una cuenta registrada\n` +
            `• *NO* si no tienes cuenta\n\n` +
            `💡 Esto nos ayudará a darte el mejor servicio.`
          );
          return;
        }
        // Si hay pedido en proceso, continuar con el flujo normal (no preguntar autenticación todavía)
      }

      // Obtener cliente según estado (importar si no están ya importados)
      const kardexApi = require('./kardexApi');
      const kardexDb = require('./kardexDb');
      const conversationalAI = require('./conversationalAI');
      let cliente = null;
      let nombreCliente = 'Cliente';
      
      // Si está en AWAITING_PASSWORD, ya tiene los datos del cliente guardados
      if (currentState === sessionManager.STATES.AWAITING_PASSWORD && stateObj._client_name) {
        nombreCliente = stateObj._client_name;
        cliente = {
          id: stateObj._client_id || null,
          nombre: stateObj._client_name,
          telefono: stateObj._client_phone || phoneNumber
        };
      }
      // Si está autenticado, obtener cliente
      else if (stateObj._authenticated && stateObj._client_id) {
        if (kardexDb.isConnected()) {
          try {
            const [clientes] = await kardexDb.pool.execute('SELECT * FROM clientes WHERE id = ?', [stateObj._client_id]);
            if (clientes && clientes.length > 0) {
              cliente = clientes[0];
              nombreCliente = cliente.nombre || stateObj._client_name || 'Cliente';
            }
          } catch (error) {
            logger.error('Error al obtener cliente autenticado (voz)', error);
          }
        }
        
        if (!cliente && stateObj._client_name) {
          nombreCliente = stateObj._client_name;
        }
      } else if (stateObj._temp_nombre && stateObj._temp_dni) {
        // Usuario temporal con datos para pedido
        nombreCliente = stateObj._temp_nombre;
        cliente = {
          id: null,
          nombre: stateObj._temp_nombre,
          numero_documento: stateObj._temp_dni,
          telefono: stateObj._temp_phone || phoneNumber,
          es_temporal: true
        };
      }

      // NO procesar con NLU si está en AWAITING_PASSWORD (ya se manejó arriba)
      // Esto evita que "cancelar" se interprete como "cancelar pedido"
      if (currentState === sessionManager.STATES.AWAITING_PASSWORD) {
        logger.info('⚠️ [VOZ] Estado AWAITING_PASSWORD ya procesado, no llamar NLU');
        return; // Ya se manejó arriba, no continuar con NLU
      }
      
      // Procesar con NLU (marcar como mensaje de voz)
      // Pasar phoneNumber y nombreCliente en sessionState
      const sessionStateWithPhone = { 
        state: currentState,
        phoneNumber,
        nombreCliente,
        cliente: cliente || null,
        remoteJid: jidToUse, // Guardar JID original para usar en respuestas
        authenticated: stateObj._authenticated || false,
        user_token: stateObj._user_token || null,
        temp_data: stateObj._temp_nombre ? {
          nombre: stateObj._temp_nombre,
          dni: stateObj._temp_dni,
          phone: stateObj._temp_phone
        } : null,
        ...stateObj // Incluir todos los datos del estado
      };
      
      logger.info('🔍 Procesando transcripción con NLU', {
        transcription: transcription.substring(0, 50),
        currentState,
        authenticated: stateObj._authenticated
      });
      
      let nluResult = null;
      let nluError = null;
      
      // Procesar con NLU con timeout y manejo de errores robusto
      try {
        logger.info(`🎤 [VOZ] Llamando a NLU para procesar transcripción...`);
        const nluPromise = nlu.processMessage(transcription, sessionStateWithPhone, conversationHistory, true);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('NLU timeout después de 30 segundos')), 30000)
        );
        
        nluResult = await Promise.race([nluPromise, timeoutPromise]);
        logger.info(`🔍 [VOZ] NLU procesó voz: intent=${nluResult.intent}, tiene response=${!!nluResult.response}`);
      } catch (nluErr) {
        nluError = nluErr;
        logger.error(`❌ [VOZ] Error en NLU:`, {
          error: nluErr.message,
          stack: nluErr.stack?.substring(0, 500)
        });
        // Continuar con fallback en lugar de lanzar error
      }
      
      // Si no hay resultado o respuesta, usar IA conversacional directamente
      if (!nluResult || !nluResult.response) {
        logger.warn('⚠️ [VOZ] NLU no devolvió respuesta, usando IA conversacional');
        try {
          const conversationalResponse = await conversationalAI.generateResponse(
            transcription,
            sessionStateWithPhone,
            conversationHistory,
            'unknown'
          );
          
          if (conversationalResponse) {
            logger.success('✅ [VOZ] Respuesta generada por IA conversacional (fallback)');
            await this.sendMessage(jidToUse, conversationalResponse);
            await sessionManager.saveMessage(phoneNumber, 'text', conversationalResponse, true);
            return;
          }
        } catch (convError) {
          logger.warn('⚠️ [VOZ] Error en IA conversacional, intentando procesar como texto', convError);
        }
        
        // Si la IA conversacional también falla, procesar como texto normal
        try {
          await this.processTextMessage(phoneNumber, transcription, remoteJid);
          return;
        } catch (textError) {
          logger.error('❌ [VOZ] Error al procesar como texto también', textError);
          // Último fallback: respuesta básica
          await this.sendMessage(jidToUse, 
            `👋 ¡Hola! 👋\n\n` +
            `Entendí: "${transcription}"\n\n` +
            `¿En qué puedo ayudarte? Puedo ayudarte con productos, pedidos o cualquier consulta. 😊`
          );
          return;
        }
      }

      // Manejar respuesta del NLU
      if (nluResult && nluResult.response) {
        // Si tiene acción, manejarla
        if (nluResult.response.action) {
          try {
            await this.handleAction(jidToUse, nluResult.response.action, nluResult.response, sessionStateWithPhone);
          } catch (actionError) {
            logger.error('❌ Error al ejecutar acción, procesando como texto normal', actionError);
            // Si falla la acción, procesar como texto normal
            await this.processTextMessage(phoneNumber, transcription, remoteJid);
          }
          return;
        } 
        // Si tiene mensaje, enviarlo
        if (nluResult.response.message) {
          await this.sendMessage(jidToUse, nluResult.response.message);
          await sessionManager.saveMessage(phoneNumber, 'text', nluResult.response.message, true);
          return;
        }
        // Si tiene productos (catálogo), enviar mensaje formateado
        if (nluResult.response.productos) {
          await this.sendMessage(jidToUse, nluResult.response.message || 'Catálogo de productos');
          await sessionManager.saveMessage(phoneNumber, 'text', nluResult.response.message || 'Catálogo de productos', true);
          return;
        }
      }
      
      // Si no hay respuesta del NLU, usar IA conversacional directamente
      logger.warn('⚠️ NLU no devolvió respuesta útil, usando IA conversacional');
      try {
        const conversationalResponse = await conversationalAI.generateResponse(
          transcription,
          sessionStateWithPhone,
          conversationHistory,
          nluResult?.intent || 'unknown'
        );
        
        if (conversationalResponse) {
          logger.success('✅ Respuesta generada por IA conversacional');
          await this.sendMessage(jidToUse, conversationalResponse);
          await sessionManager.saveMessage(phoneNumber, 'text', conversationalResponse, true);
          return;
        }
      } catch (convError) {
        logger.warn('Error en IA conversacional, intentando procesar como texto', convError);
      }
      
      // Si la IA conversacional falla, procesar como texto normal
      try {
        await this.processTextMessage(phoneNumber, transcription, remoteJid);
      } catch (textError) {
        logger.error('❌ Error al procesar como texto, dando respuesta básica', textError);
        await this.sendMessage(jidToUse, 
          `👋 ¡Hola! 👋\n\n` +
          `Entendí: "${transcription}"\n\n` +
          `¿En qué puedo ayudarte? Puedo ayudarte con productos, pedidos o cualquier consulta. 😊`
        );
      }

    } catch (error) {
      logger.error('═══════════════════════════════════════════════════════════');
      logger.error('❌ [VOZ] ERROR CRÍTICO al procesar mensaje de voz');
      logger.error(`❌ [VOZ] Error: ${error.message}`);
      logger.error(`❌ [VOZ] Stack: ${error.stack?.substring(0, 1000)}`);
      logger.error(`❌ [VOZ] Phone: ${phoneNumber}, JID: ${jidToUse}`);
      logger.error(`❌ [VOZ] AudioPath: ${audioPath || 'N/A'}`);
      logger.error(`❌ [VOZ] Transcription: ${typeof transcription !== 'undefined' ? transcription : 'N/A'}`);
      logger.error('═══════════════════════════════════════════════════════════');
      
      // Limpiar archivo temporal si existe
      if (audioPath) {
        await fs.unlink(audioPath).catch(() => {});
      }
      
      // SIEMPRE intentar enviar una respuesta, incluso en caso de error
      let responseSent = false;
      
      try {
        // Si tenemos una transcripción (incluso parcial), intentar procesarla
        if (typeof transcription !== 'undefined' && transcription && transcription.trim().length > 0) {
          logger.info(`🎤 [VOZ] Intentando recuperación con transcripción: "${transcription}"`);
          
          // Intentar procesar como mensaje de texto normal con timeout
          try {
            const textProcessPromise = this.processTextMessage(phoneNumber, transcription, remoteJid);
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout en procesamiento de texto')), 10000)
            );
            
            await Promise.race([textProcessPromise, timeoutPromise]);
            logger.info('🎤 [VOZ] ✅ Transcripción procesada exitosamente como texto');
            responseSent = true;
            return; // Salir sin mostrar error
          } catch (textProcessError) {
            logger.warn(`🎤 [VOZ] Error al procesar transcripción como texto: ${textProcessError.message}`);
          }
        }
        
        // Si no hay transcripción o no se pudo procesar, mensaje de error amigable
        if (!responseSent) {
          logger.info(`🎤 [VOZ] Enviando mensaje de error amigable...`);
          await this.sendMessage(jidToUse, 
            `😅 Lo siento, no pude procesar tu mensaje de voz en este momento.\n\n` +
            `💡 Por favor intenta:\n` +
            `• Grabar el audio nuevamente (habla más claro y cerca del micrófono)\n` +
            `• Enviar un mensaje de texto en su lugar\n` +
            `• Escribir *AYUDA* para ver las opciones disponibles\n\n` +
            `🔄 Si el problema persiste, intenta de nuevo en unos momentos.`
          );
          responseSent = true;
        }
      } catch (recoveryError) {
        logger.error(`❌ [VOZ] Error en recuperación: ${recoveryError.message}`);
        
        // Último fallback
        if (!responseSent) {
          try {
            await this.sendMessage(jidToUse, 
              `😅 Lo siento, hubo un error. Por favor intenta enviar un mensaje de texto o escribe *AYUDA*.`
            );
            responseSent = true;
          } catch (sendError) {
            logger.error(`❌ [VOZ] ERROR CRÍTICO: No se pudo enviar ningún mensaje`, {
              error: sendError.message,
              stack: sendError.stack?.substring(0, 500)
            });
          }
        }
      }
      
      logger.info(`🎤 [VOZ] Manejo de error completado, respuesta enviada: ${responseSent}`);
    }
  }

  /**
   * Enviar mensaje
   * Ahora acepta JID completo o número de teléfono
   */
  /**
   * Generar sugerencias inteligentes basadas en texto mal entendido
   */
  _generateSuggestions(text) {
    const suggestionMap = {
      'hola': '¿Quisiste decir "SÍ" o "NO"?',
      'quiero': '¿Quisiste decir "SÍ" (soy cliente)?',
      'necesito': '¿Quisiste decir "SÍ" (soy cliente)?',
      'ayuda': 'Responde "SÍ" o "NO" sobre si eres cliente',
      'catalogo': 'Primero responde si eres cliente (SÍ/NO)',
      'pedido': 'Primero responde si eres cliente (SÍ/NO)'
    };

    for (const [keyword, suggestion] of Object.entries(suggestionMap)) {
      if (text.includes(keyword)) {
        return suggestion;
      }
    }
    return null;
  }

  async sendMessage(phoneNumberOrJid, text) {
    const startTime = Date.now();
    try {
      if (!this.sock || !this.connected) {
        logger.error('❌ [SEND] No hay socket disponible o no está conectado');
        return false;
      }

      // Si ya es un JID completo (contiene @), usarlo directamente
      // Si no, construir el JID
      let jid = phoneNumberOrJid;
      if (!jid.includes('@')) {
        jid = `${jid}@s.whatsapp.net`;
      }

      logger.info('═══════════════════════════════════════════════════════════');
      logger.info(`📤 [SEND] Enviando mensaje`);
      logger.info(`📤 [SEND] A: ${jid}`);
      logger.info(`📤 [SEND] Texto: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
      logger.info(`📤 [SEND] Longitud: ${text.length} caracteres`);

      await this.sock.sendMessage(jid, { text });

      const sendTime = Date.now() - startTime;
      logger.success(`✅ [SEND] Mensaje enviado a ${jid} en ${sendTime}ms`);
      logger.info('═══════════════════════════════════════════════════════════');
      return true;

    } catch (error) {
      const sendTime = Date.now() - startTime;
      logger.error('═══════════════════════════════════════════════════════════');
      logger.error('❌ [SEND] ERROR al enviar mensaje');
      logger.error(`❌ [SEND] Error: ${error.message}`);
      logger.error(`❌ [SEND] Intentó enviar a: ${phoneNumberOrJid}`);
      logger.error(`❌ [SEND] Tiempo transcurrido: ${sendTime}ms`);
      logger.error(`❌ [SEND] Stack: ${error.stack?.substring(0, 500)}`);
      logger.error('═══════════════════════════════════════════════════════════');
      return false;
    }
  }

  /**
   * Enviar imagen
   */
  async sendImage(phoneNumber, imageBuffer, filename = 'image.png') {
    try {
      if (!this.sock || !this.connected) {
        logger.error('❌ No hay socket disponible o no está conectado');
        return false;
      }

      // Formatear número de teléfono
      let jid = phoneNumber;
      if (!jid.includes('@')) {
        jid = `${jid}@s.whatsapp.net`;
      }

      logger.info(`📤 Enviando imagen a ${jid}: ${filename}`);

      await this.sock.sendMessage(jid, {
        image: imageBuffer,
        caption: filename
      });

      logger.success(`✅ Imagen enviada a ${phoneNumber}`);
      return true;

    } catch (error) {
      logger.error('❌ Error al enviar imagen:', error);
      return false;
    }
  }

  /**
   * Obtener estado del bot
   */
  getStatus() {
    return {
      connected: this.connected,
      isConnecting: this.isConnecting,
      messageHandlersConfigured: this.messageHandlersConfigured,
      hasQr: !!this.qrCode
    };
  }

  /**
   * Verificar si está conectado
   */
  isConnected() {
    return this.connected && !!this.sock;
  }

  /**
   * Desconectar
   */
  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.end();
        this.sock = null;
      }
      this.connected = false;
      this.isConnecting = false;
      this.messageHandlersConfigured = false;
      logger.info('✅ WhatsApp desconectado');
    } catch (error) {
      logger.error('❌ Error al desconectar:', error);
    }
  }
}

module.exports = new WhatsAppHandler();

