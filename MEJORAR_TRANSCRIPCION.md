# 🎤 Mejorar Transcripción de Audio

## Opciones Disponibles

### 1. **Whisper Local (Actual - Gratis)**
- Modelo: `large-v3` (el más preciso disponible localmente)
- Configuración optimizada:
  - `beam_size: 10` (aumentado de 5 para mejor precisión)
  - `best_of: 5` (evalúa múltiples candidatos)
  - `condition_on_previous_text: True` (mejor contexto)
  - Filtros de calidad mejorados
  - Preprocesamiento de audio con normalización

### 2. **OpenAI Whisper API (Recomendado - Máxima Precisión)**
- **Ventajas:**
  - ✅ Mayor precisión que Whisper local
  - ✅ Mejor reconocimiento de acentos y dialectos
  - ✅ Manejo superior de ruido de fondo
  - ✅ Respuesta más rápida
  - ✅ Fallback automático a Whisper local si falla

- **Desventajas:**
  - ⚠️ Requiere API key de OpenAI (tiene costo)
  - ⚠️ Costo aproximado: $0.006 por minuto de audio

## 🚀 Configuración Rápida

### Opción A: Usar Whisper Local Mejorado (Gratis)

Ya está configurado y optimizado. Solo asegúrate de que el modelo `large-v3` esté instalado:

```bash
pip3 install openai-whisper
```

### Opción B: Usar OpenAI Whisper API (Máxima Precisión)

1. **Obtener API Key de OpenAI:**
   - Ve a https://platform.openai.com/api-keys
   - Crea una nueva API key
   - Copia la clave

2. **Configurar en `.env`:**
   ```env
   # Habilitar OpenAI Whisper API
   WHISPER_USE_API=true
   OPENAI_API_KEY=sk-tu-api-key-aqui
   
   # Opcional: timeout para API (en milisegundos)
   WHISPER_API_TIMEOUT=30000
   ```

3. **Reiniciar el bot:**
   ```bash
   npm start
   ```

## 📊 Comparación de Precisión

| Método | Precisión | Velocidad | Costo |
|--------|-----------|-----------|-------|
| Whisper Local (large-v3) | ~85-90% | Lenta (30-60s) | Gratis |
| OpenAI Whisper API | ~95-98% | Rápida (5-15s) | $0.006/min |

## 🔧 Mejoras Implementadas

### Preprocesamiento de Audio
- ✅ Normalización de volumen
- ✅ Filtrado de ruido (highpass/lowpass)
- ✅ Normalización dinámica de audio
- ✅ Conversión optimizada a WAV/MP3

### Configuración de Whisper Local
- ✅ `beam_size` aumentado a 10 (mejor búsqueda)
- ✅ `best_of` configurado a 5 (múltiples candidatos)
- ✅ `condition_on_previous_text` activado (mejor contexto)
- ✅ Filtros de calidad (compression_ratio_threshold, logprob_threshold)
- ✅ Prompt inicial para mejor reconocimiento de español peruano

### OpenAI Whisper API
- ✅ Prompt personalizado para español peruano
- ✅ Fallback automático a Whisper local
- ✅ Conversión automática a formato óptimo (MP3)
- ✅ Manejo robusto de errores

## 💡 Recomendaciones

1. **Para desarrollo/pruebas:** Usa Whisper Local (gratis)
2. **Para producción:** Usa OpenAI Whisper API (máxima precisión)
3. **Para ahorrar costos:** Usa Whisper Local con las mejoras implementadas

## 🐛 Solución de Problemas

### La transcripción sigue siendo imprecisa

1. **Verifica la calidad del audio:**
   - Habla más cerca del micrófono
   - Reduce el ruido de fondo
   - Habla más claro y pausado

2. **Prueba con OpenAI API:**
   - Configura `WHISPER_USE_API=true` en `.env`
   - Agrega tu `OPENAI_API_KEY`
   - Reinicia el bot

3. **Verifica la configuración:**
   - Asegúrate de que `WHISPER_MODEL=large-v3`
   - Verifica que `WHISPER_LANGUAGE=es`

### Error al usar OpenAI API

- Verifica que tu API key sea válida
- Asegúrate de tener créditos en tu cuenta de OpenAI
- Revisa los logs para ver el error específico
- El bot automáticamente usará Whisper local como fallback

## 📝 Notas

- El bot automáticamente detecta si debe usar API o local según la configuración
- Si la API falla, automáticamente intenta con Whisper local
- Los filtros de audio mejoran significativamente la calidad de transcripción
- El prompt personalizado ayuda a reconocer mejor el español peruano y términos de pedidos

