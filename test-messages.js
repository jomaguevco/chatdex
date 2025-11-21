require('dotenv').config();
const nlu = require('./src/nlu');
const kardexDb = require('./src/kardexDb');
const kardexApi = require('./src/kardexApi');
const whisper = require('./src/whisper');
const logger = require('./src/utils/logger');

async function testMessages() {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║          🧪 PRUEBA DE MENSAJES - CHATDEX                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Inicializar BD
  await kardexDb.initialize();

  // Test 1: Mensaje de saludo
  console.log('📝 Test 1: Mensaje de Saludo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const result = await nlu.processMessage('Hola', { state: 'idle' });
    console.log(`✅ Mensaje: "Hola"`);
    console.log(`   Intención: ${result.intent}`);
    if (result.response.message) {
      console.log(`   Respuesta: ${result.response.message.substring(0, 100)}...`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  console.log('');

  // Test 2: Solicitar catálogo por texto
  console.log('📦 Test 2: Solicitar Catálogo (Texto)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const result = await nlu.processMessage('CATALOGO', { state: 'idle' });
    console.log(`✅ Mensaje: "CATALOGO"`);
    console.log(`   Intención: ${result.intent}`);
    if (result.response.message) {
      const lines = result.response.message.split('\n');
      console.log(`   Respuesta (primeras 10 líneas):`);
      lines.slice(0, 10).forEach(line => console.log(`   ${line}`));
      if (lines.length > 10) {
        console.log(`   ... (${lines.length - 10} líneas más)`);
      }
    }
    if (result.response.productos) {
      console.log(`   ✅ Productos obtenidos: ${result.response.productos.length}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  console.log('');

  // Test 3: Solicitar catálogo con variaciones
  console.log('📦 Test 3: Solicitar Catálogo (Variaciones)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const catalogVariations = [
    'Quiero ver los productos',
    'Muéstrame el catálogo',
    'Qué productos tienen?',
    'PRODUCTOS'
  ];

  for (const message of catalogVariations) {
    try {
      const result = await nlu.processMessage(message, { state: 'idle' });
      console.log(`✅ "${message}" → Intención: ${result.intent}`);
    } catch (error) {
      console.log(`❌ "${message}" → Error: ${error.message}`);
    }
  }
  console.log('');

  // Test 4: Hacer un pedido
  console.log('🛒 Test 4: Hacer un Pedido');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    // Primero obtener algunos productos para hacer un pedido realista
    let productos = null;
    if (kardexDb.isConnected()) {
      productos = await kardexDb.getProductos({ activo: true, limit: 3 });
    } else {
      productos = await kardexApi.getProductos({ activo: true, limit: 3 });
    }

    if (productos && productos.length > 0) {
      const productoEjemplo = productos[0];
      const mensajePedido = `Quiero comprar 2 ${productoEjemplo.nombre}`;
      
      console.log(`✅ Mensaje: "${mensajePedido}"`);
      const result = await nlu.processMessage(mensajePedido, { state: 'idle' });
      console.log(`   Intención: ${result.intent}`);
      
      if (result.response.action === 'create_pending_order') {
        console.log(`   ✅ Pedido creado correctamente`);
        console.log(`   Productos: ${result.response.productos.length}`);
        console.log(`   Total: S/ ${result.response.total.toFixed(2)}`);
      } else if (result.response.message) {
        console.log(`   Respuesta: ${result.response.message.substring(0, 150)}...`);
      }
    } else {
      console.log('⚠️  No hay productos disponibles para probar pedido');
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  console.log('');

  // Test 5: Procesamiento de audio (simulado)
  console.log('🎤 Test 5: Procesamiento de Audio (Simulado)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (whisper.isOpenAIAvailable()) {
    console.log('✅ OpenAI Whisper API está disponible');
    console.log('   💡 Para probar con audio real:');
    console.log('      1. Envía un mensaje de voz desde WhatsApp');
    console.log('      2. El bot lo transcribirá automáticamente');
    console.log('      3. Luego procesará el texto transcrito');
  } else {
    console.log('⚠️  OpenAI Whisper API no está disponible');
    const localAvailable = await whisper.checkLocalInstallation();
    if (localAvailable) {
      console.log('✅ Whisper local está disponible como fallback');
    } else {
      console.log('❌ Whisper local no está instalado');
      console.log('   💡 Instala con: pip install openai-whisper');
    }
  }
  
  // Simular transcripción de audio
  console.log('\n   Simulando transcripción de audio...');
  const audioTranscription = 'Muéstrame el catálogo de productos';
  console.log(`   Transcripción simulada: "${audioTranscription}"`);
  
  try {
    const result = await nlu.processMessage(audioTranscription, { state: 'idle' });
    console.log(`   ✅ Procesado correctamente`);
    console.log(`   Intención: ${result.intent}`);
    if (result.intent === 'catalog') {
      console.log(`   ✅ El sistema entendió que quiere ver el catálogo`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  console.log('');

  // Resumen
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                          📊 RESUMEN                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  
  console.log('✅ Pruebas de mensajes de texto completadas');
  console.log('✅ Pruebas de solicitud de catálogo completadas');
  console.log('✅ Pruebas de procesamiento de pedidos completadas');
  console.log('\n💡 Para probar con WhatsApp real:');
  console.log('   1. Inicia el bot: npm start');
  console.log('   2. Escanea el QR que aparece');
  console.log('   3. Envía mensajes desde otro teléfono:');
  console.log('      - "Hola"');
  console.log('      - "CATALOGO" o "Muéstrame productos"');
  console.log('      - "Quiero comprar 2 laptops"');
  console.log('   4. Para probar audio:');
  console.log('      - Envía un mensaje de voz diciendo "muéstrame el catálogo"');
  console.log('      - El bot transcribirá y procesará el mensaje\n');

  // Cerrar conexiones
  await kardexDb.close();
}

// Ejecutar pruebas
testMessages().catch(error => {
  console.error('❌ Error en pruebas:', error);
  process.exit(1);
});

