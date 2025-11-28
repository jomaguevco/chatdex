const db = require('./db');
const config = require('../config/config');
const logger = require('./utils/logger');

class SessionManager {
  /**
   * Estados posibles de una sesión
   */
  static STATES = {
    IDLE: 'idle',
    AWAITING_CLIENT_CONFIRMATION: 'awaiting_client_confirmation', // Esperando confirmación si es cliente registrado
    AWAITING_PHONE: 'awaiting_phone', // Esperando número de teléfono
    AWAITING_PASSWORD: 'awaiting_password', // Esperando contraseña para usuarios registrados
    AWAITING_REGISTRATION: 'awaiting_registration', // Esperando registro completo
    AWAITING_REG_NAME: 'awaiting_reg_name', // Esperando nombre para registro
    AWAITING_REG_DNI: 'awaiting_reg_dni', // Esperando DNI para registro
    AWAITING_REG_EMAIL: 'awaiting_reg_email', // Esperando email para registro
    AWAITING_REG_PASSWORD: 'awaiting_reg_password', // Esperando contraseña para registro
    AWAITING_ORDER: 'awaiting_order',
    ORDER_PENDING: 'order_pending',
    AWAITING_CONFIRMATION: 'awaiting_confirmation',
    PEDIDO_EN_PROCESO: 'pedido_en_proceso',
    PEDIDO_CREADO: 'pedido_creado',
    AWAITING_PAYMENT_METHOD: 'awaiting_payment_method', // Esperando método de pago (transferencia, efectivo, yape, plin)
    AWAITING_PAYMENT: 'awaiting_payment',
    PAGO_CONFIRMADO: 'pago_confirmado',
    COMPLETED: 'completed',
    AWAITING_TEMP_NAME: 'awaiting_temp_name', // Para pedidos temporales: esperando nombre
    AWAITING_TEMP_DNI: 'awaiting_temp_dni', // Para pedidos temporales: esperando DNI
    AWAITING_SMS_CODE: 'awaiting_sms_code', // Esperando código de verificación SMS
    AWAITING_CANCEL_CONFIRMATION: 'awaiting_cancel_confirmation', // Esperando confirmación para cancelar pedido confirmado
    AWAITING_UPDATE_TELEFONO: 'awaiting_update_telefono', // Esperando actualizar teléfono
    AWAITING_UPDATE_DIRECCION: 'awaiting_update_direccion', // Esperando actualizar dirección
    AWAITING_UPDATE_EMAIL: 'awaiting_update_email' // Esperando actualizar email
  };

  /**
   * Obtener o crear sesión
   */
  async getSession(phoneNumber) {
    try {
      let session = await db.get(
        'SELECT * FROM sessions WHERE phone_number = ?',
        [phoneNumber]
      );

      if (!session) {
        const result = await db.run(
          'INSERT INTO sessions (phone_number, state, created_at, updated_at) VALUES (?, ?, datetime("now"), datetime("now"))',
          [phoneNumber, SessionManager.STATES.IDLE]
        );

        session = await db.get(
          'SELECT * FROM sessions WHERE id = ?',
          [result.id]
        );

        logger.info(`Nueva sesión creada para ${phoneNumber}`);
      }

      return session;
    } catch (error) {
      logger.error('Error al obtener sesión', error);
      throw error;
    }
  }

  /**
   * Crear nueva sesión
   */
  async createSession(phoneNumber) {
    try {
      const result = await db.run(
        'INSERT INTO sessions (phone_number, state, created_at, updated_at) VALUES (?, ?, datetime("now"), datetime("now"))',
        [phoneNumber, SessionManager.STATES.IDLE]
      );

      const session = await db.get(
        'SELECT * FROM sessions WHERE id = ?',
        [result.id]
      );

      logger.info(`Nueva sesión creada para ${phoneNumber}`);
      return session;
    } catch (error) {
      logger.error('Error al crear sesión', error);
      throw error;
    }
  }

  /**
   * Actualizar estado de la sesión
   */
  async updateSessionState(phoneNumber, newState, orderData = null) {
    try {
      const expiresAt = new Date(Date.now() + config.bot.confirmationTimeout);
      
      await db.run(
        `UPDATE sessions 
         SET state = ?, current_order = ?, updated_at = datetime("now"), expires_at = ? 
         WHERE phone_number = ?`,
        [newState, orderData ? JSON.stringify(orderData) : null, expiresAt.toISOString(), phoneNumber]
      );

      logger.info(`Sesión actualizada: ${phoneNumber} -> ${newState}`);
    } catch (error) {
      logger.error('Error al actualizar sesión', error);
      throw error;
    }
  }

  /**
   * Obtener pedido pendiente de la sesión
   */
  async getPendingOrder(phoneNumber) {
    try {
      const session = await this.getSession(phoneNumber);
      
      if (session.current_order) {
        return JSON.parse(session.current_order);
      }
      
      return null;
    } catch (error) {
      logger.error('Error al obtener pedido pendiente', error);
      return null;
    }
  }

  /**
   * Limpiar sesión (después de completar o cancelar)
   */
  async clearSession(phoneNumber) {
    try {
      await db.run(
        `UPDATE sessions 
         SET state = ?, current_order = NULL, updated_at = datetime("now"), expires_at = NULL 
         WHERE phone_number = ?`,
        [SessionManager.STATES.IDLE, phoneNumber]
      );

      logger.info(`Sesión limpiada: ${phoneNumber}`);
    } catch (error) {
      logger.error('Error al limpiar sesión', error);
    }
  }

  /**
   * Crear pedido pendiente
   */
  async createPendingOrder(phoneNumber, orderData) {
    try {
      const session = await this.getSession(phoneNumber);
      
      const result = await db.run(
        `INSERT INTO pending_orders 
         (session_id, phone_number, products, total, delivery_address, delivery_date, payment_method, status, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))`,
        [
          session.id,
          phoneNumber,
          JSON.stringify(orderData.productos),
          orderData.total,
          orderData.direccion,
          orderData.fecha,
          orderData.metodoPago || 'YAPE',
          'pending'
        ]
      );

      logger.success(`Pedido pendiente creado: ${result.id}`);
      return result.id;
    } catch (error) {
      logger.error('Error al crear pedido pendiente', error);
      throw error;
    }
  }

  /**
   * Actualizar pedido pendiente
   */
  async updatePendingOrder(orderId, updates) {
    try {
      const setClause = Object.keys(updates)
        .map(key => `${key} = ?`)
        .join(', ');
      
      const values = [...Object.values(updates), orderId];
      
      await db.run(
        `UPDATE pending_orders SET ${setClause}, updated_at = datetime("now") WHERE id = ?`,
        values
      );

      logger.info(`Pedido pendiente actualizado: ${orderId}`);
    } catch (error) {
      logger.error('Error al actualizar pedido pendiente', error);
    }
  }

  /**
   * Guardar mensaje en historial
   */
  async saveMessage(phoneNumber, messageType, content, isBot = false) {
    try {
      await db.run(
        `INSERT INTO message_history (phone_number, message_type, message_content, is_bot, created_at) 
         VALUES (?, ?, ?, ?, datetime("now"))`,
        [phoneNumber, messageType, content, isBot ? 1 : 0]
      );
    } catch (error) {
      logger.error('Error al guardar mensaje', error);
    }
  }

  /**
   * Obtener historial de conversación
   */
  async getConversationHistory(phoneNumber, limit = 10) {
    try {
      const messages = await db.all(
        `SELECT message_content as content, is_bot, created_at 
         FROM message_history 
         WHERE phone_number = ? 
         ORDER BY created_at DESC 
         LIMIT ?`,
        [phoneNumber, limit]
      );
      
      // Invertir para tener orden cronológico
      return messages.reverse().map(msg => ({
        content: msg.content,
        isBot: msg.is_bot === 1,
        timestamp: msg.created_at
      }));
    } catch (error) {
      logger.error('Error al obtener historial de conversación', error);
      return [];
    }
  }

  /**
   * Registrar métrica
   */
  async recordMetric(metricType, value) {
    try {
      await db.run(
        `INSERT INTO metrics (metric_type, metric_value, created_at) 
         VALUES (?, ?, datetime("now"))`,
        [metricType, JSON.stringify(value)]
      );
    } catch (error) {
      logger.error('Error al registrar métrica', error);
    }
  }

  /**
   * Limpiar sesiones expiradas
   */
  async cleanExpiredSessions() {
    try {
      const result = await db.run(
        `UPDATE sessions 
         SET state = ?, current_order = NULL 
         WHERE expires_at < datetime("now") AND state != ?`,
        [SessionManager.STATES.IDLE, SessionManager.STATES.IDLE]
      );

      if (result.changes > 0) {
        logger.info(`${result.changes} sesiones expiradas limpiadas`);
      }
    } catch (error) {
      logger.error('Error al limpiar sesiones expiradas', error);
    }
  }

  /**
   * Obtener pedido activo desde la sesión
   */
  async getActiveOrderId(phoneNumber) {
    try {
      const session = await this.getSession(phoneNumber);
      if (session.current_order) {
        const orderData = JSON.parse(session.current_order);
        return orderData.pedido_id || null;
      }
      return null;
    } catch (error) {
      logger.error('Error al obtener pedido activo', error);
      return null;
    }
  }

  /**
   * Guardar pedido activo en sesión
   */
  async setActiveOrder(phoneNumber, pedidoId, numeroPedido) {
    try {
      await this.updateSessionState(
        phoneNumber,
        SessionManager.STATES.PEDIDO_EN_PROCESO,
        {
          pedido_id: pedidoId,
          numero_pedido: numeroPedido,
          productos: [],
          total: 0
        }
      );
      logger.info(`Pedido activo guardado: ${numeroPedido} (ID: ${pedidoId})`);
    } catch (error) {
      logger.error('Error al guardar pedido activo', error);
      throw error;
    }
  }
}

// Exportar instancia y clase para acceso a STATES
const instance = new SessionManager();
instance.STATES = SessionManager.STATES; // Agregar STATES a la instancia
module.exports = instance;

