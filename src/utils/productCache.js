const logger = require('./logger');
const { normalizeQuery } = require('./textCorrector');
const { computePhoneticKey } = require('./phonetics');

/**
 * Cache simple en memoria para productos
 */
class ProductCache {
  constructor() {
    this.cache = new Map();
    this.maxAge = 5 * 60 * 1000; // 5 minutos
    this.maxSize = 1000; // Máximo 1000 entradas
    this.tokenIndex = new Map(); // token -> Set(productId)
    this.phoneticIndex = new Map(); // soundex -> Set(productId)
    this.productsById = new Map(); // id -> producto
    this.categoryIndex = new Map(); // category/slug -> Set(productId)
  }

  /**
   * Obtener producto del cache
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Verificar si expiró
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Guardar producto en cache
   */
  set(key, data) {
    // Limpiar cache si está muy lleno
    if (this.cache.size >= this.maxSize) {
      this._cleanOldEntries();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Indexar un listado de productos para búsquedas por tokens y fonética
   */
  indexProducts(productos, { normalize, soundex } = {}) {
    try {
      // Reiniciar índices
      this.tokenIndex.clear();
      this.phoneticIndex.clear();
      this.productsById.clear();
      this.categoryIndex.clear();
      for (const p of productos || []) {
        if (!p || !p.id || !p.nombre) continue;
        this.productsById.set(p.id, p);
        const normalized = typeof normalize === 'function'
          ? normalize(p.nombre)
          : normalizeQuery(p.nombre);
        const name = normalized || (p.nombre || '').toLowerCase();
        const tokens = name.split(/\s+/).filter(Boolean);
        for (const t of tokens) {
          const set = this.tokenIndex.get(t) || new Set();
          set.add(p.id);
          this.tokenIndex.set(t, set);
        }
        if (typeof soundex === 'function') {
          const ph = soundex(name);
          if (ph) {
            const setp = this.phoneticIndex.get(ph) || new Set();
            setp.add(p.id);
            this.phoneticIndex.set(ph, setp);
          }
        }
        // Índice por categoría si existe
        const cat = (p.categoria_slug || p.categoria || p.category || '').toString().toLowerCase().trim();
        if (cat) {
          const setc = this.categoryIndex.get(cat) || new Set();
          setc.add(p.id);
          this.categoryIndex.set(cat, setc);
        }
        // Guardar clave fonética por si se requiere
        p._normalizedName = name;
        p._phoneticKey = computePhoneticKey(name);
      }
    } catch (e) {
      logger.warn('No se pudo indexar productos', e.message);
    }
  }

  /**
   * Buscar candidatos por token o fonética
   */
  findCandidates(query, { normalize, soundex, limit = 20 } = {}) {
    const q = typeof normalize === 'function' ? normalize(query) : normalizeQuery(query);
    const tokens = q.split(/\s+/).filter(Boolean);
    const ids = new Set();
    for (const t of tokens) {
      const set = this.tokenIndex.get(t);
      if (set) set.forEach(id => ids.add(id));
    }
    if (typeof soundex === 'function') {
      const ph = soundex(q);
      const setp = this.phoneticIndex.get(ph);
      if (setp) setp.forEach(id => ids.add(id));
    }
    const results = [];
    ids.forEach(id => {
      const p = this.productsById.get(id);
      if (p) results.push(p);
    });
    return results.slice(0, limit);
  }

  /**
   * Obtener productos por categoría (slug o nombre bajo)
   */
  getByCategory(category, { limit = 50 } = {}) {
    const key = (category || '').toString().toLowerCase().trim();
    if (!key) return [];
    const set = this.categoryIndex.get(key);
    if (!set) return [];
    const results = [];
    set.forEach(id => {
      const p = this.productsById.get(id);
      if (p) results.push(p);
    });
    return results.slice(0, limit);
  }

  /**
   * Limpiar entradas antiguas
   */
  _cleanOldEntries() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    // Si aún está lleno, eliminar las más antiguas
    if (this.cache.size >= this.maxSize) {
      const sortedEntries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toDelete = sortedEntries.slice(0, Math.floor(this.maxSize * 0.2)); // Eliminar 20%
      toDelete.forEach(([key]) => this.cache.delete(key));
    }
  }

  /**
   * Limpiar todo el cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Obtener estadísticas del cache
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      maxAge: this.maxAge
    };
  }
}

module.exports = new ProductCache();

