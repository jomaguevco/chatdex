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

          // Configurar handlers de mensajes
          if (!this.messageHandlersConfigured) {
            logger.info('📡 Configurando handlers de mensajes...');
            await this.setupMessageHandlers();
          }
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

        logger.info(`✅ Procesando ${messages.length} mensaje(s)...`);

        for (const message of messages) {
          try {
            // Ignorar mensajes del propio bot
            if (message.key.fromMe) {
              logger.debug('⚠️ Ignorando mensaje del propio bot');
              continue;
            }

            // Ignorar mensajes de grupos
            if (message.key.remoteJid?.includes('@g.us')) {
              logger.debug('⚠️ Ignorando mensaje de grupo');
              continue;
            }

            // Log visible
            console.log('\n');
            console.log('═'.repeat(70));
            console.log('📩 ========== MENSAJE RECIBIDO ==========');
            console.log('═'.repeat(70));
            console.log('📩 HORA: ' + new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }));
            console.log('📩 FROM: ' + (message.key.remoteJid || 'N/A'));
            console.log('📩 FROM ME: ' + (message.key.fromMe ? 'SÍ' : 'NO'));
            console.log('📩 IS GROUP: ' + (message.key.remoteJid?.includes('@g.us') ? 'SÍ' : 'NO'));
            console.log('📩 TYPE: ' + (message.message ? Object.keys(message.message)[0] : 'text'));
            console.log('═'.repeat(70));
            console.log('\n');

            logger.info('📩 ========== MENSAJE RECIBIDO ==========');
            logger.info('📩 HORA: ' + new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }));

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
                await this.processVoiceMessageBaileys(phoneForSearch, audioMessage, remoteJid);
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
    try {
      const PhoneNormalizer = require('./utils/phoneNormalizer');
      const kardexApi = require('./kardexApi');
      const kardexDb = require('./kardexDb');
      const smsService = require('./services/smsService');
      
      // Usar remoteJid original si está disponible
      const jidToUse = remoteJid || (phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`);
      
      // Obtener o crear sesión
      let session = await sessionManager.getSession(phoneNumber);
      if (!session) {
        session = await sessionManager.createSession(phoneNumber);
      }
      
      const stateObj = session.current_order ? JSON.parse(session.current_order) : {};
      const currentState = session.state || sessionManager.STATES.IDLE;
      
      logger.info(`📱 Procesando mensaje - Estado actual: ${currentState}`);
      
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
          
          const textLower = correctedText.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const yesKeywords = ['si', 'sí', 's', 'yes', 'y', 'cliente', 'registrado', 'tengo cuenta', 'ya tengo', 'correcto', 'si soy', 'si estoy'];
          const noKeywords = ['no', 'n', 'tampoco', 'no soy', 'no estoy', 'todavia no', 'todavía no', 'aun no', 'aún no'];
          
          // Detección mejorada: usar detector de intenciones + keywords
          const isYes = intentResult.intent === 'yes' || yesKeywords.some(keyword => 
            textLower === keyword || textLower.startsWith(keyword) || textLower.includes(keyword)
          );
          const isNo = intentResult.intent === 'no' || noKeywords.some(keyword => 
            textLower === keyword || textLower.startsWith(keyword) || textLower.includes(keyword)
          );
          
          if (isYes) {
            // Usuario es cliente, pedir número
            await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PHONE, {});
            await this.sendMessage(jidToUse,
              `✅ Perfecto, eres cliente registrado.\n\n` +
              `📞 Por favor, ingresa tu *número de teléfono* (9 dígitos):\n\n` +
              `Ejemplo: *987654321* o *51987654321*`
            );
            return;
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
      
      // NO considerar "no" como cancelación si está en estado de confirmación de cliente
      const isCancelCommand = currentState === sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION 
        ? false 
        : cancelKeywords.some(keyword => textLower.includes(keyword));
      
      if (isCancelCommand && currentState !== sessionManager.STATES.IDLE && currentState !== sessionManager.STATES.AWAITING_CLIENT_CONFIRMATION) {
        // Cancelar operación actual y volver al inicio
        await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {});
        await this.sendMessage(jidToUse,
          `👋 *Entendido, operación cancelada.* 👋\n\n` +
          `🔄 He vuelto al menú principal. ¿En qué puedo ayudarte?\n\n` +
          `💡 Escribe *HOLA* para comenzar o ver las opciones disponibles.`
        );
        return;
      }
      
      // FLUJO 1: Si está esperando número de teléfono
      if (currentState === sessionManager.STATES.AWAITING_PHONE) {
        const phoneInput = PhoneNormalizer.normalize(text);
        if (!PhoneNormalizer.isValidPeruvianPhone(phoneInput)) {
          await this.sendMessage(jidToUse, 
            '❌ El número de teléfono no es válido. Por favor, ingresa un número de 9 dígitos (ejemplo: 987654321) o con código de país (51987654321).'
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
            `Para acceder a tu cuenta y ver tus pedidos, por favor ingresa tu *contraseña* de la página web.\n\n` +
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
        const textLower = text.toLowerCase().trim();
        
        // Detectar si el usuario dice que olvidó su contraseña
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
          
          // Intentar enviar SMS
          const smsSent = await smsService.sendVerificationCode(clientPhone, smsCode);
          
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
              `🔢 Por favor, ingresa el código que recibiste por SMS:\n\n` +
              `⏰ *El código expira en 10 minutos.*\n\n` +
              `❌ Si no recibiste el código, escribe *CANCELAR* y contacta con soporte.`
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
        const password = text.trim();
        const clientPhone = stateObj._client_phone || phoneNumber;
        
        const verifyResult = await kardexApi.verifyClientPassword(clientPhone, password);
        
        if (verifyResult.success) {
          // Contraseña correcta, usuario autenticado
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.IDLE, {
            _authenticated: true,
            _client_id: verifyResult.cliente.id,
            _client_name: verifyResult.cliente.nombre,
            _user_token: verifyResult.token
          });
          
          await this.sendMessage(jidToUse,
            `✅ *¡Bienvenido *${verifyResult.cliente.nombre}*!* ✅\n\n` +
            `🎯 *¿Qué deseas hacer hoy?*\n\n` +
            `🛍️ Ver catálogo: escribe *CATALOGO*\n` +
            `🛒 Hacer pedido: escribe tu pedido\n` +
            `📊 Ver mis pedidos: escribe *MIS PEDIDOS*\n` +
            `❓ Ayuda: escribe *AYUDA*`
          );
          return;
        } else {
          await this.sendMessage(jidToUse,
            `❌ Contraseña incorrecta.\n\n` +
            `Si olvidaste tu contraseña, escribe *"olvidé mi contraseña"* y te enviaremos un código de verificación por SMS.\n\n` +
            `O escribe *CANCELAR* para volver al inicio.`
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
              `🔐 *Para acceder a tu cuenta, ingresa tu contraseña:*\n\n` +
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
        const phoneInput = PhoneNormalizer.normalize(text);
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
              `Para acceder a tu cuenta y ver tus pedidos, por favor ingresa tu *contraseña* de la página web.\n\n` +
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
              `Para acceder a tu cuenta y ver tus pedidos, por favor ingresa tu *contraseña* de la página web.\n\n` +
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
        
        // SIEMPRE preguntar primero si es cliente registrado cuando no está autenticado
        // Esto debe ocurrir ANTES de procesar cualquier otro mensaje (incluyendo respuestas de NLU)
        // No importa si NLU detectó algo o no, primero necesitamos saber si es cliente
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
      const nluResult = await nlu.processMessage(text, sessionStateWithPhone, conversationHistory, false);
      
      logger.info(`🔍 NLU detectó: intent=${nluResult.intent}, tiene response=${!!nluResult.response}`);

      // Manejar respuesta del NLU
      if (nluResult.response) {
        // Si tiene acción, manejarla (pasar jidToUse en lugar de phoneNumber)
        if (nluResult.response.action) {
          await this.handleAction(jidToUse, nluResult.response.action, nluResult.response, sessionStateWithPhone);
        } 
        // Si tiene mensaje, enviarlo
        else if (nluResult.response.message) {
          await this.sendMessage(jidToUse, nluResult.response.message);
          // Guardar respuesta del bot en historial
          await sessionManager.saveMessage(phoneNumber, 'text', nluResult.response.message, true);
        }
        // Si tiene productos (catálogo), enviar mensaje formateado
        else if (nluResult.response.productos) {
          await this.sendMessage(jidToUse, nluResult.response.message || 'Catálogo de productos');
          await sessionManager.saveMessage(phoneNumber, 'text', nluResult.response.message || 'Catálogo de productos', true);
        }
      } else {
        // Si no hay respuesta, dar opciones útiles sin decir "no entendí"
        logger.warn('⚠️ NLU no devolvió respuesta, dando opciones útiles');
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
      }

    } catch (error) {
      logger.error('❌ Error al procesar mensaje de texto:', error);
      logger.error('Stack:', error.stack?.substring(0, 500));
      
      const jidToUse = remoteJid || (phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`);
      
      // Intentar recuperación inteligente
      try {
        // Si hay un error crítico, intentar detectar qué quería el usuario
        const intentDetector = require('./utils/intentDetector');
        const fallbackIntent = await intentDetector.detectIntent(text, { state: currentState }, []);
        
        logger.info(`[Recovery] Detectando intención de fallback: ${fallbackIntent.intent}`);
        
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
          } else if (fallbackIntent.intent === 'greeting') {
            await this.sendMessage(jidToUse,
              `👋 *¡Hola! ¡Bienvenido a KARDEX!* 👋\n\n` +
              `❓ *¿Eres cliente registrado?*\n\n` +
              `Responde:\n` +
              `• *SÍ* si ya tienes una cuenta registrada\n` +
              `• *NO* si no tienes cuenta`
            );
          } else {
            // Respuesta genérica pero útil
            await this.sendMessage(jidToUse,
              `😅 Hubo un problema al procesar tu mensaje.\n\n` +
              `Por favor, intenta de nuevo o escribe *AYUDA* para ver las opciones disponibles.\n\n` +
              `💡 Si el problema persiste, intenta reformular tu mensaje.`
            );
          }
        } else {
          // Si no se puede detectar, mensaje genérico pero amigable
          await this.sendMessage(jidToUse, 
            `😅 Lo siento, hubo un error al procesar tu mensaje.\n\n` +
            `💡 Por favor intenta:\n` +
            `• Reformular tu mensaje\n` +
            `• Escribir *AYUDA* para ver opciones\n` +
            `• O enviar un mensaje de texto más claro\n\n` +
            `🔄 Si el problema persiste, intenta de nuevo en unos momentos.`
          );
        }
      } catch (recoveryError) {
        logger.error('❌ Error en recuperación:', recoveryError);
        // Último fallback: mensaje simple
        try {
          await this.sendMessage(jidToUse, 
            `😅 Lo siento, hubo un error. Por favor intenta de nuevo o escribe *AYUDA*.`
          );
        } catch (sendError) {
          logger.error('❌ Error crítico: No se pudo enviar mensaje de error', sendError);
        }
      }
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
    let audioPath = null;
    try {
      // Usar remoteJid original si está disponible, de lo contrario construir JID
      const jidToUse = remoteJid || (phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`);
      
      logger.info('🎤 Procesando mensaje de voz...');
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

      // Mostrar al usuario qué entendió el bot (mejora la experiencia)
      await this.sendMessage(jidToUse, `🎤 Entendí: "${transcription}"`);

      // Guardar transcripción en historial
      await sessionManager.saveMessage(phoneNumber, 'voice', transcription, false);

      // Obtener sesión e historial
      let session = await sessionManager.getSession(phoneNumber);
      if (!session) {
        session = await sessionManager.createSession(phoneNumber);
      }
      const conversationHistory = await sessionManager.getConversationHistory(phoneNumber, 10);
      
      const stateObj = session.current_order ? JSON.parse(session.current_order) : {};
      const currentState = session.state || sessionManager.STATES.IDLE;
      
      // PRIORIDAD ABSOLUTA 0: Si es CONFIRMO, procesar confirmación DIRECTAMENTE
      const confirmPattern = /(?:confirmo|confirmar|confirma|si|sí|ok|okay|acepto|aceptar|yes)/i;
      const isConfirm = confirmPattern.test(transcription) && transcription.length < 20; // Solo si es corto (no análisis)
      
      if (isConfirm && (currentState === sessionManager.STATES.PEDIDO_EN_PROCESO || currentState === sessionManager.STATES.AWAITING_CONFIRMATION)) {
        logger.info('✅ PRIORIDAD: Confirmación de pedido detectada');
        try {
          const orderHandler = require('./orderHandler');
          const sessionStateWithPhone = { 
            state: currentState,
            phoneNumber,
            nombreCliente: 'Cliente',
            remoteJid: jidToUse,
            authenticated: stateObj._authenticated || false,
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
      const orderPattern = /(?:quiero hacer un pedido|quiero hacer pedido|quiero pedir|vamos a hacer un pedido|vamos a hacer pedido|vamos a pedir|va a ser un pedido|va a ser pedido|ser un pedido|ser pedido|necesito|quiero comprar|quiero|dame|deme|pedir|hacer pedido|comprar|ordenar|hacer una compra|hacer compra|necesito comprar|necesito pedir|pedidoss|pedidos)/i;
      const isOrder = orderPattern.test(transcription);
      
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
                const cantidad = 1; // Por defecto 1, el usuario puede cambiar después
                
                // Agregar producto al pedido
                await orderHandler.addProductToOrder(
                  phoneNumber, 
                  producto.id, 
                  cantidad, 
                  producto.nombre, 
                  this // whatsappHandler
                );
                
                await this.sendMessage(jidToUse,
                  `🛒 *Pedido iniciado*\n\n` +
                  `Producto: *${producto.nombre}*\n` +
                  `Cantidad: *${cantidad}*\n` +
                  `Precio unitario: *S/ ${precio}*\n` +
                  `Stock disponible: *${stock} unidades*\n\n` +
                  `💬 ¿Confirmas este pedido? Responde *CONFIRMO* para continuar.`
                );
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
                  await orderHandler.addProductToOrder(phoneNumber, producto.id, 1, producto.nombre, this);
                  
                  await this.sendMessage(jidToUse,
                    `🛒 *Pedido iniciado*\n\n` +
                    `Producto: *${producto.nombre}*\n` +
                    `Cantidad: *1*\n` +
                    `Precio unitario: *S/ ${precio}*\n` +
                    `Stock disponible: *${stock} unidades*\n\n` +
                    `💬 ¿Confirmas este pedido? Responde *CONFIRMO* para continuar.`
                  );
                  return;
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
        const transcriptionLowerForYesNo = transcription.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const yesKeywords = ['si', 'sí', 's', 'yes', 'y', 'cliente', 'registrado', 'tengo cuenta', 'ya tengo'];
        const noKeywords = ['no', 'n', 'tampoco', 'no soy', 'no estoy'];
        
        const isYes = yesKeywords.some(keyword => transcriptionLowerForYesNo === keyword || transcriptionLowerForYesNo.includes(keyword));
        const isNo = noKeywords.some(keyword => transcriptionLowerForYesNo === keyword || transcriptionLowerForYesNo.includes(keyword));
        
        if (isYes) {
          // Usuario es cliente, pedir número
          await sessionManager.updateSessionState(phoneNumber, sessionManager.STATES.AWAITING_PHONE, {});
          await this.sendMessage(jidToUse,
            `✅ Perfecto, eres cliente registrado.\n\n` +
            `📞 Por favor, ingresa tu *número de teléfono* (9 dígitos):\n\n` +
            `Ejemplo: *987654321* o *51987654321*`
          );
          return;
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
      
      // FLUJO ESPECIAL: Si está esperando contraseña y dice que olvidó su contraseña
      if (currentState === sessionManager.STATES.AWAITING_PASSWORD) {
        // Detectar si el usuario dice que olvidó su contraseña
        const transcriptionLower = transcription.toLowerCase().trim();
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
          
          // Intentar enviar SMS
          const smsSent = await smsService.sendVerificationCode(clientPhone, smsCode);
          
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
              `🔢 Por favor, ingresa el código que recibiste por SMS:\n\n` +
              `⏰ *El código expira en 10 minutos.*\n\n` +
              `❌ Si no recibiste el código, escribe *CANCELAR* y contacta con soporte.`
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
        
        // Si no es "olvidé contraseña", tratar como contraseña normal
        // El flujo normal lo manejará después con NLU
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
            `Para acceder a tu cuenta y ver tus pedidos, por favor ingresa tu *contraseña* de la página web.\n\n` +
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
        // SIEMPRE preguntar primero si es cliente registrado cuando no está autenticado
        // Esto debe ocurrir ANTES de procesar cualquier otro mensaje (incluyendo voz)
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
      
      let nluResult;
      try {
        nluResult = await nlu.processMessage(transcription, sessionStateWithPhone, conversationHistory, true);
        logger.info(`🔍 NLU procesó voz: intent=${nluResult.intent}, tiene response=${!!nluResult.response}`);
        
        // Si no hay resultado o respuesta, usar IA conversacional directamente
        if (!nluResult || !nluResult.response) {
          logger.warn('⚠️ NLU no devolvió respuesta, usando IA conversacional');
          try {
            const conversationalResponse = await conversationalAI.generateResponse(
              transcription,
              sessionStateWithPhone,
              conversationHistory,
              'unknown'
            );
            
            if (conversationalResponse) {
              await this.sendMessage(jidToUse, conversationalResponse);
              await sessionManager.saveMessage(phoneNumber, 'text', conversationalResponse, true);
              return;
            }
          } catch (convError) {
            logger.warn('Error en IA conversacional, intentando procesar como texto', convError);
          }
          
          // Si la IA conversacional también falla, procesar como texto normal
          await this.processTextMessage(phoneNumber, transcription, remoteJid);
          return;
        }
      } catch (nluError) {
        logger.error('❌ Error en NLU, usando IA conversacional como fallback', {
          error: nluError.message,
          stack: nluError.stack?.substring(0, 300),
          transcription
        });
        
        // Si falla el NLU, usar IA conversacional directamente
        try {
          const conversationalResponse = await conversationalAI.generateResponse(
            transcription,
            sessionStateWithPhone,
            conversationHistory,
            'unknown'
          );
          
          if (conversationalResponse) {
            logger.success('✅ Respuesta generada por IA conversacional (fallback)');
            await this.sendMessage(jidToUse, conversationalResponse);
            await sessionManager.saveMessage(phoneNumber, 'text', conversationalResponse, true);
            return;
          }
        } catch (convError) {
          logger.warn('Error en IA conversacional, intentando procesar como texto', convError);
        }
        
        // Si la IA conversacional también falla, procesar como mensaje de texto normal
        try {
          await this.processTextMessage(phoneNumber, transcription, remoteJid);
        } catch (textError) {
          logger.error('❌ Error al procesar como texto también', textError);
          // Último fallback: respuesta básica
          await this.sendMessage(jidToUse, 
            `👋 ¡Hola! 👋\n\n` +
            `Entendí: "${transcription}"\n\n` +
            `¿En qué puedo ayudarte? Puedo ayudarte con productos, pedidos o cualquier consulta. 😊`
          );
        }
        return;
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
      logger.error('❌ Error al procesar mensaje de voz:', {
        error: error.message,
        stack: error.stack?.substring(0, 500),
        audioPath: audioPath || 'N/A',
        transcription: typeof transcription !== 'undefined' ? transcription : 'N/A'
      });
      
      // Limpiar archivo temporal si existe
      if (audioPath) {
        await fs.unlink(audioPath).catch(() => {});
      }
      
      // Intentar recuperación inteligente
      const jidToUse = remoteJid || (phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`);
      
      try {
        // Si tenemos una transcripción (incluso parcial), intentar procesarla
        if (typeof transcription !== 'undefined' && transcription && transcription.trim().length > 0) {
          logger.info(`[Recovery] Intentando procesar transcripción: "${transcription}"`);
          
          // Intentar procesar como mensaje de texto normal
          try {
            await this.processTextMessage(phoneNumber, transcription, remoteJid);
            logger.info('[Recovery] ✅ Transcripción procesada exitosamente como texto');
            return; // Salir sin mostrar error
          } catch (textProcessError) {
            logger.warn('[Recovery] Error al procesar transcripción como texto, intentando con intentDetector', textProcessError);
            
            // Intentar con intentDetector como último recurso
            const intentDetector = require('./utils/intentDetector');
            const session = await sessionManager.getSession(phoneNumber).catch(() => null);
            const stateObj = session?.current_order ? JSON.parse(session.current_order) : {};
            
            const fallbackIntent = await intentDetector.detectIntent(transcription, { 
              state: session?.state || 'idle',
              ...stateObj 
            }, []);
            
            if (fallbackIntent.intent !== 'unknown' && fallbackIntent.confidence > 0.4) {
              logger.info(`[Recovery] Intención detectada: ${fallbackIntent.intent}`);
              // Procesar como mensaje de texto normal
              await this.processTextMessage(phoneNumber, transcription, remoteJid).catch(() => {});
              return; // Salir sin mostrar error
            }
          }
        }
        
        // Si no hay transcripción o no se pudo procesar, mensaje de error amigable
        await this.sendMessage(jidToUse, 
          `😅 Lo siento, no pude procesar tu mensaje de voz en este momento.\n\n` +
          `💡 Por favor intenta:\n` +
          `• Grabar el audio nuevamente (habla más claro y cerca del micrófono)\n` +
          `• Enviar un mensaje de texto en su lugar\n` +
          `• Escribir *AYUDA* para ver las opciones disponibles\n\n` +
          `🔄 Si el problema persiste, intenta de nuevo en unos momentos.`
        );
      } catch (recoveryError) {
        logger.error('❌ Error en recuperación de voz:', recoveryError);
        // Último fallback
        try {
          await this.sendMessage(jidToUse, 
            `😅 Lo siento, hubo un error. Por favor intenta enviar un mensaje de texto o escribe *AYUDA*.`
          );
        } catch (sendError) {
          logger.error('❌ Error crítico: No se pudo enviar mensaje de error', sendError);
        }
      }
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
    try {
      if (!this.sock || !this.connected) {
        logger.error('❌ No hay socket disponible o no está conectado');
        return false;
      }

      // Si ya es un JID completo (contiene @), usarlo directamente
      // Si no, construir el JID
      let jid = phoneNumberOrJid;
      if (!jid.includes('@')) {
        jid = `${jid}@s.whatsapp.net`;
      }

      logger.info(`📤 Enviando mensaje a ${jid}: ${text.substring(0, 50)}...`);

      await this.sock.sendMessage(jid, { text });

      logger.success(`✅ Mensaje enviado a ${jid}`);
      return true;

    } catch (error) {
      logger.error('❌ Error al enviar mensaje:', error);
      logger.error(`   Intentó enviar a: ${phoneNumberOrJid}`);
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

