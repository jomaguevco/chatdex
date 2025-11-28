const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('./utils/logger');
const audioConverter = require('./utils/audioConverter');
const axios = require('axios');
const FormData = require('form-data');

class WhisperTranscriber {
  constructor() {
    this.useAPI = config.whisper.use_api && config.whisper.api_key;
    if (this.useAPI) {
      logger.info('✅ Whisper configurado para usar OpenAI API (máxima precisión)');
    } else {
      logger.info('✅ Whisper local configurado');
    }
  }

  /**
   * Descargar/preparar el modelo al inicio para evitar fallos SSL en primer uso
   */
  async ensureReady() {
    try {
      logger.info('🧩 Preparando modelo de Whisper...');
      await this._warmupModel();
      logger.success('✅ Modelo de Whisper listo');
    } catch (error) {
      logger.warn('⚠️ Warmup de Whisper no completado, se intentará al vuelo', { error: error.message });
    }
  }

  /**
   * Transcribir audio (usa API si está configurada, sino usa local)
   */
  async transcribe(audioPath) {
    try {
      if (this.useAPI) {
        logger.info('🎤 Transcribiendo audio con OpenAI Whisper API (máxima precisión)...');
        return await this._transcribeWithAPI(audioPath);
      } else {
        logger.info('🎤 Transcribiendo audio con Whisper local...');
        return await this._transcribeWithLocalWhisper(audioPath);
      }
    } catch (error) {
      logger.error('Error en transcripción', error);
      
      // Si falla la API y hay fallback local, intentar con local
      if (this.useAPI && config.whisper.api_key) {
        logger.warn('⚠️ Falló transcripción con API, intentando con Whisper local como fallback...');
        try {
          return await this._transcribeWithLocalWhisper(audioPath);
        } catch (fallbackError) {
          logger.error('Error en transcripción local (fallback)', fallbackError);
        }
      }
      
      throw new Error('No se pudo transcribir el audio');
    }
  }
  
  /**
   * Transcribir usando OpenAI Whisper API (más preciso)
   */
  async _transcribeWithAPI(audioPath) {
    try {
      // Convertir a MP3 para mejor compatibilidad con OpenAI API
      let processedAudioPath = audioPath;
      if (!audioPath.endsWith('.mp3') && !audioPath.endsWith('.m4a') && !audioPath.endsWith('.wav')) {
        logger.info('🔄 Convirtiendo audio a MP3 para OpenAI API...');
        processedAudioPath = await audioConverter.convertToMp3(audioPath);
        logger.success('✅ Audio convertido a MP3');
      }
      
      const formData = new FormData();
      const audioFile = await fs.readFile(processedAudioPath);
      const contentType = processedAudioPath.endsWith('.mp3') ? 'audio/mpeg' : 
                         processedAudioPath.endsWith('.m4a') ? 'audio/mp4' : 
                         'audio/wav';
      
      formData.append('file', audioFile, {
        filename: path.basename(processedAudioPath),
        contentType: contentType
      });
      formData.append('model', 'whisper-1');
      formData.append('language', config.whisper.language);
      formData.append('response_format', 'text');
      formData.append('temperature', config.whisper.temperature.toString());
      formData.append('prompt', 'Esto es una conversación en español peruano sobre pedidos de productos. Habla de forma clara y natural.'); // Prompt para mejor reconocimiento
      
      logger.info('📤 Enviando audio a OpenAI Whisper API...');
      
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: {
            'Authorization': `Bearer ${config.whisper.api_key}`,
            ...formData.getHeaders()
          },
          timeout: config.whisper.api_timeout,
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );
      
      const transcription = response.data.trim();
      
      // Limpiar archivo temporal si se creó
      if (processedAudioPath !== audioPath) {
        await audioConverter.cleanupTempFiles([processedAudioPath]).catch(() => {});
      }
      
      logger.success('✅ Transcripción completada con OpenAI Whisper API', { 
        length: transcription.length,
        preview: transcription.substring(0, 50) + '...'
      });
      
      return transcription;
    } catch (error) {
      logger.error('Error en transcripción con API', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Transcribir usando Whisper local
   */
  async _transcribeWithLocalWhisper(audioPath) {
    try {
      logger.info('🎤 Transcribiendo audio con Whisper local...');
      
      // Convertir a WAV si no lo es (Whisper local funciona mejor con WAV)
      let wavPath = audioPath;
      if (!audioPath.endsWith('.wav')) {
        logger.info('🔄 Convirtiendo audio a WAV para mejor compatibilidad...');
        wavPath = await audioConverter.convertToWav(audioPath);
        logger.success('✅ Audio convertido a WAV');
      }

      const transcription = await this._runWhisperLocal(wavPath);

      // Limpiar archivos temporales
      if (wavPath !== audioPath) {
        await audioConverter.cleanupTempFiles([wavPath]).catch(() => {});
      }

      logger.success('✅ Transcripción completada con Whisper local', { 
        length: transcription.length,
        preview: transcription.substring(0, 50) + '...'
      });
      return transcription;
    } catch (error) {
      logger.error('Error en transcripción local', error);
      throw new Error('No se pudo transcribir el audio');
    }
  }

  /**
   * Ejecutar Whisper local como proceso hijo
   */
  _runWhisperLocal(audioPath) {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const tempDir = path.join(__dirname, '..', config.paths.temp);
      const fs = require('fs');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

            const args = [
              '-m', 'whisper',
              audioPath,
              '--model', config.whisper.model,
              '--language', config.whisper.language,
              '--task', 'transcribe',
              '--output_format', 'txt',
              '--output_dir', tempDir,
              '--temperature', config.whisper.temperature.toString(),
              '--beam_size', config.whisper.beam_size.toString(),
              '--best_of', config.whisper.best_of.toString(), // Mejorar calidad
              '--patience', '1.0', // Reducir errores
              '--condition_on_previous_text', 'True', // Mejor contexto
              '--initial_prompt', 'Esto es una conversación en español peruano sobre pedidos de productos. Habla de forma clara y natural.', // Prompt inicial para mejor reconocimiento
              '--compression_ratio_threshold', '2.4', // Filtrar transcripciones de baja calidad
              '--logprob_threshold', '-1.0', // Filtrar por probabilidad
              '--no_speech_threshold', '0.6' // Detectar mejor cuando hay silencio
            ];

      logger.debug('Ejecutando Whisper local', { args });

      // Configurar variables de entorno para evitar problemas SSL
      const env = {
        ...process.env,
        PYTHONHTTPSVERIFY: '0', // Desactivar verificación SSL para descargar modelos
        SSL_CERT_FILE: '',
        REQUESTS_CA_BUNDLE: ''
      };

      const whisper = spawn(config.whisper.pythonPath, args, { env });
      
      let stdout = '';
      let stderr = '';

      whisper.stdout.on('data', (data) => {
        stdout += data.toString();
        logger.debug(`Whisper stdout: ${data}`);
      });

      whisper.stderr.on('data', (data) => {
        stderr += data.toString();
        logger.debug(`Whisper stderr: ${data}`);
      });

      whisper.on('close', (code) => {
        if (code === 0) {
          const txtPath = path.join(
            tempDir,
            path.basename(audioPath, path.extname(audioPath)) + '.txt'
          );
          
          try {
            if (fs.existsSync(txtPath)) {
              const transcription = fs.readFileSync(txtPath, 'utf8').trim();
              fs.unlinkSync(txtPath);
              resolve(transcription);
            } else {
              // Intentar extraer del output
              const text = this._extractTextFromOutput(stdout + stderr);
              if (text) {
                resolve(text);
              } else {
                reject(new Error('No se pudo obtener la transcripción del archivo ni del output'));
              }
            }
          } catch (error) {
            const text = this._extractTextFromOutput(stdout + stderr);
            if (text) {
              resolve(text);
            } else {
              reject(new Error(`No se pudo obtener la transcripción: ${error.message}`));
            }
          }
        } else {
          reject(new Error(`Whisper falló con código ${code}: ${stderr}`));
        }
      });

      whisper.on('error', (error) => {
        logger.error('Error al ejecutar Whisper local', error);
        reject(error);
      });
    });
  }

  /**
   * Extraer texto del output de Whisper local
   */
  _extractTextFromOutput(output) {
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && 
          !trimmed.includes('[') && 
          !trimmed.includes('Detecting language') &&
          !trimmed.includes('Loading') &&
          !trimmed.includes('Transcribing') &&
          trimmed.length > 3) {
        return trimmed;
      }
    }
    return null;
  }

  /**
   * Verificar si Whisper local está instalado
   */
  async checkLocalInstallation() {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const whisper = spawn(config.whisper.pythonPath, ['-m', 'whisper', '--help'], {
        env: {
          ...process.env,
          PYTHONHTTPSVERIFY: '0',
          SSL_CERT_FILE: '',
          REQUESTS_CA_BUNDLE: ''
        }
      });
      
      whisper.on('close', (code) => {
        resolve(code === 0);
      });
      
      whisper.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Warmup: invocar whisper con --help y flags para forzar descarga con SSL desactivado
   */
  _warmupModel() {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const args = [
        '-m', 'whisper',
        '--model', config.whisper.model,
        '--language', config.whisper.language,
        '--help'
      ];
      const env = {
        ...process.env,
        PYTHONHTTPSVERIFY: '0',
        SSL_CERT_FILE: '',
        REQUESTS_CA_BUNDLE: ''
      };
      logger.debug('Warmup Whisper', { args });
      const p = spawn(config.whisper.pythonPath, args, { env });
      let stderr = '';
      p.stderr.on('data', d => { stderr += d.toString(); });
      p.on('close', (code) => {
        // whisper --help devuelve 0 y muestra usage; si no, igual consideramos listo si mostró usage
        if (code === 0 || /usage/i.test(stderr)) {
          resolve();
        } else {
          reject(new Error(`Warmup whisper salió con código ${code}`));
        }
      });
      p.on('error', (err) => reject(err));
    });
  }
}

module.exports = new WhisperTranscriber();
