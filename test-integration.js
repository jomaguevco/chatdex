require('dotenv').config();
const kardexDb = require('./src/kardexDb');
const whisper = require('./src/whisper');
const nlu = require('./src/nlu');
const config = require('./config/config');
const logger = require('./src/utils/logger');

async function testIntegration() {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║          🧪 PRUEBA DE INTEGRACIÓN - CHATDEX                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const results = {
    mysql: false,
    whisper: false,
    gpt: false,
    nlu: false
  };

  // Test 1: Conexión MySQL
  console.log('📦 Test 1: Conexión a Base de Datos MySQL de Kardex');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const connected = await kardexDb.initialize();
    if (connected) {
      console.log('✅ Conexión MySQL: EXITOSA');
      results.mysql = true;
      
      // Probar consulta de productos
      console.log('   Probando consulta de productos...');
      const productos = await kardexDb.getProductos({ activo: true, limit: 5 });
      if (productos && productos.length > 0) {
        console.log(`   ✅ Productos encontrados: ${productos.length}`);
        console.log(`   📦 Ejemplo: ${productos[0].nombre} - S/ ${productos[0].precio_venta}`);
      } else {
        console.log('   ⚠️  No se encontraron productos (puede ser normal si la BD está vacía)');
      }
    } else {
      console.log('❌ Conexión MySQL: FALLIDA');
      console.log('   ⚠️  Se usará API REST como fallback');
    }
  } catch (error) {
    console.log('❌ Conexión MySQL: ERROR');
    console.log(`   Error: ${error.message}`);
  }
  console.log('');

  // Test 2: OpenAI Whisper
  console.log('🎤 Test 2: OpenAI Whisper API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (config.openai.apiKey) {
    console.log('✅ API Key configurada');
    if (whisper.isOpenAIAvailable()) {
      console.log('✅ Cliente OpenAI Whisper inicializado');
      results.whisper = true;
      console.log('   💡 Para probar transcripción, envía un mensaje de voz al bot');
    } else {
      console.log('❌ Cliente OpenAI Whisper no inicializado');
    }
  } else {
    console.log('⚠️  OPENAI_API_KEY no configurada');
    console.log('   💡 Whisper local estará disponible como fallback');
    
    // Verificar Whisper local
    const localAvailable = await whisper.checkLocalInstallation();
    if (localAvailable) {
      console.log('✅ Whisper local está instalado');
      results.whisper = true;
    } else {
      console.log('❌ Whisper local no está instalado');
      console.log('   💡 Instala con: pip install openai-whisper');
    }
  }
  console.log('');

  // Test 3: OpenAI GPT
  console.log('🤖 Test 3: OpenAI GPT para Procesamiento de IA');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (config.openai.apiKey) {
    console.log('✅ API Key configurada');
    // Verificar que NLU tenga GPT disponible
    if (nlu.useGPT) {
      console.log('✅ GPT configurado en NLU');
      results.gpt = true;
      
      // Probar procesamiento de un mensaje simple
      console.log('   Probando procesamiento de mensaje...');
      try {
        const testMessage = 'Hola, quiero comprar 2 laptops';
        const result = await nlu.processMessage(testMessage, { state: 'idle' });
        console.log(`   ✅ Mensaje procesado: "${testMessage}"`);
        console.log(`   📊 Intención detectada: ${result.intent}`);
        if (result.gptExtracted) {
          console.log('   ✅ GPT extrajo información del mensaje');
        }
        results.nlu = true;
      } catch (error) {
        console.log(`   ⚠️  Error al procesar: ${error.message}`);
      }
    } else {
      console.log('❌ GPT no está disponible en NLU');
    }
  } else {
    console.log('⚠️  OPENAI_API_KEY no configurada');
    console.log('   💡 Se usará procesamiento básico de texto');
    
    // Probar procesamiento básico
    console.log('   Probando procesamiento básico...');
    try {
      const testMessage = 'Hola';
      const result = await nlu.processMessage(testMessage, { state: 'idle' });
      console.log(`   ✅ Mensaje procesado: "${testMessage}"`);
      console.log(`   📊 Intención detectada: ${result.intent}`);
      results.nlu = true;
    } catch (error) {
      console.log(`   ⚠️  Error al procesar: ${error.message}`);
    }
  }
  console.log('');

  // Resumen
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                          📊 RESUMEN DE PRUEBAS                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  
  console.log(`MySQL de Kardex:     ${results.mysql ? '✅ Funcionando' : '❌ No disponible (usará API)'}`);
  console.log(`Whisper (Voz):       ${results.whisper ? '✅ Disponible' : '❌ No disponible'}`);
  console.log(`GPT (IA):            ${results.gpt ? '✅ Funcionando' : '⚠️  Usando procesamiento básico'}`);
  console.log(`NLU (Procesamiento): ${results.nlu ? '✅ Funcionando' : '❌ Error'}`);
  
  console.log('\n💡 RECOMENDACIONES:');
  if (!results.mysql) {
    console.log('   - Verifica las credenciales de MySQL en .env');
  }
  if (!results.whisper && !config.openai.apiKey) {
    console.log('   - Configura OPENAI_API_KEY para usar reconocimiento de voz mejorado');
  }
  if (!results.gpt && !config.openai.apiKey) {
    console.log('   - Configura OPENAI_API_KEY para usar procesamiento de IA mejorado');
  }
  
  console.log('\n✅ El bot está listo para usar. Inicia con: npm start\n');
  
  // Cerrar conexiones
  await kardexDb.close();
}

// Ejecutar pruebas
testIntegration().catch(error => {
  console.error('❌ Error en pruebas:', error);
  process.exit(1);
});

