const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('../config/config');
const logger = require('./utils/logger');

class Database {
  constructor() {
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      // Asegurar que el directorio de datos exista
      const fs = require('fs');
      const dataDir = path.join(__dirname, '..', config.paths.data);
      
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const dbPath = path.join(dataDir, 'chatbot.db');
      
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          logger.error('Error al conectar con la base de datos', err);
          reject(err);
        } else {
          logger.success('Base de datos SQLite conectada');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [
      // Tabla de sesiones de chat
      `CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT UNIQUE NOT NULL,
        state TEXT DEFAULT 'idle',
        current_order TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      )`,
      
      // Tabla de pedidos pendientes
      `CREATE TABLE IF NOT EXISTS pending_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        phone_number TEXT NOT NULL,
        products TEXT NOT NULL,
        total REAL NOT NULL,
        delivery_address TEXT,
        delivery_date TEXT,
        payment_method TEXT,
        status TEXT DEFAULT 'pending',
        kardex_order_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )`,
      
      // Tabla de historial de mensajes
      `CREATE TABLE IF NOT EXISTS message_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL,
        message_type TEXT NOT NULL,
        message_content TEXT,
        is_bot BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Tabla de métricas
      `CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_type TEXT NOT NULL,
        metric_value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await this.run(sql);
    }
    
    logger.success('Tablas de base de datos creadas/verificadas');
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Error en query SQL', { sql, error: err });
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Error en query SQL', { sql, error: err });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Error en query SQL', { sql, error: err });
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          logger.info('Base de datos cerrada');
          resolve();
        }
      });
    });
  }
}

module.exports = new Database();

