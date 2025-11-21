# 🤖 ChatDex - Chatbot WhatsApp con Voz para Sistema KARDEX

Bot de WhatsApp completamente **gratuito** con reconocimiento de voz que se integra con el sistema de ventas KARDEX. Los clientes pueden enviar mensajes de texto o notas de voz para hacer pedidos automáticamente.

## ✨ Características

- 📱 **WhatsApp nativo** - Conexión directa sin APIs de pago (Venom-Bot)
- 🎤 **Reconocimiento de voz** - Transcripción local con Whisper (español peruano)
- 🤖 **IA integrada** - Búsqueda semántica y fuzzy matching de productos
- 💡 **Sugerencias inteligentes** - Propone productos similares si no encuentra exacto
- 🛒 **Integración completa** con sistema KARDEX existente
- 💰 **Notificaciones automáticas** - Notifica a vendedores/administradores
- 🔄 **Gestión de pedidos** en tiempo real con confirmación
- 💾 **Base de datos local** (SQLite) para sesiones
- 📊 **Manejo inteligente** de cantidades, unidades y direcciones peruanas
- 🆓 **100% gratuito** - Sin costos de APIs externas

## 📋 Requisitos previos

### 1. Node.js
```bash
# Instalar Node.js v18 o superior
node --version  # debe mostrar v18.x.x o superior
```

### 2. Python (para Whisper)
```bash
# Instalar Python 3.8 o superior
python3 --version

# Instalar OpenAI Whisper
pip3 install openai-whisper

# Verificar instalación
whisper --help
```

### 3. FFmpeg (para procesamiento de audio)
```bash
# En macOS
brew install ffmpeg

# En Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# En Windows
# Descargar desde: https://ffmpeg.org/download.html
```

## 🚀 Instalación

### 1. Clonar o descargar el proyecto
```bash
cd chatdex.com
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
```bash
# Copiar el archivo de ejemplo
cp .env.example .env

# Editar .env con tus datos
nano .env
```

**Configuración importante en `.env`:**
```env
# Configuración del servidor
PORT=3001
NODE_ENV=development

# KARDEX API
KARDEX_API_URL=http://localhost:4001/api
KARDEX_AUTH_TOKEN=tu_token_de_autenticacion_aqui
CHATBOT_API_TOKEN=tu_token_para_notificaciones_chatbot

# Whisper (Transcripción de voz)
WHISPER_MODEL=base
WHISPER_LANGUAGE=es
WHISPER_PYTHON_PATH=python3

# Configuración de pagos
YAPE_NUMBER=987654321
YAPE_NAME=Tu Negocio
PLIN_NUMBER=987654321

# Configuración del bot
WELCOME_MESSAGE=¡Hola! 👋 Soy el asistente virtual. ¿En qué puedo ayudarte?
CONFIRMATION_TIMEOUT=10
TIMEZONE=America/Lima
```

### 4. Iniciar el bot
```bash
npm start
```

En el primer inicio:
1. Se abrirá una ventana del navegador con un **QR code**
2. Escanea el QR con WhatsApp (Dispositivos vinculados)
3. El bot se conectará automáticamente
4. ¡Listo! Ya puedes recibir pedidos por WhatsApp

## 🔧 Integración con KARDEX

El bot se conecta automáticamente a estos endpoints de tu sistema:

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/productos` | GET | Obtener catálogo de productos (con búsqueda semántica) |
| `/productos/:id` | GET | Detalles de un producto |
| `/notificaciones/whatsapp` | POST | Notificar pedidos a vendedores/administradores |

**Nota:** El chatbot no crea pedidos directamente, solo notifica a vendedores/administradores para que procesen el pedido manualmente desde el sistema KARDEX.

## 💬 Ejemplos de uso

### Pedido por texto
```
Cliente: Hola, quiero 2 panes integrales y 1 yogurt de litro

Bot:
📦 Resumen de tu pedido:
• 2× Pan Integral - S/ 7.50 c/u
• 1× Yogurt Natural 1L - S/ 9.50

💵 Total: S/ 24.50

¿Confirmas el pedido? Responde "CONFIRMO" para continuar.
```

### Pedido por voz
```
Cliente: (nota de voz) "Necesito tres pollos a la brasa para el sábado"

Bot:
🎤 Escuché: "necesito tres pollos a la brasa para el sabado"

📦 Resumen de tu pedido:
• 3× Pollo a la Brasa - S/ 45.00 c/u

💵 Total: S/ 135.00
📅 Entrega: Sábado

¿Confirmas? Responde "CONFIRMO"
```

### Confirmación y pago
```
Cliente: CONFIRMO

Bot:
✅ Pedido confirmado! 🎉

Para completar tu pedido, realiza el pago:
💳 Yape/Plin: 987654321
👤 A nombre de: Mi Negocio

[Envía QR de pago]

Cuando hagas el pago, envía una captura o escribe "PAGADO"
```

## 📁 Estructura del proyecto

```
/chatdex.com/
├── src/
│   ├── app.js                 # Servidor principal Express
│   ├── whatsapp.js            # Lógica de Venom-Bot
│   ├── whisper.js             # Transcripción de voz con Whisper
│   ├── nlu.js                 # Procesamiento de lenguaje natural con IA
│   ├── orderHandler.js        # Manejo completo de pedidos y confirmación
│   ├── db.js                  # Base de datos SQLite
│   ├── kardexApi.js           # Cliente HTTP para KARDEX con retry logic
│   ├── sessionManager.js      # Gestión de sesiones de chat
│   └── utils/
│       ├── audioConverter.js  # Conversión de audio
│       ├── textParser.js      # Extracción de productos/cantidades
│       └── logger.js          # Registro de eventos
├── config/
│   └── config.js              # Configuración general
├── qr/
│   └── yape-plin.png          # QR estático de pago
├── data/
│   └── chatbot.db             # Base de datos SQLite (auto-generada)
├── temp/                      # Archivos temporales de audio
├── package.json
├── .env.example
├── .env
└── README.md
```

## 🔄 Flujo completo del bot

1. **Recepción** - Usuario envía mensaje/voz por WhatsApp
2. **Transcripción** - Si es voz, Whisper convierte a texto
3. **Análisis IA** - NLU detecta intención y extrae productos/cantidades con búsqueda semántica
4. **Búsqueda inteligente** - Busca productos con fuzzy matching y sugiere alternativas
5. **Verificación** - Llama a KARDEX para validar stock y precios
6. **Resumen** - Envía resumen del pedido formateado al cliente
7. **Confirmación** - Espera que el cliente confirme
8. **Notificación** - Notifica a vendedores/administradores cuando se confirma
9. **Pago** - Muestra información de pago y espera confirmación
10. **Seguimiento** - Permite consultar estado del pedido

## 🛠️ Comandos del bot

Los usuarios pueden usar estos comandos:

- `HOLA` / `INICIO` - Mensaje de bienvenida
- `PRODUCTOS` / `CATALOGO` - Ver productos disponibles
- `CONFIRMO` - Confirmar pedido
- `CANCELAR` - Cancelar pedido actual
- `PAGADO` - Confirmar que se realizó el pago
- `AYUDA` - Mostrar ayuda
- `ESTADO` - Ver estado del último pedido

## 🔐 Seguridad

- ✅ Token de autenticación para llamadas a KARDEX
- ✅ Validación de números de WhatsApp permitidos (opcional)
- ✅ Timeout de sesiones (10 minutos por defecto)
- ✅ Logs de todas las transacciones
- ✅ No se almacenan datos sensibles de pago

## 📊 Base de datos local

El bot usa SQLite para almacenar:

- **Sesiones de chat** - Estado de cada conversación
- **Pedidos pendientes** - Pedidos en proceso de confirmación
- **Historial** - Registro de interacciones
- **Métricas** - Estadísticas de uso

## 🐛 Troubleshooting

### El QR no aparece
```bash
# Eliminar sesión anterior
rm -rf tokens/

# Reiniciar el bot
npm start
```

### Error con Whisper
```bash
# Verificar instalación
whisper --help

# Reinstalar si es necesario
pip3 install --upgrade openai-whisper
```

### Error de conexión con KARDEX
```bash
# Verificar que el backend esté corriendo
curl http://localhost:3000/api/health

# Verificar token en .env
echo $KARDEX_AUTH_TOKEN
```

### Audio no se transcribe
```bash
# Verificar FFmpeg
ffmpeg -version

# Verificar permisos de carpeta temp/
chmod 755 temp/
```

## 🚀 Despliegue en producción

### Opción 1: Servidor local (24/7)
```bash
# Instalar PM2 para mantener el bot corriendo
npm install -g pm2

# Iniciar con PM2
pm2 start src/app.js --name chatdex

# Ver logs
pm2 logs chatdex

# Reiniciar
pm2 restart chatdex
```

### Opción 2: Railway (gratuito)
1. Subir el código a GitHub
2. Conectar con Railway
3. Configurar variables de entorno
4. Desplegar automáticamente

**Nota:** Venom-Bot requiere mantener la sesión de WhatsApp activa, funciona mejor en servidor dedicado.

## 📝 Próximas mejoras

- [ ] Panel web de administración
- [ ] Múltiples métodos de pago
- [ ] Integración con delivery (Google Maps)
- [ ] Reportes automáticos diarios
- [ ] Soporte para múltiples idiomas
- [ ] Webhooks para notificaciones
- [ ] Chatbot con IA (GPT) para respuestas más naturales

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

MIT License - Úsalo libremente en tus proyectos.

## 📧 Soporte

Si tienes problemas o preguntas:
- Revisa la sección de Troubleshooting
- Abre un issue en GitHub
- Contacta al desarrollador

---

**Desarrollado con ❤️ para integración con Sistema KARDEX**

