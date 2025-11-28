/**
 * Corrector de Transcripciones de Whisper
 * 
 * Este módulo contiene un diccionario exhaustivo de correcciones para las transcripciones
 * de Whisper, cubriendo todo el flujo del pedido desde la creación hasta el pago final.
 * 
 * Basado en errores comunes de transcripción de Whisper para español latinoamericano.
 */

class TranscriptionCorrector {
  constructor() {
    // Diccionario exhaustivo de correcciones organizado por categorías
    this.correcciones = {
      // ========== CONFIRMACIÓN DE PEDIDO ==========
      confirmo: [
        'confirmo', 'confirmar', 'confirma', 'confirm', 'confirmé', 'confirmado', 'confirmamos',
        // Variantes de transcripción de Whisper (más exhaustivas)
        'firumon', 'firmon', 'confirno', 'firumo', 'firmo', 'confirno', 'confirno',
        'conconfirmo', 'conconfirmar', 'conconfirma', 'conconfirm', 'conconfirmado',
        'confirno', 'confirno', 'confirno', 'confirno', 'confirno',
        'firumon', 'firmon', 'firumo', 'firmo', 'firmon', 'firumon',
        'confirmo confirmo', 'confirmar confirmar', 'confirma confirma',
        'si confirmo', 'sí confirmo', 'si confirmar', 'sí confirmar', 'si confirma', 'sí confirma',
        'ok confirmo', 'okay confirmo', 'ok confirmar', 'okay confirmar', 'ok confirma', 'okay confirma',
        'acepto', 'aceptar', 'aceptado', 'aceptamos', 'acepta', 'aceptas',
        'yes', 'yeah', 'yep', 'ok', 'okay', 'vale', 'de acuerdo', 'está bien', 'esta bien',
        'listo', 'listo confirmo', 'listo confirmar', 'listo confirma',
        'correcto', 'correcto confirmo', 'correcto confirmar',
        'perfecto', 'perfecto confirmo', 'perfecto confirmar',
        'si', 'sí', 'si si', 'sí sí', 'si si confirmo', 'sí sí confirmo',
        'dale', 'dale confirmo', 'dale confirmar', 'vamos', 'vamos confirmo',
        'proceder', 'proceder con', 'proceder con el pedido', 'proceder con pedido',
        'continuar', 'continuar con', 'continuar con el pedido', 'continuar con pedido',
        'seguir', 'seguir con', 'seguir con el pedido', 'seguir con pedido',
        'finalizar', 'finalizar pedido', 'finalizar el pedido',
        'completar', 'completar pedido', 'completar el pedido',
        'terminar', 'terminar pedido', 'terminar el pedido',
        // Variantes fonéticas adicionales
        'confirno', 'confirno', 'confirno', 'confirno', 'confirno',
        'firumon', 'firmon', 'firumo', 'firmo', 'firmon', 'firumon',
        'confirno', 'confirno', 'confirno', 'confirno', 'confirno',
        'conconfirmo', 'conconfirmar', 'conconfirma', 'conconfirm',
        'confirno', 'confirno', 'confirno', 'confirno', 'confirno'
      ],
      
      // ========== CREAR/HACER PEDIDO ==========
      pedido: [
        'pedido', 'pedidos', 'pedir', 'pedimos', 'pedí', 'pediste', 'pedirá', 'pediremos',
        // Variantes de transcripción de Whisper (más exhaustivas)
        'periodo', 'perió', 'pevivo', 'teído', 'pediro', 'pedio', 'pevido', 'perido',
        'período', 'perido', 'pevido', 'pevivo', 'teído', 'pediro', 'pedio',
        'periodos', 'periós', 'pevivos', 'teídos', 'pediros', 'pedios', 'pevidos', 'peridos',
        'hacer pedido', 'hacer un pedido', 'hacer pedidos', 'hacer una pedido',
        'quiero pedido', 'quiero un pedido', 'quiero hacer pedido', 'quiero hacer un pedido',
        'quiera pedido', 'quiera un pedido', 'quiera hacer pedido', 'quiera hacer un pedido',
        'necesito pedido', 'necesito un pedido', 'necesito hacer pedido', 'necesito hacer un pedido',
        'necesito comprar', 'necesito comprar algo', 'necesito hacer compra',
        'vamos a pedir', 'vamos a hacer pedido', 'vamos a hacer un pedido', 'vamos a hacer pedidos',
        'va a ser pedido', 'va a ser un pedido', 'va a ser periodo', 'va a ser un periodo',
        'va a ser pevivo', 'va a ser teído', 'va a ser pediro', 'va a ser pedio',
        'tras ser pedido', 'tras ser un pedido', 'tras ser periodo', 'tras ser un periodo',
        'tras ser pevivo', 'tras ser teído', 'tras ser pediro', 'tras ser pedio',
        'ser pedido', 'ser un pedido', 'ser periodo', 'ser un periodo',
        'ser pevivo', 'ser teído', 'ser pediro', 'ser pedio',
        'comprar', 'comprar algo', 'hacer compra', 'hacer una compra', 'hacer compras',
        'orden', 'ordenar', 'ordenes', 'ordenes de', 'ordenar algo', 'hacer orden',
        'solicitar', 'solicitar pedido', 'solicitar un pedido', 'solicitar pedidos',
        'encargar', 'encargar pedido', 'encargar un pedido', 'encargar pedidos',
        'adquirir', 'adquirir producto', 'adquirir productos',
        'tomar', 'tomar pedido', 'tomar un pedido', 'tomar pedidos',
        'realizar', 'realizar pedido', 'realizar un pedido', 'realizar pedidos',
        'generar', 'generar pedido', 'generar un pedido', 'generar pedidos',
        'crear', 'crear pedido', 'crear un pedido', 'crear pedidos',
        'iniciar', 'iniciar pedido', 'iniciar un pedido', 'iniciar pedidos',
        'empezar', 'empezar pedido', 'empezar un pedido', 'empezar pedidos',
        'comenzar', 'comenzar pedido', 'comenzar un pedido', 'comenzar pedidos',
        // Frases completas comunes
        'quiero hacer un pedido de', 'quiero hacer pedido de', 'quiero hacer un pedido',
        'necesito hacer un pedido de', 'necesito hacer pedido de', 'necesito hacer un pedido',
        'vamos a hacer un pedido de', 'vamos a hacer pedido de', 'vamos a hacer un pedido',
        'dame', 'deme', 'dame un', 'deme un', 'dame una', 'deme una',
        'quiero', 'quiero un', 'quiero una', 'quiero comprar', 'quiero comprar un', 'quiero comprar una',
        'necesito', 'necesito un', 'necesito una', 'necesito comprar', 'necesito comprar un', 'necesito comprar una'
      ],
      
      // ========== CANCELAR ==========
      cancelar: [
        'cancelar', 'cancel', 'cancelado', 'cancelamos', 'cancelo', 'cancela', 'cancelas',
        // Variantes de transcripción de Whisper (más exhaustivas)
        'gonzilar', 'gonzillar', 'gonzil', 'cancilar', 'cancillar', 'cancil',
        'cancilar', 'cancillar', 'cancil', 'cancelo', 'cancela', 'cancelas',
        'gonzilar', 'gonzillar', 'gonzil', 'cancilar', 'cancillar', 'cancil',
        'no quiero', 'no quiero pedido', 'no quiero el pedido', 'no quiero este pedido',
        'no quiero nada', 'no quiero comprar', 'no quiero hacer pedido',
        'eliminar', 'eliminar pedido', 'eliminar el pedido', 'eliminar este pedido',
        'borrar', 'borrar pedido', 'borrar el pedido', 'borrar este pedido',
        'quitar', 'quitar pedido', 'quitar el pedido', 'quitar este pedido',
        'anular', 'anular pedido', 'anular el pedido', 'anular este pedido',
        'descartar', 'descartar pedido', 'descartar el pedido', 'descartar este pedido',
        'deshacer', 'deshacer pedido', 'deshacer el pedido', 'deshacer este pedido',
        'no', 'no gracias', 'no quiero', 'no quiero nada', 'no quiero comprar',
        'olvidar', 'olvidar pedido', 'olvidar el pedido', 'olvidar este pedido',
        'ignorar', 'ignorar pedido', 'ignorar el pedido', 'ignorar este pedido',
        'no hacer', 'no hacer pedido', 'no hacer el pedido', 'no hacer este pedido',
        'no proceder', 'no proceder con', 'no proceder con el pedido', 'no proceder con pedido',
        'no continuar', 'no continuar con', 'no continuar con el pedido', 'no continuar con pedido',
        'no seguir', 'no seguir con', 'no seguir con el pedido', 'no seguir con pedido',
        'detener', 'detener pedido', 'detener el pedido', 'detener este pedido',
        'parar', 'parar pedido', 'parar el pedido', 'parar este pedido',
        'terminar', 'terminar pedido', 'terminar el pedido', 'terminar este pedido',
        'cerrar', 'cerrar pedido', 'cerrar el pedido', 'cerrar este pedido'
      ],
      
      // ========== AUTENTICACIÓN - SOY CLIENTE ==========
      siSoyCliente: [
        'si', 'sí', 'yes', 'yep', 'yeah', 'claro', 'correcto', 'exacto', 'cierto', 'verdad',
        'si soy', 'sí soy', 'si soy cliente', 'sí soy cliente', 'si soy registrado', 'sí soy registrado',
        'soy cliente', 'soy registrado', 'tengo cuenta', 'ya tengo', 'tengo cuenta registrada',
        'si estoy', 'sí estoy', 'si estoy registrado', 'sí estoy registrado', 'si estoy cliente', 'sí estoy cliente',
        'correcto soy', 'correcto soy cliente', 'exacto soy cliente', 'cierto soy', 'cierto soy cliente',
        'si tengo', 'sí tengo', 'si tengo cuenta', 'sí tengo cuenta', 'si tengo registro', 'sí tengo registro',
        'ya soy', 'ya soy cliente', 'ya estoy', 'ya estoy registrado', 'ya estoy cliente',
        'cliente', 'registrado', 'tengo', 'soy', 'estoy', 'tengo cuenta', 'tengo registro',
        'si claro', 'sí claro', 'si correcto', 'sí correcto', 'si exacto', 'sí exacto',
        'claro que si', 'claro que sí', 'claro que soy', 'claro que soy cliente',
        'por supuesto', 'por supuesto que si', 'por supuesto que sí', 'por supuesto que soy',
        'efectivamente', 'efectivamente soy', 'efectivamente soy cliente',
        'así es', 'así es soy', 'así es soy cliente', 'así es tengo cuenta',
        'correcto tengo', 'correcto tengo cuenta', 'correcto estoy registrado',
        'si ya tengo', 'sí ya tengo', 'si ya tengo cuenta', 'sí ya tengo cuenta',
        'ya tengo cuenta', 'ya tengo registro', 'ya estoy registrado', 'ya estoy cliente',
        'tengo una cuenta', 'tengo un registro', 'estoy registrado', 'estoy cliente',
        'soy un cliente', 'soy una cliente', 'soy cliente registrado', 'soy cliente de ustedes',
        'si me registre', 'sí me registré', 'si me registre antes', 'sí me registré antes',
        'me registre', 'me registré', 'me registre antes', 'me registré antes',
        'ya me registre', 'ya me registré', 'ya me registre antes', 'ya me registré antes',
        'tengo usuario', 'tengo un usuario', 'tengo mi usuario', 'tengo mi cuenta',
        'si tengo usuario', 'sí tengo usuario', 'si tengo mi usuario', 'sí tengo mi usuario'
      ],
      
      // ========== AUTENTICACIÓN - NO SOY CLIENTE ==========
      noSoyCliente: [
        'no', 'n', 'tampoco', 'no soy', 'no estoy', 'no tengo',
        'no tengo cuenta', 'todavia no', 'todavía no', 'aun no', 'aún no',
        'no registrado', 'no soy cliente', 'no estoy registrado',
        'no tengo cuenta', 'no tengo registro', 'no estoy registrado',
        'nuevo', 'nuevo cliente', 'quiero registrarme', 'quiero registrarse',
        'registrar', 'registrarme', 'crear cuenta', 'hacer cuenta'
      ],
      
      // ========== MÉTODOS DE PAGO ==========
      transferencia: [
        'transferencia', 'transferencias', 'transferir', 'transferencia bancaria', 'transferencias bancarias',
        'banco', 'bancaria', 'bancario', 'bancos', 'bancarias', 'bancarios',
        'deposito', 'depósito', 'depositos', 'depósitos', 'depositar', 'depositaré',
        'deposito bancario', 'depósito bancario', 'depositos bancarios', 'depósitos bancarios',
        'transferencia de banco', 'transferencias de banco', 'transferir a banco',
        'tranferencia', 'tranferencias', 'tranferir', 'tranferencias bancarias', // Errores comunes
        'transfer', 'bank transfer', 'banking', 'banco transfer', 'bank transfers',
        'por transferencia', 'con transferencia', 'mediante transferencia', 'vía transferencia',
        'transferencia bancaria', 'transferencia de banco', 'transferencia por banco',
        'deposito', 'depósito', 'deposito en banco', 'depósito en banco',
        'transferir dinero', 'transferir a cuenta', 'transferir a mi cuenta',
        'pago por transferencia', 'pagar por transferencia', 'pago con transferencia', 'pagar con transferencia',
        'pago bancario', 'pago por banco', 'pago con banco', 'pago mediante banco',
        'transferencia electronica', 'transferencia electrónica', 'transferencia digital',
        'transferencia interbancaria', 'transferencia entre bancos'
      ],
      
      efectivo: [
        'efectivo', 'cash', 'dinero', 'dinero en efectivo', 'dinero efectivo',
        'pago en efectivo', 'pagar en efectivo', 'con efectivo', 'pago con efectivo', 'pagar con efectivo',
        'efectivo', 'efectivo', 'efectivo', 'efectivo', 'en efectivo', 'con efectivo',
        'pago efectivo', 'pagar efectivo', 'pago en cash', 'pagar en cash',
        'pago en dinero', 'pagar en dinero', 'pago con dinero', 'pagar con dinero',
        'pago en billetes', 'pagar en billetes', 'pago con billetes', 'pagar con billetes',
        'pago en moneda', 'pagar en moneda', 'pago con moneda', 'pagar con moneda',
        'pago físico', 'pagar físico', 'pago presencial', 'pagar presencial',
        'pago al contado', 'pagar al contado', 'pago contado', 'pagar contado',
        'pago directo', 'pagar directo', 'pago inmediato', 'pagar inmediato',
        'efectivo en mano', 'efectivo en efectivo', 'efectivo cash'
      ],
      
      yape: [
        'yape', 'yapear', 'yapeo', 'pago yape', 'con yape', 'por yape', 'mediante yape', 'vía yape',
        'yape', 'yape', 'yape', 'yape', 'yapeo', 'yapear', 'yapeando', 'yapeado',
        'pago con yape', 'pagar con yape', 'pago por yape', 'pagar por yape',
        'pago mediante yape', 'pagar mediante yape', 'pago vía yape', 'pagar vía yape',
        'yapear dinero', 'yapear el pago', 'yapear el monto', 'yapear el total',
        'pago yape', 'pagar yape', 'pago con yape', 'pagar con yape',
        'yapeo', 'yapear', 'yapeando', 'yapeado', 'yapear', 'yapeo',
        'pago por yape', 'pagar por yape', 'pago mediante yape', 'pagar mediante yape',
        'yape', 'yape', 'yape', 'yape', 'yape', 'yape'
      ],
      
      plin: [
        'plin', 'pline', 'plin', 'pago plin', 'con plin', 'por plin', 'mediante plin', 'vía plin',
        'plin', 'plin', 'plin', 'plin', 'pline', 'plino', 'plinar', 'plinando',
        'pago con plin', 'pagar con plin', 'pago por plin', 'pagar por plin',
        'pago mediante plin', 'pagar mediante plin', 'pago vía plin', 'pagar vía plin',
        'plinar dinero', 'plinar el pago', 'plinar el monto', 'plinar el total',
        'pago plin', 'pagar plin', 'pago con plin', 'pagar con plin',
        'pline', 'plino', 'plinar', 'plinando', 'plinar', 'plino',
        'pago por plin', 'pagar por plin', 'pago mediante plin', 'pagar mediante plin',
        'plin', 'plin', 'plin', 'plin', 'plin', 'plin'
      ],
      
      // ========== VER PEDIDO ==========
      verPedido: [
        'ver pedido', 'ver mi pedido', 'ver el pedido', 'ver pedidos', 'ver este pedido',
        'mostrar pedido', 'mostrar mi pedido', 'mostrar el pedido', 'mostrar pedidos', 'mostrar este pedido',
        'ver resumen', 'ver resumen del pedido', 'ver resumen de pedido', 'ver resumen del pedido actual',
        'pedido actual', 'mi pedido', 'el pedido', 'pedidos', 'este pedido', 'pedido de ahora',
        'ver orden', 'ver mi orden', 'ver la orden', 'ver ordenes', 'ver esta orden',
        'mostrar orden', 'mostrar mi orden', 'mostrar la orden', 'mostrar ordenes', 'mostrar esta orden',
        'ver detalle', 'ver detalle del pedido', 'ver detalle de pedido', 'ver detalles',
        'mostrar detalle', 'mostrar detalle del pedido', 'mostrar detalle de pedido', 'mostrar detalles',
        'ver información', 'ver información del pedido', 'ver información de pedido',
        'mostrar información', 'mostrar información del pedido', 'mostrar información de pedido',
        'ver estado', 'ver estado del pedido', 'ver estado de pedido',
        'mostrar estado', 'mostrar estado del pedido', 'mostrar estado de pedido',
        'que tengo', 'qué tengo', 'que tengo en pedido', 'qué tengo en pedido',
        'que pedido', 'qué pedido', 'que pedido tengo', 'qué pedido tengo',
        'cual pedido', 'cuál pedido', 'cual es mi pedido', 'cuál es mi pedido',
        'resumen', 'resumen del pedido', 'resumen de pedido', 'resumen actual',
        'detalle', 'detalle del pedido', 'detalle de pedido', 'detalles del pedido'
      ],
      
      // ========== ELIMINAR PRODUCTO ==========
      eliminar: [
        'eliminar', 'eliminar producto', 'eliminar el producto', 'eliminar este producto',
        'quitar', 'quitar producto', 'quitar el producto', 'quitar este producto',
        'borrar', 'borrar producto', 'borrar el producto', 'borrar este producto',
        'remover', 'remover producto', 'remover el producto', 'remover este producto',
        'sacar', 'sacar producto', 'sacar el producto', 'sacar este producto',
        'quitar del pedido', 'eliminar del pedido', 'borrar del pedido', 'remover del pedido',
        'quitar producto del pedido', 'eliminar producto del pedido', 'borrar producto del pedido',
        'quitar del carrito', 'eliminar del carrito', 'borrar del carrito', 'remover del carrito',
        'no quiero este', 'no quiero este producto', 'no quiero el producto',
        'no necesito este', 'no necesito este producto', 'no necesito el producto',
        'quitar item', 'eliminar item', 'borrar item', 'remover item',
        'quitar artículo', 'eliminar artículo', 'borrar artículo', 'remover artículo',
        'quitar elemento', 'eliminar elemento', 'borrar elemento', 'remover elemento',
        'descartar producto', 'descartar el producto', 'descartar este producto',
        'no incluir', 'no incluir producto', 'no incluir el producto', 'no incluir este producto'
      ],
      
      // ========== CATÁLOGO ==========
      catalogo: [
        'catalogo', 'catálogo', 'catalogos', 'catálogos', 'ver catalogo', 'ver catálogo',
        'productos', 'producto', 'ver productos', 'ver producto', 'mostrar productos', 'mostrar producto',
        'listar productos', 'listar producto', 'lista de productos', 'lista productos',
        'inventario', 'stock', 'disponibles', 'disponible', 'productos disponibles', 'producto disponible',
        'que hay', 'qué hay', 'que tienen', 'qué tienen', 'que tienen disponible', 'qué tienen disponible',
        'que productos', 'qué productos', 'que producto', 'qué producto', 'que productos tienen', 'qué productos tienen',
        'que venden', 'qué venden', 'que venden ustedes', 'qué venden ustedes',
        'que tienen a la venta', 'qué tienen a la venta', 'que tienen en venta', 'qué tienen en venta',
        'mostrar todo', 'mostrar todos', 'mostrar todos los productos', 'mostrar todo el catalogo',
        'ver todo', 'ver todos', 'ver todos los productos', 'ver todo el catalogo',
        'listar todo', 'listar todos', 'listar todos los productos', 'listar todo el catalogo',
        'productos en stock', 'producto en stock', 'productos disponibles', 'producto disponible',
        'que tienen disponible', 'qué tienen disponible', 'que hay disponible', 'qué hay disponible',
        'mostrar inventario', 'ver inventario', 'listar inventario',
        'mostrar stock', 'ver stock', 'listar stock',
        'catalogo completo', 'catálogo completo', 'catalogo de productos', 'catálogo de productos',
        'todos los productos', 'todo el catalogo', 'todo el catálogo',
        'productos que tienen', 'productos disponibles', 'productos en venta'
      ],
      
      // ========== AYUDA ==========
      ayuda: [
        'ayuda', 'help', 'ayudame', 'ayúdame', 'ayudar', 'necesito ayuda', 'necesito ayudame',
        'que puedo', 'qué puedo', 'que puedo hacer', 'qué puedo hacer', 'que puedo hacer aqui', 'qué puedo hacer aquí',
        'opciones', 'menu', 'menú', 'comandos', 'que hacer', 'qué hacer', 'que puedo hacer', 'qué puedo hacer',
        'como funciona', 'cómo funciona', 'como usar', 'cómo usar', 'como se usa', 'cómo se usa',
        'instrucciones', 'guia', 'guía', 'tutorial', 'manual', 'como funciona esto', 'cómo funciona esto',
        'que opciones', 'qué opciones', 'que opciones tengo', 'qué opciones tengo',
        'que comandos', 'qué comandos', 'que comandos hay', 'qué comandos hay',
        'que puedo pedir', 'qué puedo pedir', 'que puedo comprar', 'qué puedo comprar',
        'como pedir', 'cómo pedir', 'como hacer pedido', 'cómo hacer pedido',
        'como comprar', 'cómo comprar', 'como hacer compra', 'cómo hacer compra',
        'informacion', 'información', 'necesito informacion', 'necesito información',
        'soporte', 'necesito soporte', 'ayuda por favor', 'ayúdame por favor',
        'no entiendo', 'no entiendo como funciona', 'no entiendo cómo funciona',
        'explicame', 'explícame', 'explicame como funciona', 'explícame cómo funciona',
        'que hago', 'qué hago', 'que debo hacer', 'qué debo hacer',
        'orientacion', 'orientación', 'necesito orientacion', 'necesito orientación'
      ],
      
      // ========== MIS PEDIDOS ==========
      misPedidos: [
        'mis pedidos', 'mi pedido', 'mis ordenes', 'mi orden', 'mis ordenes anteriores', 'mis pedidos anteriores',
        'historial', 'historial de pedidos', 'historial de ordenes', 'mi historial', 'mi historial de pedidos',
        'pedidos anteriores', 'ordenes anteriores', 'pedidos pasados', 'ordenes pasados',
        'ver mis pedidos', 'ver mi pedido', 'ver mis ordenes', 'ver mi orden',
        'mostrar mis pedidos', 'mostrar mi pedido', 'mostrar mis ordenes', 'mostrar mi orden',
        'pedidos que hice', 'ordenes que hice', 'pedidos que he hecho', 'ordenes que he hecho',
        'mis compras', 'mis compras anteriores', 'compras que hice', 'compras que he hecho',
        'pedidos previos', 'ordenes previas', 'pedidos anteriores', 'ordenes anteriores',
        'ver historial', 'ver mi historial', 'ver historial de pedidos', 'ver historial de ordenes',
        'mostrar historial', 'mostrar mi historial', 'mostrar historial de pedidos', 'mostrar historial de ordenes',
        'pedidos realizados', 'ordenes realizadas', 'pedidos que realice', 'ordenes que realice',
        'pedidos completados', 'ordenes completadas', 'pedidos finalizados', 'ordenes finalizadas',
        'pedidos entregados', 'ordenes entregadas', 'pedidos que me entregaron', 'ordenes que me entregaron',
        'que pedidos', 'qué pedidos', 'que pedidos hice', 'qué pedidos hice',
        'cuales pedidos', 'cuáles pedidos', 'cuales son mis pedidos', 'cuáles son mis pedidos'
      ],
      
      // ========== OLVIDÉ CONTRASEÑA ==========
      olvideContrasena: [
        'olvide', 'olvidé', 'olvide mi contraseña', 'olvidé mi contraseña', 'olvide contraseña', 'olvidé contraseña',
        'olvide la contraseña', 'olvidé la contraseña', 'olvide mi contraseña', 'olvidé mi contraseña',
        'no recuerdo', 'no recuerdo contraseña', 'no recuerdo la contraseña', 'no recuerdo mi contraseña',
        'perdí', 'perdi', 'perdí contraseña', 'perdi contraseña', 'perdí la contraseña', 'perdi la contraseña',
        'perdí mi contraseña', 'perdi mi contraseña', 'perdí mi contraseña', 'perdi mi contraseña',
        'recuperar', 'recuperar contraseña', 'recuperar la contraseña', 'recuperar mi contraseña',
        'resetear', 'resetear contraseña', 'resetear la contraseña', 'resetear mi contraseña',
        'cambiar contraseña', 'cambiar la contraseña', 'cambiar mi contraseña',
        'restablecer', 'restablecer contraseña', 'restablecer la contraseña', 'restablecer mi contraseña',
        'nueva contraseña', 'quiero nueva contraseña', 'necesito nueva contraseña',
        'olvide password', 'olvidé password', 'olvide mi password', 'olvidé mi password',
        'no recuerdo password', 'no recuerdo la password', 'no recuerdo mi password',
        'perdí password', 'perdi password', 'perdí la password', 'perdi la password',
        'perdí mi password', 'perdi mi password', 'recuperar password', 'recuperar mi password',
        'resetear password', 'resetear la password', 'resetear mi password',
        'cambiar password', 'cambiar la password', 'cambiar mi password',
        'olvide clave', 'olvidé clave', 'olvide mi clave', 'olvidé mi clave',
        'no recuerdo clave', 'no recuerdo la clave', 'no recuerdo mi clave',
        'perdí clave', 'perdi clave', 'perdí la clave', 'perdi la clave',
        'perdí mi clave', 'perdi mi clave', 'recuperar clave', 'recuperar mi clave',
        'resetear clave', 'resetear la clave', 'resetear mi clave',
        'cambiar clave', 'cambiar la clave', 'cambiar mi clave'
      ],
      
      // ========== NÚMEROS (para teléfono) ==========
      numeros: {
        'cero': '0', 'uno': '1', 'dos': '2', 'tres': '3', 'cuatro': '4',
        'cinco': '5', 'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9',
        'diez': '10', 'once': '11', 'doce': '12', 'trece': '13', 'catorce': '14',
        'quince': '15', 'dieciséis': '16', 'diecisiete': '17', 'dieciocho': '18',
        'diecinueve': '19', 'veinte': '20'
      }
    };
    
    // Mapeo de correcciones a palabras clave finales
    this.mapeoFinal = {
      // Confirmación
      confirmo: 'confirmo',
      confirmar: 'confirmar',
      confirma: 'confirma',
      
      // Pedido
      pedido: 'pedido',
      pedir: 'pedir',
      hacerPedido: 'hacer pedido',
      quieroPedido: 'quiero pedido',
      
      // Cancelar
      cancelar: 'cancelar',
      cancel: 'cancelar',
      
      // Autenticación
      si: 'si',
      no: 'no',
      soyCliente: 'soy cliente',
      
      // Métodos de pago
      transferencia: 'transferencia',
      efectivo: 'efectivo',
      yape: 'yape',
      plin: 'plin',
      
      // Otros
      verPedido: 'ver pedido',
      eliminar: 'eliminar',
      catalogo: 'catalogo',
      ayuda: 'ayuda',
      misPedidos: 'mis pedidos',
      olvideContrasena: 'olvidé mi contraseña'
    };
  }
  
  /**
   * Calcular distancia de Levenshtein (para fuzzy matching)
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0) return len2;
    if (len2 === 0) return len1;
    
    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[len2][len1];
  }
  
  /**
   * Buscar coincidencia más cercana usando fuzzy matching
   */
  buscarCoincidenciaFuzzy(texto, lista, umbral = 0.7) {
    if (!Array.isArray(lista) || lista.length === 0) return null;
    
    const textoLower = texto.toLowerCase().trim();
    let mejorCoincidencia = null;
    let mejorPuntuacion = 0;
    
    for (const variante of lista) {
      const varianteLower = variante.toLowerCase().trim();
      
      // Coincidencia exacta
      if (textoLower === varianteLower || textoLower.includes(varianteLower) || varianteLower.includes(textoLower)) {
        return variante;
      }
      
      // Fuzzy matching
      const distancia = this.levenshteinDistance(textoLower, varianteLower);
      const maxLen = Math.max(textoLower.length, varianteLower.length);
      const similitud = 1 - (distancia / maxLen);
      
      if (similitud >= umbral && similitud > mejorPuntuacion) {
        mejorPuntuacion = similitud;
        mejorCoincidencia = variante;
      }
    }
    
    return mejorCoincidencia;
  }
  
  /**
   * Corregir transcripción aplicando todas las correcciones (versión robusta)
   */
  corregir(transcripcion) {
    if (!transcripcion || typeof transcripcion !== 'string') {
      return transcripcion;
    }
    
    let corregida = transcripcion.trim();
    const original = corregida;
    
    // 1. Corregir duplicaciones comunes al inicio (más exhaustivo)
    corregida = corregida.replace(/^con(confirmo|confirmar|confirma|confirmado)/i, '$1');
    corregida = corregida.replace(/^Con(confirmo|confirmar|confirma|confirmado)/, '$1');
    corregida = corregida.replace(/^con\s+(confirmo|confirmar|confirma)/i, '$1');
    corregida = corregida.replace(/^Con\s+(confirmo|confirmar|confirma)/, '$1');
    
    // 2. Aplicar correcciones del diccionario (búsqueda exhaustiva)
    // Ordenar categorías por prioridad (las más importantes primero)
    const categoriasPrioritarias = ['confirmo', 'pedido', 'cancelar', 'transferencia', 'efectivo', 'yape', 'plin'];
    const otrasCategorias = Object.keys(this.correcciones).filter(cat => !categoriasPrioritarias.includes(cat));
    const ordenCategorias = [...categoriasPrioritarias, ...otrasCategorias];
    
    for (const categoria of ordenCategorias) {
      const variantes = this.correcciones[categoria];
      if (!Array.isArray(variantes)) continue;
      
      // Primero intentar coincidencia exacta (palabra completa)
      for (const variante of variantes) {
        const regex = new RegExp(`\\b${this.escapeRegex(variante)}\\b`, 'gi');
        if (regex.test(corregida)) {
          corregida = corregida.replace(regex, this.mapeoFinal[categoria] || categoria);
          break;
        }
      }
      
      // Si no hay coincidencia exacta, intentar coincidencia parcial para categorías prioritarias
      if (categoriasPrioritarias.includes(categoria)) {
        for (const variante of variantes) {
          const varianteLower = variante.toLowerCase();
          const corregidaLower = corregida.toLowerCase();
          
          // Coincidencia parcial (contiene)
          if (corregidaLower.includes(varianteLower) && varianteLower.length >= 4) {
            corregida = corregida.replace(new RegExp(variante, 'gi'), this.mapeoFinal[categoria] || categoria);
            break;
          }
        }
        
        // Fuzzy matching para palabras clave importantes
        const palabras = corregida.toLowerCase().split(/\s+/);
        for (let i = 0; i < palabras.length; i++) {
          const palabra = palabras[i];
          if (palabra.length >= 4) {
            const coincidencia = this.buscarCoincidenciaFuzzy(palabra, variantes, 0.7);
            if (coincidencia) {
              palabras[i] = this.mapeoFinal[categoria] || categoria;
              corregida = palabras.join(' ');
              break;
            }
          }
        }
      }
    }
    
    // 3. Normalizar espacios múltiples y caracteres especiales
    corregida = corregida.replace(/\s+/g, ' ').trim();
    corregida = corregida.replace(/[.,;:!?]+/g, '').trim(); // Remover puntuación excesiva
    
    // 4. Si no hubo cambios significativos pero hay palabras sospechosas, intentar corrección adicional
    if (corregida === original || corregida.toLowerCase() === original.toLowerCase()) {
      // Buscar patrones comunes de errores (más exhaustivo)
      corregida = corregida.replace(/\b(firumon|firmon|confirno|firumo|firmo|conconfirmo|conconfirmar)\b/gi, 'confirmo');
      corregida = corregida.replace(/\b(periodo|pevivo|teído|pediro|pedio|período|perido|pevido)\b/gi, 'pedido');
      corregida = corregida.replace(/\b(gonzilar|gonzillar|gonzil|cancilar|cancillar|cancil)\b/gi, 'cancelar');
      corregida = corregida.replace(/\b(tranferencia|tranferencias|tranferir)\b/gi, 'transferencia');
      
      // Correcciones adicionales para métodos de pago
      corregida = corregida.replace(/\b(yapeo|yapear|yapeando)\b/gi, 'yape');
      corregida = corregida.replace(/\b(plino|plinar|plinando)\b/gi, 'plin');
    }
    
    // 5. Correcciones finales de normalización
    // Remover duplicaciones de palabras clave
    corregida = corregida.replace(/\b(confirmo\s+confirmo|confirmar\s+confirmar)\b/gi, 'confirmo');
    corregida = corregida.replace(/\b(pedido\s+pedido|pedidos\s+pedidos)\b/gi, 'pedido');
    
    // Normalizar espacios finales
    corregida = corregida.replace(/\s+/g, ' ').trim();
    
    return corregida;
  }
  
  /**
   * Detectar intención principal de la transcripción corregida (versión robusta)
   */
  detectarIntencion(transcripcion) {
    if (!transcripcion || typeof transcripcion !== 'string') {
      return 'desconocido';
    }
    
    const corregida = this.corregir(transcripcion);
    const lower = corregida.toLowerCase().trim();
    const originalLower = transcripcion.toLowerCase().trim();
    
    // Detectar intenciones en orden de prioridad (más robusto)
    
    // 1. CONFIRMACIÓN (prioridad máxima si hay contexto de pedido)
    if (this.coincide(lower, this.correcciones.confirmo) || 
        this.coincide(originalLower, this.correcciones.confirmo) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.confirmo, 0.7)) {
      return 'confirmar_pedido';
    }
    
    // 2. CANCELAR (alta prioridad)
    if (this.coincide(lower, this.correcciones.cancelar) || 
        this.coincide(originalLower, this.correcciones.cancelar) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.cancelar, 0.7)) {
      return 'cancelar_pedido';
    }
    
    // 3. CREAR PEDIDO
    if (this.coincide(lower, this.correcciones.pedido) || 
        this.coincide(originalLower, this.correcciones.pedido) ||
        /(?:quiero|necesito|vamos a|hacer|hacer un|hacer una|quiera|dame|deme)\s+(?:pedido|comprar|orden|periodo|pevivo|teído)/i.test(corregida) ||
        /(?:quiero|necesito|vamos a|hacer|hacer un|hacer una|quiera|dame|deme)\s+(?:pedido|comprar|orden|periodo|pevivo|teído)/i.test(transcripcion) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.pedido, 0.7)) {
      return 'crear_pedido';
    }
    
    // 4. MÉTODOS DE PAGO
    if (this.coincide(lower, this.correcciones.transferencia) || 
        this.coincide(originalLower, this.correcciones.transferencia) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.transferencia, 0.7)) {
      return 'pago_transferencia';
    }
    
    if (this.coincide(lower, this.correcciones.efectivo) || 
        this.coincide(originalLower, this.correcciones.efectivo) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.efectivo, 0.7)) {
      return 'pago_efectivo';
    }
    
    if (this.coincide(lower, this.correcciones.yape) || 
        this.coincide(originalLower, this.correcciones.yape) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.yape, 0.7)) {
      return 'pago_yape';
    }
    
    if (this.coincide(lower, this.correcciones.plin) || 
        this.coincide(originalLower, this.correcciones.plin) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.plin, 0.7)) {
      return 'pago_plin';
    }
    
    // 5. AUTENTICACIÓN
    if (this.coincide(lower, this.correcciones.siSoyCliente) || 
        this.coincide(originalLower, this.correcciones.siSoyCliente) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.siSoyCliente, 0.7)) {
      return 'si_soy_cliente';
    }
    
    if (this.coincide(lower, this.correcciones.noSoyCliente) || 
        this.coincide(originalLower, this.correcciones.noSoyCliente) ||
        this.buscarCoincidenciaFuzzy(lower, this.correcciones.noSoyCliente, 0.7)) {
      return 'no_soy_cliente';
    }
    
    // 6. OTRAS ACCIONES
    if (this.coincide(lower, this.correcciones.verPedido) || 
        this.coincide(originalLower, this.correcciones.verPedido)) {
      return 'ver_pedido';
    }
    
    if (this.coincide(lower, this.correcciones.eliminar) || 
        this.coincide(originalLower, this.correcciones.eliminar)) {
      return 'eliminar_producto';
    }
    
    if (this.coincide(lower, this.correcciones.catalogo) || 
        this.coincide(originalLower, this.correcciones.catalogo)) {
      return 'ver_catalogo';
    }
    
    if (this.coincide(lower, this.correcciones.ayuda) || 
        this.coincide(originalLower, this.correcciones.ayuda)) {
      return 'ayuda';
    }
    
    if (this.coincide(lower, this.correcciones.misPedidos) || 
        this.coincide(originalLower, this.correcciones.misPedidos)) {
      return 'mis_pedidos';
    }
    
    if (this.coincide(lower, this.correcciones.olvideContrasena) || 
        this.coincide(originalLower, this.correcciones.olvideContrasena)) {
      return 'olvide_contrasena';
    }
    
    return 'desconocido';
  }
  
  /**
   * Verificar si el texto coincide con alguna variante de la lista (versión robusta)
   */
  coincide(texto, lista) {
    if (!Array.isArray(lista) || lista.length === 0) return false;
    if (!texto || typeof texto !== 'string') return false;
    
    const textoLower = texto.toLowerCase().trim();
    
    // 1. Coincidencia exacta
    if (lista.some(variante => {
      const varianteLower = variante.toLowerCase().trim();
      return textoLower === varianteLower;
    })) {
      return true;
    }
    
    // 2. Coincidencia parcial (contiene o está contenido)
    if (lista.some(variante => {
      const varianteLower = variante.toLowerCase().trim();
      return textoLower.includes(varianteLower) || varianteLower.includes(textoLower);
    })) {
      return true;
    }
    
    // 3. Coincidencia por palabras completas (regex)
    if (lista.some(variante => {
      const regex = new RegExp(`\\b${this.escapeRegex(variante)}\\b`, 'i');
      return regex.test(textoLower);
    })) {
      return true;
    }
    
    // 4. Fuzzy matching para palabras clave importantes
    const palabrasClave = ['confirmo', 'pedido', 'cancelar', 'transferencia', 'efectivo', 'yape', 'plin'];
    const palabrasTexto = textoLower.split(/\s+/);
    
    for (const palabra of palabrasTexto) {
      if (palabra.length >= 4) {
        for (const variante of lista) {
          const varianteLower = variante.toLowerCase().trim();
          if (varianteLower.length >= 4) {
            const distancia = this.levenshteinDistance(palabra, varianteLower);
            const maxLen = Math.max(palabra.length, varianteLower.length);
            const similitud = 1 - (distancia / maxLen);
            
            // Si la similitud es alta (>= 0.75), considerar coincidencia
            if (similitud >= 0.75) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Escapar caracteres especiales para regex
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  /**
   * Limpiar número de teléfono de transcripción
   */
  limpiarNumeroTelefono(texto) {
    // Reemplazar números escritos por dígitos
    let limpio = texto;
    for (const [palabra, digito] of Object.entries(this.correcciones.numeros)) {
      const regex = new RegExp(`\\b${palabra}\\b`, 'gi');
      limpio = limpio.replace(regex, digito);
    }
    
    // Eliminar todo excepto dígitos
    limpio = limpio.replace(/[^0-9]/g, '');
    
    return limpio;
  }
}

// Exportar instancia singleton
module.exports = new TranscriptionCorrector();

