require('dotenv').config();

module.exports = {
  // Servidor
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // KARDEX API
  kardexApi: {
    baseUrl: process.env.KARDEX_API_URL || 'https://kardexaplicacion.up.railway.app/api',
    authToken: process.env.KARDEX_AUTH_TOKEN || '',
    chatbotToken: process.env.CHATBOT_API_TOKEN || 'chatbot-secret-token-123',
    timeout: 10000 // 10 segundos
  },
  
  // KARDEX Database (MySQL direct connection)
  kardexDatabase: {
    host: process.env.KARDEX_DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: parseInt(process.env.KARDEX_DB_PORT || process.env.MYSQL_PORT || '3306'),
    database: process.env.KARDEX_DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
    user: process.env.KARDEX_DB_USER || process.env.MYSQL_USER || 'root',
    password: process.env.KARDEX_DB_PASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || ''
  },
  
  // Ollama (modelo local)
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'phi3:mini',
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '10000'),
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.3')
  },
  
  // Whisper (local para transcripción de voz)
  whisper: {
    model: process.env.WHISPER_MODEL || 'large-v3', // Modelo más preciso para español
    language: process.env.WHISPER_LANGUAGE || 'es',
    pythonPath: process.env.WHISPER_PYTHON_PATH || 'python3',
    temperature: parseFloat(process.env.WHISPER_TEMPERATURE || '0.0'), // 0.0 para más precisión
    beam_size: parseInt(process.env.WHISPER_BEAM_SIZE || '10'), // Mayor beam size para mejor reconocimiento (aumentado de 5 a 10)
    best_of: parseInt(process.env.WHISPER_BEST_OF || '5'), // Número de candidatos a evaluar
    use_api: process.env.WHISPER_USE_API === 'true', // Usar OpenAI API en lugar de local
    api_key: process.env.OPENAI_API_KEY || '', // API key de OpenAI (opcional)
    api_timeout: parseInt(process.env.WHISPER_API_TIMEOUT || '30000') // Timeout para API (30 segundos)
  },
  
  // Pago
  payment: {
    yape: {
      number: process.env.YAPE_NUMBER || '51956216912',
      name: process.env.YAPE_NAME || 'Tu Negocio'
    },
    plin: {
      number: process.env.PLIN_NUMBER || '51956216912'
    }
  },
  
  // Bot
  bot: {
    welcomeMessage: process.env.WELCOME_MESSAGE || '¡Hola! 👋 Soy el asistente virtual. ¿En qué puedo ayudarte?',
    confirmationTimeout: parseInt(process.env.CONFIRMATION_TIMEOUT || '10') * 60 * 1000, // minutos a milisegundos
    timezone: process.env.TIMEZONE || 'America/Lima'
  },
  
  // Rutas
  paths: {
    temp: './temp',
    qr: './qr',
    data: './data',
    tokens: './tokens'
  },
  
  // Audio
  audio: {
    maxSize: 16 * 1024 * 1024, // 16MB
    formats: ['ogg', 'opus', 'mp3', 'wav'],
    outputFormat: 'wav'
  },
  
  // Matching y NLU
  matching: {
    threshold: parseFloat(process.env.MATCH_THRESHOLD || '0.65'),
    phoneticWeight: parseFloat(process.env.PHONETIC_WEIGHT || '0.2')
  }
};

