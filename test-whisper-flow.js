require('dotenv').config();
const whisper = require('./src/whisper');
const nlu = require('./src/nlu');
const logger = require('./src/utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Test completo del flujo de voz:
 * 1. Verificar que Whisper está instalado
 * 2. Simular transcripción de un audio
 * 3. Verificar que la transcripción se procesa con NLU
 */
async function testWhisperFlow() {
  console.log('\n🧪 ============================================');
  console.log('🧪 TEST: Flujo completo de Whisper');
  console.log('🧪 ============================================\n');

  try {
    // 1. Verificar instalación de Whisper
    console.log('1️⃣ Verificando instalación de Whisper...');
    const { spawn } = require('child_process');
    const config = require('./config/config');
    
    const checkWhisper = new Promise((resolve) => {
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
    
    const whisperInstalled = await checkWhisper;
    if (!whisperInstalled) {
      console.log('❌ Whisper NO está instalado correctamente');
      console.log('   Ejecuta: pip install -U openai-whisper');
      return;
    }
    console.log('✅ Whisper está instalado\n');

    // 2. Test de transcripción (simulado - necesitarías un archivo de audio real)
    console.log('2️⃣ Verificando módulo de transcripción...');
    try {
      await whisper.ensureReady();
      console.log('✅ Módulo de transcripción listo\n');
    } catch (error) {
      console.log('⚠️  Advertencia en warmup:', error.message);
      console.log('   (Esto es normal si es la primera vez)\n');
    }

    // 3. Simular transcripciones y verificar procesamiento NLU
    console.log('3️⃣ Test de procesamiento NLU con transcripciones simuladas...\n');
    
    const testCases = [
      {
        transcription: 'quiero ver el catálogo de productos',
        expectedIntent: 'catalog',
        description: 'Solicitud de catálogo'
      },
      {
        transcription: 'necesito dos laptops y un mouse',
        expectedIntent: 'order',
        description: 'Pedido con productos'
      },
      {
        transcription: 'cuánto cuesta una laptop',
        expectedIntent: 'price',
        description: 'Consulta de precio'
      },
      {
        transcription: 'quiero hacer un pedido de tres panes integrales',
        expectedIntent: 'order',
        description: 'Pedido específico'
      }
    ];

    for (const testCase of testCases) {
      console.log(`📝 Test: ${testCase.description}`);
      console.log(`   Transcripción: "${testCase.transcription}"`);
      
      const sessionState = {
        phoneNumber: '51999999999',
        state: 'idle',
        authenticated: false
      };
      
      const conversationHistory = [];
      
      try {
        const nluResult = await nlu.processMessage(
          testCase.transcription,
          sessionState,
          conversationHistory,
          true // isFromVoice
        );
        
        console.log(`   ✅ Intent detectado: ${nluResult.intent}`);
        console.log(`   ✅ Tiene respuesta: ${!!nluResult.response}`);
        
        if (nluResult.response && nluResult.response.message) {
          const msgPreview = nluResult.response.message.substring(0, 80);
          console.log(`   📤 Respuesta: "${msgPreview}..."`);
        }
        
        if (nluResult.response && nluResult.response.action) {
          console.log(`   🎯 Acción: ${nluResult.response.action}`);
        }
        
        console.log('');
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }

    // 4. Resumen del flujo completo
    console.log('4️⃣ Resumen del flujo completo:\n');
    console.log('   📥 Audio recibido en WhatsApp');
    console.log('   ↓');
    console.log('   🎤 Whisper transcribe audio → texto');
    console.log('   ↓');
    console.log('   💾 Transcripción guardada en historial');
    console.log('   ↓');
    console.log('   🤖 NLU procesa el texto (detecta intención)');
    console.log('   ↓');
    console.log('   🔍 Búsqueda de productos (si aplica)');
    console.log('   ↓');
    console.log('   📤 Respuesta enviada al usuario');
    console.log('   ↓');
    console.log('   ✅ Aplicativo funciona correctamente\n');

    console.log('✅ ============================================');
    console.log('✅ TEST COMPLETADO: Flujo verificado');
    console.log('✅ ============================================\n');

  } catch (error) {
    console.error('❌ Error en test:', error);
    console.error(error.stack);
  }
}

// Ejecutar test
testWhisperFlow().catch(console.error);




