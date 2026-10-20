// Public exchange activity, normalized for the town. Values are never invented.
const SOURCES = {
  cex: 'https://api.coingecko.com/api/v3/exchanges?per_page=100&page=1',
  btc: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  dex: 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume',
  snapshot: new URL('./assets/data/exchanges.json', import.meta.url).href,
};

const venues = [
  ['binance', 'Binance', 'CEX', '#f0b90b', 'svg', ['binance']],
  ['uniswap', 'Uniswap', 'DEX', '#ff4dba', 'svg', ['uniswap'], 'parent#uniswap'],
  ['okx', 'OKX', 'CEX', '#202124', 'svg', ['okex', 'okx']],
  ['bybit', 'Bybit', 'CEX', '#f7a600', 'svg', ['bybit_spot', 'bybit']],
  ['coinbase', 'Coinbase', 'CEX', '#1652f0', 'svg', ['gdax', 'coinbase-exchange']],
  ['kraken', 'Kraken', 'CEX', '#5741d9', 'svg', ['kraken']],
  ['pancakeswap', 'PancakeSwap', 'DEX', '#1fc7d4', 'svg', ['pancakeswap'], 'parent#pancakeswap'],
  ['pumpfun', 'pump.fun', 'DEX', '#5de580', 'webp', ['pump.fun', 'pumpswap'], 'parent#pump'],
  ['bitget', 'Bitget', 'CEX', '#00c2d7', 'svg', ['bitget']],
  ['raydium', 'Raydium', 'DEX', '#7b61ff', 'webp', ['raydium'], 'parent#raydium'],
  ['hyperliquid', 'Hyperliquid', 'DEX', '#50e3c2', 'webp', ['hyperliquid'], 'parent#hyperliquid'],
  ['fomo', 'fomo', 'DEX', '#ff5a86', 'svg', ['fomo-wallet', 'fomo-spot', 'fomo-outcome'], 'parent#fomo'],
  ['jupiter', 'Jupiter', 'DEX', '#36d399', 'webp', ['jupiter'], 'parent#jupiter'],
  ['lighter', 'Lighter', 'DEX', '#d7ff4f', 'svg', ['lighter'], 'parent#lighter'],
];
const definitions = new Map(venues.map(([id, name, type, color, extension, ids, parent]) =>
  [id, { id, name, type, color, logo: `./assets/${id}.${extension}`, ids, parent }]));

export const exchanges = venues.map(([id]) => {
  const venue = definitions.get(id);
  return {
    id, name: venue.name, type: venue.type, color: venue.color, logo: venue.logo,
    volume: null, live: false, source: venue.type === 'CEX' ? 'CoinGecko' : 'DefiLlama',
    rank: null, trust: null, country: null, year: null, chains: [],
    changeDay: null, changeWeek: null, description: '',
    status: 'unavailable', available: false, updatedAt: null,
    chainCount: 0, protocolCount: 0, trend: [], trendLabels: [],
  };
});

export function formatVolume(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const magnitude = Math.abs(number);
  for (const [limit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (magnitude >= limit) return `${(number / limit).toLocaleString('en-US', { minimumFractionDigits: limit >= 1e9 ? 1 : 0, maximumFractionDigits: limit >= 1e9 ? 1 : 0 })}${suffix}`;
  }
  return number.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function nonnegative(value) {
  const result = numeric(value);
  return result !== null && result >= 0 ? result : null;
}

function percentage(current, previous) {
  return current !== null && previous !== null && previous > 0 ? (current / previous - 1) * 100 : null;
}

async function requestJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function valueOf(result, fallback = null) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function findCex(rows, definition) {
  return rows.find(row => definition.ids.includes(row.id));
}

function findDex(rows, definition) {
  const children = rows.filter(row => row.parentProtocol === definition.parent);
  return children.length ? children : rows.filter(row => definition.ids.includes(row.slug));
}

function sumKnown(rows, key) {
  const values = rows.map(row => nonnegative(row[key])).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function cexRecord(definition, row, btcPrice, isLive, updatedAt, snapshot) {
  const btcVolume = nonnegative(row?.trade_volume_24h_btc);
  const price = nonnegative(btcPrice);
  const volume = btcVolume !== null && price > 0 ? btcVolume * price : null;
  const history = Array.isArray(row?.volume_history_btc) ? row.volume_history_btc : [];
  const historyValues = history.map(entry => nonnegative(entry[1])).filter(value => value !== null);
  const directDay = numeric(row?.volume_change_percentage_24h);
  const directWeek = numeric(row?.volume_change_percentage_7d);
  // Historic snapshot observations remain historic when the live endpoint has no change fields.
  const historyAgeHours=(Date.parse(updatedAt)-Number(history.at(-1)?.[0]))/3600000;
  const comparableDay=historyAgeHours>=18&&historyAgeHours<=48;
  const changeDay = directDay ?? (!isLive && comparableDay && historyValues.length ? percentage(btcVolume, historyValues.at(-1)) : null);
  const historyPrice = nonnegative(snapshot?.historyBtcUsd) || nonnegative(snapshot?.btcUsd) || price;
  const trend = historyPrice > 0 ? historyValues.map(value => value * historyPrice).filter(value => Number.isFinite(value)) : [];
  if (volume !== null) trend.push(volume);
  return {
    volume, live: isLive && volume !== null, available: volume !== null,
    status: volume === null ? 'unavailable' : isLive ? 'live' : 'stale',
    source: 'CoinGecko', updatedAt: volume === null ? null : updatedAt,
    trust: numeric(row?.trust_score), trustRank: numeric(row?.trust_score_rank),
    country: row?.country || null, year: numeric(row?.year_established),
    chains: [], chainCount: 0, protocolCount: 1,
    changeDay, changeWeek: directWeek,
    changeDayBasis: '24h versus previous 24h', changeWeekBasis: '24h versus 7 days ago',
    description: 'Reported spot trading volume · Order-book venue · Custodial settlement',
    trend, trendLabels: [...history.map(entry => {
      const date = new Date(entry[0]);
      return Number.isNaN(date.getTime()) ? 'Historic 24h volume' : `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} 24h volume`;
    }), ...(volume !== null ? ['Current 24h volume'] : [])].slice(-trend.length),
  };
}

function dexRecord(definition, rows, isLive, updatedAt) {
  const measured = rows.filter(row => nonnegative(row.total24h) !== null);
  const volume = sumKnown(measured, 'total24h');
  const previousDay = sumKnown(measured, 'total48hto24h');
  const lastWeek = sumKnown(measured, 'total7d');
  const previousWeek = sumKnown(measured, 'total14dto7d');
  const month = sumKnown(measured, 'total30d');
  const chains = [...new Set(measured.filter(row => nonnegative(row.total24h) > 0).flatMap(row => row.chains || []))];
  // A zero-volume venue can still have known chain coverage.
  if (!chains.length) chains.push(...new Set(measured.flatMap(row => row.chains || [])));
  const freshness = isLive && measured.every(row => row.latestFetchIsOk !== false);
  const observations = [
    [month !== null ? month / 30 : null, '30-day average'],
    [lastWeek !== null ? lastWeek / 7 : null, '7-day average'],
    [previousDay, 'Previous 24h volume'],
    [volume, 'Current 24h volume'],
  ].filter(([value]) => value !== null);
  return {
    volume, live: freshness && volume !== null, available: volume !== null,
    status: volume === null ? 'unavailable' : freshness ? 'live' : 'stale',
    source: 'DefiLlama', updatedAt: volume === null ? null : updatedAt,
    trust: null, trustRank: null, country: null, year: null,
    chains, chainCount: chains.length, protocolCount: measured.length,
    changeDay: percentage(volume, previousDay), changeWeek: percentage(lastWeek, previousWeek),
    changeDayBasis: '24h versus previous 24h', changeWeekBasis: '7 days versus previous 7 days',
    description: definition.id === 'fomo'
      ? 'Reported trading-app volume · Public chain activity · On-chain settlement'
      : 'Reported DEX ecosystem volume · Public liquidity · On-chain settlement',
    trend: observations.map(([value]) => value), trendLabels: observations.map(([, label]) => label),
    includesInterfaceVolume: measured.some(row => row.doublecounted === true),
  };
}

let inFlight = null;
let cachedSnapshot = null;
let initialLoad = true;
const CACHE_KEY = 'tickora:market:v1';
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const cachedFields = ['volume', 'source', 'updatedAt', 'trust', 'trustRank', 'country', 'year', 'chains', 'chainCount', 'protocolCount', 'changeDay', 'changeWeek', 'changeDayBasis', 'changeWeekBasis', 'description', 'trend', 'trendLabels', 'includesInterfaceVolume'];

function restoreMarketCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!Array.isArray(saved)) return;
    for (const entry of saved) {
      const record = exchanges.find(item => item.id === entry.id);
      const stamp = Date.parse(entry.updatedAt);
      if (!record || nonnegative(entry.volume) === null || !Number.isFinite(stamp) || stamp > Date.now() + 60000 || Date.now() - stamp > CACHE_MAX_AGE || stamp <= Date.parse(record.updatedAt || 0)) continue;
      for (const field of cachedFields) if (Object.hasOwn(entry, field)) record[field] = entry[field];
      record.volume = nonnegative(entry.volume);
      record.chains = Array.isArray(record.chains) ? record.chains.filter(value => typeof value === 'string') : [];
      record.trend = Array.isArray(record.trend) ? record.trend.map(nonnegative).filter(value => value !== null) : [];
      record.trendLabels = Array.isArray(record.trendLabels) ? record.trendLabels.filter(value => typeof value === 'string') : [];
      record.live = false; record.available = true; record.status = 'stale';
    }
  } catch {}
}

function saveMarketCache() {
  try {
    const saved = exchanges.filter(record => record.available).map(record => Object.fromEntries(['id', ...cachedFields].map(field => [field, record[field]])));
    localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
  } catch {}
}

// Local hydration opens the town immediately while remote APIs refresh in the background.
export async function loadSnapshot({ timeoutMs = 2500 } = {}) {
  let snapshot = cachedSnapshot || {};
  const errors = {};
  try {
    snapshot = await requestJson(SOURCES.snapshot, timeoutMs);
    if (snapshot.cex || snapshot.dex) cachedSnapshot = snapshot;
  } catch (error) {
    errors.snapshot = error.name === 'AbortError' ? 'Request timed out' : error.message || 'Request failed';
  }
  restoreMarketCache();
  return applyMarketData(snapshot, [], null, [], new Date().toISOString(), errors);
}

export async function loadMarketData({ timeoutMs = 8500 } = {}) {
  if (inFlight) return inFlight;
  inFlight = refresh(timeoutMs);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function refresh(timeoutMs) {
  const keys = ['cex', 'btc', 'dex', 'snapshot'];
  const results = await Promise.allSettled(keys.map(key => requestJson(SOURCES[key], timeoutMs)));
  const [cexResult, btcResult, dexResult, snapshotResult] = results;
  const snapshot = valueOf(snapshotResult, cachedSnapshot) || {};
  if (snapshot.cex || snapshot.dex) cachedSnapshot = snapshot;
  const cexFeed = valueOf(cexResult);
  const liveCex = Array.isArray(cexFeed) ? cexFeed : [];
  const btcUsd = numeric(valueOf(btcResult)?.bitcoin?.usd);
  const dexFeed = valueOf(dexResult);
  const liveDex = Array.isArray(dexFeed?.protocols) ? dexFeed.protocols
    : Array.isArray(dexFeed?.data?.protocols) ? dexFeed.data.protocols : [];
  const errors = Object.fromEntries(results.flatMap((result, index) => result.status === 'rejected'
    ? [[keys[index], result.reason?.name === 'AbortError' ? 'Request timed out' : result.reason?.message || 'Request failed']]
    : []));
  return applyMarketData(snapshot, liveCex, btcUsd, liveDex, new Date().toISOString(), errors);
}

function applyMarketData(snapshot, liveCex, btcUsd, liveDex, now, errors) {
  const snapshotCex = Array.isArray(snapshot.cex) ? snapshot.cex : [];
  const snapshotDex = Array.isArray(snapshot.dex) ? snapshot.dex : [];

  for (const record of exchanges) {
    const definition = definitions.get(record.id);
    let values;
    if (definition.type === 'CEX') {
      const current = findCex(liveCex, definition);
      const prior = findCex(snapshotCex, definition);
      const live = nonnegative(current?.trade_volume_24h_btc) !== null && btcUsd > 0;
      // Both the exchange volume and conversion price must be current to claim a live USD volume.
      const row = live ? { ...prior, ...current } : prior;
      values = cexRecord(definition, row, live ? btcUsd : snapshot.btcUsd, live, live ? now : snapshot.updatedAt || null, snapshot);
    } else {
      const current = findDex(liveDex, definition);
      const prior = findDex(snapshotDex, definition);
      const live = current.some(row => nonnegative(row.total24h) !== null);
      values = dexRecord(definition, live ? current : prior, live, live ? now : snapshot.updatedAt || null);
    }
    // A failed refresh keeps the newest measured values; it never manufactures a live feed.
    if (!values.live && record.available && Date.parse(record.updatedAt) > Date.parse(values.updatedAt || 0)) {
      record.live = false; record.status = 'stale';
    } else Object.assign(record, values);
  }

  for (const type of ['CEX', 'DEX']) {
    const ranked = exchanges.filter(record => record.type === type && record.available).sort((a, b) => b.volume - a.volume);
    ranked.forEach((record, index) => { record.rank = index + 1; });
    exchanges.filter(record => record.type === type && !record.available).forEach(record => { record.rank = null; });
  }
  if (initialLoad) {
    exchanges.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
    initialLoad = false;
  }
  saveMarketCache();

  const summary = {
    cexLive: exchanges.filter(record => record.type === 'CEX' && record.live).length,
    cexTotal: exchanges.filter(record => record.type === 'CEX').length,
    dexLive: exchanges.filter(record => record.type === 'DEX' && record.live).length,
    dexTotal: exchanges.filter(record => record.type === 'DEX').length,
    stale: exchanges.filter(record => record.status === 'stale').length,
    unavailable: exchanges.filter(record => record.status === 'unavailable').length,
  };
  return {
    exchanges, summary, updatedAt: summary.cexLive || summary.dexLive ? now : snapshot.updatedAt || null,
    snapshotAt: snapshot.updatedAt || null, errors,
  };
}
