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
   * Convertir audio OGG/OPUS a WAV para Whisper
   */
  async convertToWav(inputPath, outputPath = null) {
    try {
      if (!outputPath) {
        const filename = path.basename(inputPath, path.extname(inputPath));
        outputPath = path.join(this.tempPath, `${filename}.wav`);
      }

      logger.debug('Convirtiendo audio a WAV', { inputPath, outputPath });

      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .toFormat('wav')
          .audioFrequency(16000) // 16kHz para Whisper
          .audioChannels(1) // Mono
          .audioBitrate('128k')
          .on('start', (commandLine) => {
            logger.debug('FFmpeg comando:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              logger.debug(`Progreso conversión: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            logger.success('Audio convertido a WAV exitosamente');
            resolve(outputPath);
          })
          .on('error', (err) => {
            logger.error('Error al convertir audio a WAV', err);
            reject(err);
          })
          .save(outputPath);
      });
    } catch (error) {
      logger.error('Error en conversión de audio a WAV', error);
      throw error;
    }
  }

  /**
   * Convertir audio a MP3 para mejor compatibilidad con OpenAI Whisper
   */
  async convertToMp3(inputPath, outputPath = null) {
    try {
      if (!outputPath) {
        const filename = path.basename(inputPath, path.extname(inputPath));
        outputPath = path.join(this.tempPath, `${filename}.mp3`);
      }

      logger.debug('Convirtiendo audio a MP3', { inputPath, outputPath });

      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .toFormat('mp3')
          .audioFrequency(16000) // 16kHz para Whisper
          .audioChannels(1) // Mono
          .audioBitrate('128k')
          .audioCodec('libmp3lame')
          .on('start', (commandLine) => {
            logger.debug('FFmpeg comando MP3:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              logger.debug(`Progreso conversión MP3: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            logger.success('Audio convertido a MP3 exitosamente');
            resolve(outputPath);
          })
          .on('error', (err) => {
            logger.error('Error al convertir audio a MP3', err);
            reject(err);
          })
          .save(outputPath);
      });
    } catch (error) {
      logger.error('Error en conversión de audio a MP3', error);
      throw error;
    }
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

