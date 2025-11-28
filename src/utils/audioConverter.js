const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config/config');
const logger = require('./logger');

class AudioConverter {
  constructor() {
    this.tempPath = path.join(__dirname, '..', '..', config.paths.temp);
  }

  /**
   * Convertir audio OGG/OPUS a WAV para Whisper (con mejoras de calidad)
   */
  async convertToWav(inputPath, outputPath = null) {
    try {
      if (!outputPath) {
        const filename = path.basename(inputPath, path.extname(inputPath));
        outputPath = path.join(this.tempPath, `${filename}.wav`);
      }

      logger.debug('Convirtiendo audio a WAV con mejoras de calidad', { inputPath, outputPath });

      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .toFormat('wav')
          .audioFrequency(16000) // 16kHz para Whisper (óptimo)
          .audioChannels(1) // Mono
          .audioBitrate('128k')
          .audioFilters([
            'highpass=f=80', // Filtrar ruido de baja frecuencia
            'lowpass=f=8000', // Filtrar ruido de alta frecuencia
            'volume=1.2', // Aumentar volumen ligeramente
            'dynaudnorm' // Normalización dinámica de audio
          ])
          .on('start', (commandLine) => {
            logger.debug('FFmpeg comando:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              logger.debug(`Progreso conversión: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            logger.success('Audio convertido a WAV exitosamente (con mejoras de calidad)');
            resolve(outputPath);
          })
          .on('error', (err) => {
            logger.error('Error al convertir audio a WAV', err);
            // Intentar sin filtros si falla
            logger.warn('Intentando conversión sin filtros avanzados...');
            this._convertToWavSimple(inputPath, outputPath)
              .then(resolve)
              .catch(reject);
          })
          .save(outputPath);
      });
    } catch (error) {
      logger.error('Error en conversión de audio a WAV', error);
      throw error;
    }
  }
  
  /**
   * Conversión simple sin filtros (fallback)
   */
  _convertToWavSimple(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('wav')
        .audioFrequency(16000)
        .audioChannels(1)
        .audioBitrate('128k')
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .save(outputPath);
    });
  }

  /**
   * Convertir audio a MP3 para mejor compatibilidad con OpenAI Whisper (con mejoras de calidad)
   */
  async convertToMp3(inputPath, outputPath = null) {
    try {
      if (!outputPath) {
        const filename = path.basename(inputPath, path.extname(inputPath));
        outputPath = path.join(this.tempPath, `${filename}.mp3`);
      }

      logger.debug('Convirtiendo audio a MP3 con mejoras de calidad', { inputPath, outputPath });

      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .toFormat('mp3')
          .audioFrequency(16000) // 16kHz para Whisper (óptimo)
          .audioChannels(1) // Mono
          .audioBitrate('128k')
          .audioCodec('libmp3lame')
          .audioFilters([
            'highpass=f=80', // Filtrar ruido de baja frecuencia
            'lowpass=f=8000', // Filtrar ruido de alta frecuencia
            'volume=1.2', // Aumentar volumen ligeramente
            'dynaudnorm' // Normalización dinámica de audio
          ])
          .on('start', (commandLine) => {
            logger.debug('FFmpeg comando MP3:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              logger.debug(`Progreso conversión MP3: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            logger.success('Audio convertido a MP3 exitosamente (con mejoras de calidad)');
            resolve(outputPath);
          })
          .on('error', (err) => {
            logger.error('Error al convertir audio a MP3', err);
            // Intentar sin filtros si falla
            logger.warn('Intentando conversión MP3 sin filtros avanzados...');
            this._convertToMp3Simple(inputPath, outputPath)
              .then(resolve)
              .catch(reject);
          })
          .save(outputPath);
      });
    } catch (error) {
      logger.error('Error en conversión de audio a MP3', error);
      throw error;
    }
  }
  
  /**
   * Conversión MP3 simple sin filtros (fallback)
   */
  _convertToMp3Simple(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('mp3')
        .audioFrequency(16000)
        .audioChannels(1)
        .audioBitrate('128k')
        .audioCodec('libmp3lame')
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .save(outputPath);
    });
  }

  /**
   * Limpiar archivos temporales
   */
  async cleanupTempFiles(files) {
    try {
      for (const file of files) {
        try {
          await fs.unlink(file);
          logger.debug(`Archivo temporal eliminado: ${file}`);
        } catch (error) {
          // Ignorar errores si el archivo no existe
        }
      }
    } catch (error) {
      logger.error('Error al limpiar archivos temporales', error);
    }
  }

  /**
   * Obtener duración del audio
   */
  async getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata.format.duration);
        }
      });
    });
  }
}

module.exports = new AudioConverter();

