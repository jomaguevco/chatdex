const axios = require('axios');
const logger = require('./logger');
const config = require('../../config/config');

class OllamaClient {
  constructor() {
    this.baseUrl = config.ollama.baseUrl || 'http://localhost:11434';
    this.model = config.ollama.model || 'phi3:mini';
    this.timeout = config.ollama.timeout || 10000;
    this.temperature = config.ollama.temperature || 0.3;
  }

  /**
   * Verificar si Ollama está disponible
   */
  async isAvailable() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 2000
      });
      return response.status === 200;
    } catch (error) {
      logger.warn('Ollama no está disponible', error.message);
      return false;
    }
  }

  /**
   * Generar respuesta usando Ollama
   */
  async generate(prompt, systemPrompt = null, options = {}) {
    const attempt = async (tryNum) => {
      try {
      const requestBody = {
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: options.temperature || this.temperature,
          top_p: options.top_p || 0.9,
          top_k: options.top_k || 40
        }
      };

      if (systemPrompt) {
        requestBody.system = systemPrompt;
      }

      logger.debug('Enviando solicitud a Ollama', {
        model: this.model,
        promptLength: prompt.length,
        hasSystemPrompt: !!systemPrompt
      });

      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        requestBody,
        {
          timeout: options.timeout || this.timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.response) {
        logger.success('Respuesta recibida de Ollama', {
          responseLength: response.data.response.length,
          model: response.data.model
        });
        return response.data.response.trim();
      }

      throw new Error('Respuesta inválida de Ollama');
      } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logger.error('Ollama no está corriendo. Inicia el servicio con: brew services start ollama');
        throw new Error('Ollama no está disponible. Por favor, inicia el servicio.');
      }
      
      if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        logger.error('Timeout al generar con Ollama', error.message);
        if (tryNum < 2) {
          const backoff = 1000 * (tryNum + 1);
          logger.warn(`Reintentando Ollama en ${backoff}ms (intento ${tryNum + 1}/3)`);
          await new Promise(r => setTimeout(r, backoff));
          return attempt(tryNum + 1);
        }
        throw new Error('El procesamiento tardó demasiado. Por favor, intenta de nuevo.');
      }

      logger.error('Error al generar con Ollama', {
        error: error.message,
        code: error.code,
        response: error.response?.data
      });
      throw error;
      }
    };
    return attempt(0);
  }

  /**
   * Generar respuesta en formato JSON
   */
  async generateJSON(prompt, systemPrompt = null, options = {}) {
    try {
      const jsonPrompt = `${prompt}\n\nResponde SOLO con un JSON válido, sin texto adicional.`;
      const response = await this.generate(jsonPrompt, systemPrompt, options);
      
      // Intentar extraer JSON de la respuesta
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Si no hay match, intentar parsear directamente
      return JSON.parse(response);
    } catch (error) {
      logger.error('Error al parsear JSON de Ollama', error);
      throw new Error('No se pudo obtener una respuesta válida del modelo');
    }
  }

  /**
   * Verificar si el modelo está disponible
   */
  async checkModel() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 2000
      });
      
      if (response.data && response.data.models) {
        const modelExists = response.data.models.some(
          m => m.name === this.model || m.name.startsWith(this.model)
        );
        
        if (!modelExists) {
          logger.warn(`Modelo ${this.model} no encontrado. Ejecuta: ollama pull ${this.model}`);
          return false;
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Error al verificar modelo', error);
      return false;
    }
  }
}

module.exports = new OllamaClient();

