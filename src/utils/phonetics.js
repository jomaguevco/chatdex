/**
 * Utilidades fonéticas simples (Soundex-like para español)
 */
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/**
 * Soundex simplificado en español
 */
function soundexEs(word) {
  const s = normalize(word);
  if (!s) return '';
  const first = s[0];
  const map = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
    h: '', w: '', y: ''
  };
  let result = first.toUpperCase();
  let prev = map[first] || '';
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    const code = map[ch] !== undefined ? map[ch] : '';
    if (code !== '' && code !== prev) {
      result += code;
    }
    prev = code;
  }
  return (result + '000').slice(0, 4);
}

/**
 * Similaridad fonética: 1 si soundex coincide, si no, 0
 * (para uso combinado con otras métricas)
 */
function phoneticSimilarity(a, b) {
  const sa = soundexEs(a);
  const sb = soundexEs(b);
  if (!sa || !sb) return 0;
  return sa === sb ? 1 : 0;
}

/**
 * Jaro-Winkler distance (similaridad) en [0,1]
 */
function jaroWinkler(s1, s2) {
  s1 = normalize(s1);
  s2 = normalize(s2);
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
  // Winkler prefix scale
  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2) && s1[i] === s2[i]; i++) prefix++;
  const jw = jaro + prefix * 0.1 * (1 - jaro);
  return jw;
}

/**
 * Clave fonética para una frase (concatena soundex de tokens)
 */
function computePhoneticKey(phrase) {
  const tokens = normalize(phrase).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens.map(t => soundexEs(t)).join('-');
}

/**
 * Similaridad combinada fonética+JW (ponderable)
 */
function combinedSimilarity(a, b, { phoneticWeight = 0.3 } = {}) {
  const jw = jaroWinkler(a, b);
  const ph = phoneticSimilarity(a, b);
  return phoneticWeight * ph + (1 - phoneticWeight) * jw;
}

module.exports = {
  normalize,
  soundexEs,
  phoneticSimilarity,
  jaroWinkler,
  computePhoneticKey,
  combinedSimilarity
};


