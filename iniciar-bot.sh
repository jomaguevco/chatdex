#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║          🚀 INICIANDO CHATDEX - BOT DE WHATSAPP                        ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

# Verificar que .env esté configurado
if [ ! -f ".env" ]; then
    echo "❌ Error: Archivo .env no encontrado"
    echo "   Ejecuta: ./configurar-datos.sh"
    exit 1
fi

# Verificar variables críticas
source .env 2>/dev/null || true

if [ -z "$KARDEX_AUTH_TOKEN" ] || [ "$KARDEX_AUTH_TOKEN" == "tu_token_de_autenticacion_aqui" ]; then
    echo "❌ Error: KARDEX_AUTH_TOKEN no está configurado"
    echo "   Ejecuta: ./configurar-datos.sh"
    exit 1
fi

if [ -z "$CHATBOT_API_TOKEN" ] || [ "$CHATBOT_API_TOKEN" == "tu_token_para_notificaciones_chatbot" ]; then
    echo "❌ Error: CHATBOT_API_TOKEN no está configurado"
    echo "   Ejecuta: ./configurar-datos.sh"
    exit 1
fi

echo "✅ Verificaciones completadas"
echo ""
echo "📋 Configuración:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Backend: $KARDEX_API_URL"
echo "Token: ✅ Configurado"
echo "Chatbot Token: ✅ Configurado"
echo "Yape: $YAPE_NUMBER"
echo "Nombre: $YAPE_NAME"
echo ""
echo "🚀 Iniciando bot..."
echo ""
echo "📱 INSTRUCCIONES:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Se generará un código QR en la consola"
echo "2. Abre WhatsApp en tu teléfono"
echo "3. Ve a: Configuración > Dispositivos vinculados"
echo "4. Escanea el QR que aparece"
echo "5. Espera a ver: '✅ WhatsApp conectado exitosamente'"
echo ""
echo "💡 También puedes ver el QR en: qr/qr.png"
echo ""
echo "⚠️  IMPORTANTE:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Asegúrate de configurar CHATBOT_API_TOKEN en Railway:"
echo "   CHATBOT_API_TOKEN=chatbot-secret-token-123"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Iniciar el bot
node src/app.js
