const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('./utils/logger');
const audioConverter = require('./utils/audioConverter');

class WhisperTranscriber {
  constructor() {
    logger.info('✅ Whisper local configurado');
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
   * Transcribir audio usando Whisper local
   */
  async transcribe(audioPath) {
    try {
      logger.info('🎤 Transcribiendo audio con Whisper local...');
      return await this._transcribeWithLocalWhisper(audioPath);
    } catch (error) {
      logger.error('Error en transcripción', error);
      throw new Error('No se pudo transcribir el audio');
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
              '--best_of', '5', // Mejorar calidad
              '--patience', '1.0' // Reducir errores
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
