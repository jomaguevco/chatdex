// Normaliza tildes, mayúsculas y símbolos comunes
function normalizeBasic(input) {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[,.;:¡!¿?"'()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Stopwords básicas en español para consultas de producto
const STOPWORDS = new Set([
  'el','la','los','las','un','una','unos','unas',
  'de','del','al','para','por','con','sin','y','o','u',
  'mi','me','quiero','ver','busco','mostrar','muestrame','ensename',
  'precio','precios','barato','baratos','caro','caros',
  'oferta','ofertas','catalogo','catálogo'
]);

// Sinónimos y alias comunes
const SYNONYMS = [
  [/\baudifonos\b|\baudiofonos\b|\bheadset\b|\bcasco\b/gi, 'audifonos'],
  [/\bauriculares\b/gi, 'audifonos'],
  [/\bplayera\b|\bremera\b/gi, 'camiseta'],
  [/\bpolos?\b/gi, 'camiseta'],
  [/\bnotebook\b|\bportatil(es)?\b/gi, 'laptop'],
  [/\bsmart tv\b|\bsmarttv\b/gi, 'televisor'],
  [/\bcelu\b|\bcelular\b|\bmovil\b/gi, 'telefono'],
  [/\biphone\b/gi, 'apple iphone'],
  [/\bhdd\b/gi, 'disco duro'],
  [/\bssd\b/gi, 'solido ssd'],
  [/\bteclado\b|\bkeyboard\b/gi, 'teclado'],
  [/\bmonitor\b|\bpantalla\b/gi, 'monitor'],
  [/\bimpresora\b|\bprinter\b/gi, 'impresora']
];

// Correcciones de marcas/variantes mal escritas
const BRAND_FIXES = [
  [/\b(adidaz|adidass|adidasz|idas|didas|a\s*didas|dias)\b/gi, 'adidas'],
  [/\bnikke|niqe|nique|naik\b/gi, 'nike'],
  [/\bpumma|puna\b/gi, 'puma'],
  [/\bsansung|samzung|samsungg|samsumg\b/gi, 'samsung'],
  [/\bh\s*p\b/gi, 'hp'],
  [/\blenobo|lenoba|lenob\b/gi, 'lenovo'],
  [/\bmaose|maus|mause|mous\b/gi, 'mouse'],
  [/\bdeel|del\b/gi, 'dell'],
  [/\bassus|asus\b/gi, 'asus'],
  [/\baple|apel|aple\b/gi, 'apple'],
  [/\bxiaomi|xiaom|xiaommi\b/gi, 'xiaomi']
];

// Aliases específicos de productos conocidos (ejemplo pedido)
const PRODUCT_ALIASES = [
  [/\bsony\s*vwh\s*1000\s*xm5\b/gi, 'sony wh 1000 xm5'],
  [/\bwh1000xm5\b/gi, 'wh 1000 xm5'],
  [/\bwh-?1000-?xm5\b/gi, 'wh 1000 xm5'],
  [/\bsony\s*wh\s*1000\s*xm5\b/gi, 'sony wh 1000 xm5']
];

// Correcciones adicionales para palabras mal escritas comúnmente
const COMMON_MISTAKES = [
  // Errores comunes de transcripción de voz - verbos y frases comunes
  [/\bkwero|quierro|quier|kerer|kero|kiero|qero|qiero|quiero que|quiero que|ker\b/gi, 'quiero'],
  [/\bnesesito|necesitio|nesesit|necesit|nesito|nesito|neces\b/gi, 'necesito'],
  [/\bdeme|deme|dame|dam|demen|dame\b/gi, 'deme'],
  [/\buna|un|uno\b/gi, 'una'],
  [/\bdos|2|do|dos unidades|dos de\b/gi, 'dos'],
  [/\btres|3|tre|tres unidades|tres de\b/gi, 'tres'],
  [/\bcuatro|4|cuatr|cuatro unidades|cuatro de\b/gi, 'cuatro'],
  [/\bcinco|5|sinc|cinco unidades|cinco de\b/gi, 'cinco'],
  [/\bseis|6|seis unidades|seis de\b/gi, 'seis'],
  [/\bsiete|7|siete unidades|siete de\b/gi, 'siete'],
  [/\bocho|8|ocho unidades|ocho de\b/gi, 'ocho'],
  [/\bnueve|9|nueve unidades|nueve de\b/gi, 'nueve'],
  [/\bdiez|10|diez unidades|diez de\b/gi, 'diez'],
  [/\bpordeso|por eso|poreso|pores|por eso\b/gi, 'por eso'],
  [/\bpor favor|porfavor|pf|porfa|porf|por favor|porfa\b/gi, 'por favor'],
  [/\bgracias|grasias|gracia|gras|grasias\b/gi, 'gracias'],
  [/\bcuanto|cuánto|cuan|cuant|cuanto vale|cuanto cuesta\b/gi, 'cuánto'],
  [/\bcuesta|cuest|cuest|cuest|vale\b/gi, 'cuesta'],
  [/\btienes|tiene|tien|tenes|tenés|tienen\b/gi, 'tienes'],
  [/\bdisponible|disponibl|dispon|disponibles|hay\b/gi, 'disponible'],
  [/\bprecio|preci|prec|precios|precio de|precio del\b/gi, 'precio'],
  [/\bproducto|product|produ|productos|producto de\b/gi, 'producto'],
  [/\blaptop|lapto|lap|laptops|portátil|portatil|notebook|notebooks\b/gi, 'laptop'],
  [/\bmouse|maus|mous|mice|ratón|raton|ratones\b/gi, 'mouse'],
  [/\bteclado|teclad|tecl|teclados|keyboard\b/gi, 'teclado'],
  [/\bmonitor|monit|mon|monitores|pantalla|pantallas\b/gi, 'monitor'],
  [/\bimpresora|impresor|impresoras|printer|printers\b/gi, 'impresora'],
  [/\bcelular|celulares|celu|cel|móvil|movil|telefono|teléfono|smartphone|smartphones\b/gi, 'celular'],
  [/\baudifonos|audífonos|audifono|auriculares|auricular|headset|headphones|casco|cascos\b/gi, 'audifonos'],
  [/\btelevisor|televisores|tv|tvs|smart tv|smarttv|televisión|television\b/gi, 'televisor'],
  // Frases comunes mal transcritas
  [/\bme gustaría|megustaria|me gustaria|gustaria\b/gi, 'me gustaría'],
  [/\bpuedo ver|puedo ver|puedo ver|puedo ver\b/gi, 'puedo ver'],
  [/\bquiero ver|quiero ver|quiero ver|ver\b/gi, 'quiero ver'],
  [/\bmuéstrame|muestrame|mostrar|muéstrame|mostrar\b/gi, 'muéstrame'],
  [/\bsi tengo|si tengo|si hay|si tienen\b/gi, 'si tengo'],
  [/\bcual es|cuál es|cuál|cual\b/gi, 'cuál es'],
  [/\bcuanto es|cuánto es|cuánto|cual es el precio\b/gi, 'cuánto es'],
  // Ruido común en transcripciones
  [/\bmm+|ahh+|ehh+|um+|eh+|uh+|ah+|em+|hm+\b/gi, ' '],
  [/\s{2,}/g, ' '], // Múltiples espacios
];

function normalizeSpaces(s) {
  return (s || '').replace(/[¿?¡!.,;:"]/g, ' ').replace(/\\s+/g, ' ').trim();
}

// Devuelve texto corregido y normalizado para matching
function correctText(input) {
  if (!input) return input;
  
  // Normalización básica
  let out = ' ' + normalizeBasic(input) + ' ';
  
  // 1. Limpiar ruido común de transcripciones de voz primero
  for (const [pattern, replacement] of COMMON_MISTAKES) {
    out = out.replace(pattern, replacement);
  }
  
  // 2. Correcciones de errores ortográficos comunes
  for (const [pattern, replacement] of COMMON_MISTAKES) {
    out = out.replace(pattern, replacement);
  }
  
  // 3. Aliases de producto
  for (const [pattern, replacement] of PRODUCT_ALIASES) {
    out = out.replace(pattern, replacement);
  }
  
  // 4. Correcciones de marcas y tecnicismos
  for (const [pattern, replacement] of BRAND_FIXES) {
    out = out.replace(pattern, replacement);
  }
  
  // 5. Sinónimos
  for (const [pattern, replacement] of SYNONYMS) {
    out = out.replace(pattern, replacement);
  }
  
  // 6. Limpieza final de espacios y ruido residual
  out = normalizeSpaces(out);
  out = out.replace(/[^\w\sáéíóúñü]/g, ' '); // Eliminar caracteres especiales excepto letras acentuadas
  out = out.replace(/\s+/g, ' ').trim(); // Normalizar espacios
  
  return out;
}

function tokenize(input) {
  const txt = correctText(input);
  return (txt || '').split(/\s+/).filter(Boolean);
}

function removeStopwords(tokens) {
  return (tokens || []).filter(t => !STOPWORDS.has(t));
}

function normalizeQuery(input) {
  const tokens = removeStopwords(tokenize(input));
  return tokens.join(' ');
}

module.exports = {
  correctText,
  tokenize,
  removeStopwords,
  normalizeQuery,
  normalizeBasic
};

