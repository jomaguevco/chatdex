const moment = require('moment-timezone');
const config = require('../../config/config');
const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.timezone = config.bot.timezone;
    this.logFile = path.join(__dirname, '..', '..', 'logs', 'bot.log');
    this.errorLogFile = path.join(__dirname, '..', '..', 'logs', 'errors.log');
    
    // Crear directorio de logs si no existe
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  _getTimestamp() {
    return moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss');
  }

  _formatMessage(level, message, data = null) {
    const timestamp = this._getTimestamp();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
      try {
        logMessage += `\n${JSON.stringify(data, null, 2)}`;
      } catch (e) {
        logMessage += `\n[Error serializing data: ${e.message}]`;
      }
    }
    
    return logMessage;
  }

  _writeToFile(filePath, message) {
    try {
      fs.appendFileSync(filePath, message + '\n', 'utf8');
    } catch (e) {
      // Si falla escribir al archivo, solo usar console
      console.error('Error writing to log file:', e.message);
    }
  }

  info(message, data = null) {
    const logMessage = this._formatMessage('INFO', message, data);
    console.log(logMessage);
    this._writeToFile(this.logFile, logMessage);
  }

  error(message, error = null) {
    const errorData = error ? {
      message: error.message,
      stack: error.stack,
      ...error
    } : null;
    const logMessage = this._formatMessage('ERROR', message, errorData);
    console.error(logMessage);
    this._writeToFile(this.logFile, logMessage);
    this._writeToFile(this.errorLogFile, logMessage);
  }

  warn(message, data = null) {
    const logMessage = this._formatMessage('WARN', message, data);
    console.warn(logMessage);
    this._writeToFile(this.logFile, logMessage);
  }

  debug(message, data = null) {
    if (config.nodeEnv === 'development') {
      const logMessage = this._formatMessage('DEBUG', message, data);
      console.log(logMessage);
      this._writeToFile(this.logFile, logMessage);
    }
  }

  success(message, data = null) {
    const logMessage = this._formatMessage('✅ SUCCESS', message, data);
    console.log(logMessage);
    this._writeToFile(this.logFile, logMessage);
  }
}

module.exports = new Logger();

