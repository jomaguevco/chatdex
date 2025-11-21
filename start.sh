#!/bin/bash

echo "🚀 Iniciando ChatDex..."
echo ""

# Verificar que Node.js esté instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está instalado. Por favor instálalo primero."
    exit 1
fi

# Verificar que las dependencias estén instaladas
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias..."
    npm install
fi

# Verificar que .env exista
if [ ! -f ".env" ]; then
    echo "⚙️  Creando archivo .env desde .env.example..."
    cp .env.example .env
    echo "⚠️  IMPORTANTE: Configura las variables en .env antes de continuar"
    echo "   - KARDEX_API_URL"
    echo "   - KARDEX_AUTH_TOKEN"
    echo "   - CHATBOT_API_TOKEN"
    exit 1
fi

# Verificar variables críticas
source .env 2>/dev/null || true

if [ -z "$KARDEX_API_URL" ] || [ "$KARDEX_API_URL" == "http://localhost:4001/api" ]; then
    echo "⚠️  KARDEX_API_URL no está configurado o usa valor por defecto"
    echo "   Asegúrate de configurar la URL correcta de tu backend KARDEX"
fi

if [ -z "$KARDEX_AUTH_TOKEN" ] || [ "$KARDEX_AUTH_TOKEN" == "tu_token_de_autenticacion_aqui" ]; then
    echo "⚠️  KARDEX_AUTH_TOKEN no está configurado"
    echo "   Necesitas obtener un token de autenticación del backend KARDEX"
fi

if [ -z "$CHATBOT_API_TOKEN" ] || [ "$CHATBOT_API_TOKEN" == "tu_token_para_notificaciones_chatbot" ]; then
    echo "⚠️  CHATBOT_API_TOKEN no está configurado"
    echo "   Este token debe coincidir con CHATBOT_API_TOKEN del backend KARDEX"
fi

echo ""
echo "✅ Verificaciones completadas"
echo ""
echo "📱 Iniciando bot..."
echo ""

# Iniciar el bot
node src/app.js
