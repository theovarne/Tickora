// Search and sort the existing feed without changing it or inventing chain coverage.
const aliasGroups = [
  ['binance', '币安'],
  ['uniswap', 'uni swap'],
  ['okx', '欧易', 'okex'],
  ['bybit', '比特', 'bybit_spot', 'by bit'],
  ['coinbase', 'coinbase exchange', 'coin base', 'gdax'],
  ['kraken', '海妖'],
  ['pancakeswap', '薄饼', 'pancake swap'],
  ['pumpfun', 'pump.fun', 'pump fun', 'pumpswap', 'pump swap'],
  ['bitget', 'bit get'],
  ['raydium'],
  ['hyperliquid', '超流', 'hyper liquid'],
  ['fomo', 'fomo wallet', 'fomo spot', 'fomo outcome'],
  ['jupiter', '木星'],
  ['lighter'],
];

function normalize(value) {
  return String(value ?? '').normalize('NFKD').toLowerCase()
    .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

const aliasesByKey = new Map();
for (const group of aliasGroups) {
  for (const alias of group) aliasesByKey.set(normalize(alias), group);
}

export function exchangeAliases(record) {
  const known = aliasesByKey.get(normalize(record?.id))
    ?? aliasesByKey.get(normalize(record?.name)) ?? [];
  const supplied = Array.isArray(record?.aliases)
    ? record.aliases.filter(alias => typeof alias === 'string' && alias.trim()) : [];
  return [...new Set([...known, ...supplied])];
}

function chainsOf(record) {
  return Array.isArray(record?.chains)
    ? record.chains.filter(chain => typeof chain === 'string' && chain.trim()).map(chain => chain.trim())
    : [];
}

const nameOrder = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function getChainOptions(records) {
  const unique = new Map();
  for (const record of records) {
    for (const chain of chainsOf(record)) {
      const key = chain.toLowerCase();
      if (!unique.has(key)) unique.set(key, chain);
    }
  }
  return [...unique.values()].sort((a, b) => nameOrder.compare(a, b));
}

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean'
    || (typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareNumbers(a, b, descending) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return descending ? b - a : a - b;
}

export function filterExchanges(records, {
  query = '', type = 'all', chain = 'all', favoritesOnly = false,
  favoriteIds = [], sort = 'volume-desc',
} = {}) {
  const terms = String(query ?? '').trim().split(/\s+/u).map(normalize).filter(Boolean);
  const wantedType = normalize(type), wantedChain = String(chain ?? 'all').trim().toLowerCase();
  const favorites = new Set(Array.from(favoriteIds ?? [], normalize));
  const matching = [];
  records.forEach((record, index) => {
    const chains = chainsOf(record);
    if (wantedType && wantedType !== 'all' && normalize(record.type) !== wantedType) return;
    if (wantedChain && wantedChain !== 'all' && !chains.some(value => value.toLowerCase() === wantedChain)) return;
    if (favoritesOnly && !favorites.has(normalize(record.id))) return;
    if (terms.length) {
      const fields = [record.name, record.id, ...exchangeAliases(record), record.type, ...chains, record.country]
        .map(normalize).filter(Boolean);
      if (!terms.every(term => fields.some(field => field.includes(term)))) return;
    }
    matching.push({ record, index });
  });
  matching.sort((a, b) => {
    let order;
    if (sort === 'name-asc') order = nameOrder.compare(String(a.record.name ?? a.record.id ?? ''), String(b.record.name ?? b.record.id ?? ''));
    else if (sort === 'change-desc') order = compareNumbers(finiteNumber(a.record.changeDay), finiteNumber(b.record.changeDay), true);
    else order = compareNumbers(finiteNumber(a.record.volume), finiteNumber(b.record.volume), sort !== 'volume-asc');
    return order || a.index - b.index;
  });
  return matching.map(item => item.record);
}
