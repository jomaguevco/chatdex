const productCache = require('./productCache');
const { normalizeQuery } = require('./textCorrector');
const { combinedSimilarity, normalize: normalizePhon } = require('./phonetics');
const kardexApi = require('../kardexApi');
const logger = require('./logger');

/**
 * Empata productos usando caché local + similitud combinada.
 * - query: texto buscado
 * - category: slug/nombre de categoría (opcional)
 * - options: { limit, threshold, categoryBoost }
 */
async function matchProducts({ query, category }, options = {}) {
  const {
    limit = 10,
    threshold = 0.55,
    categoryBoost = 0.15
  } = options;

  const q = normalizeQuery(query);
  if (!q) return [];

  // Asegurar que la caché está cargada
  let listado = [];
  try {
    listado = await kardexApi.getProductos({ activo: true, limit: 1000 });
  } catch (e) {
    logger.warn('No se pudo obtener productos para índice local', e.message);
  }
  if (Array.isArray(listado) && listado.length > 0) {
    // productCache.indexProducts ya hace reset interno
    const { normalize: phonNormalize, soundexEs } = require('./phonetics');
    productCache.indexProducts(listado, { normalize: phonNormalize, soundex: soundexEs });
  }

  // Candidatos por tokens + fonética
  const candidates = productCache.findCandidates(q, {
    normalize: normalizePhon,
    soundex: require('./phonetics').soundexEs,
    limit: limit * 5
  });

  // Si hay categoría, añadir candidatos de la categoría
  let categoryCandidates = [];
  const catKey = (category || '').toString().toLowerCase().trim();
  if (catKey) {
    categoryCandidates = productCache.getByCategory(catKey, { limit: limit * 10 });
  }

  // Unir candidatos
  const unionMap = new Map();
  [...candidates, ...categoryCandidates].forEach(p => {
    if (p && p.id && !unionMap.has(p.id)) unionMap.set(p.id, p);
  });
  const union = Array.from(unionMap.values());

  // Score combinado
  const nq = normalizePhon(q);
  const scored = union.map(p => {
    const name = normalizePhon(p.nombre || '');
    let score = combinedSimilarity(nq, name, { phoneticWeight: 0.35 });
    // Bonus por inclusión directa como substring
    if (name.includes(nq)) score += 0.25;
    // Bonus por categoría coincidente
    const pcat = (p.categoria_slug || p.categoria || p.category || '').toString().toLowerCase().trim();
    if (catKey && pcat && pcat.includes(catKey)) score += categoryBoost;
    return { p, score };
  }).filter(s => s.score >= Math.max(0, Math.min(1, threshold)))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => ({ ...s.p, _score: s.score }));
}

module.exports = { matchProducts };


