# 🧪 Cómo Probar Chatdex

## Pruebas Rápidas (Sin WhatsApp)

### 1. Prueba de Integración Completa
```bash
node test-integration.js
```
Verifica que todas las conexiones estén funcionando.

### 2. Prueba de Mensajes
```bash
node test-messages.js
```
Prueba el procesamiento de mensajes de texto y solicitudes de catálogo.

## Pruebas con WhatsApp Real

### Paso 1: Iniciar el Bot
```bash
npm start
```

### Paso 2: Conectar WhatsApp
1. Espera a que aparezca el código QR en la consola
2. Abre WhatsApp en tu teléfono
3. Ve a: **Configuración > Dispositivos vinculados**
4. Toca: **"Vincular un dispositivo"**
5. Escanea el QR que aparece en la consola

### Paso 3: Probar Mensajes de Texto

Desde **OTRO teléfono** (no el que escaneó el QR), envía estos mensajes:

#### 📝 Saludo
```
Hola
```
**Respuesta esperada:** Mensaje de bienvenida con opciones

#### 📦 Solicitar Catálogo
```
CATALOGO
```
o
```
Muéstrame los productos
```
o
```
Qué productos tienen?
```
**Respuesta esperada:** Lista de productos con precios y stock

#### 🛒 Hacer un Pedido
```
Quiero comprar 2 laptops
```
o
```
Necesito 3 audífonos
```
**Respuesta esperada:** Confirmación del pedido con productos y total

### Paso 4: Probar Mensajes de Voz

#### 🎤 Solicitar Catálogo por Voz
1. Envía un mensaje de voz diciendo:
   - "Muéstrame el catálogo"
   - "Quiero ver los productos"
   - "Qué productos tienen?"

2. El bot:
   - Transcribirá el audio a texto (si OpenAI Whisper está configurado)
   - Procesará el texto
   - Responderá con el catálogo

#### ⚠️ Nota sobre Audio
- **Con OpenAI Whisper API:** Transcribe automáticamente y funciona perfecto
- **Sin OpenAI Whisper API:** Necesitas instalar Whisper local:
  ```bash
  pip install openai-whisper
  ```
- **Sin ninguno:** El bot no podrá procesar mensajes de voz

## Configurar OpenAI (Opcional pero Recomendado)

Para habilitar reconocimiento de voz y procesamiento de IA mejorado:

1. Obtén una API key de OpenAI: https://platform.openai.com/api-keys
2. Agrega al archivo `.env`:
   ```
   OPENAI_API_KEY=tu_api_key_aqui
   ```
3. Reinicia el bot:
   ```bash
   npm start
   ```

## Verificar Estado

### Ver logs en tiempo real
```bash
tail -f bot.log
```

### Verificar conexión
```bash
curl http://localhost:3001/health
```

### Verificar estado detallado
```bash
curl http://localhost:3001/debug-status
```

## Ejemplos de Mensajes para Probar

### Texto
- `Hola`
- `CATALOGO`
- `PRODUCTOS`
- `Quiero ver los productos`
- `Muéstrame el catálogo`
- `Quiero comprar 2 laptops`
- `Necesito 3 audífonos Sony`
- `AYUDA`

### Voz (si OpenAI está configurado)
- "Hola, quiero ver el catálogo"
- "Muéstrame los productos disponibles"
- "Quiero comprar dos laptops"
- "Necesito tres audífonos"

## Solución de Problemas

### El bot no responde
1. Verifica que esté corriendo: `ps aux | grep "node src/app.js"`
2. Verifica los logs: `tail -f bot.log`
3. Verifica la conexión: `curl http://localhost:3001/health`

### No se conecta a MySQL
1. Verifica las credenciales en `.env`
2. Ejecuta: `node test-integration.js`

### No procesa mensajes de voz
1. Verifica que OpenAI API key esté configurada
2. O instala Whisper local: `pip install openai-whisper`

