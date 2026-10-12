import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../data.js', import.meta.url);
const bundled = JSON.parse(await readFile(new URL('../assets/data/exchanges.json', import.meta.url), 'utf8'));
const cexFixture = bundled.cex.find(row => row.id === 'binance');
const dexFixture = bundled.dex.find(row => row.parentProtocol === 'parent#uniswap' || row.slug === 'uniswap');
assert(cexFixture && dexFixture, 'The bundled snapshot must contain Binance and Uniswap fixtures.');
const cacheKey = 'blocktown:market:v1';
let moduleNumber = 0;
const stamp = ago => new Date(Date.now() - ago).toISOString();
const oldAt = stamp(2 * 24 * 3600_000), cacheAt = stamp(3600_000);
const oldSnapshot = {
  ...bundled, updatedAt: oldAt, btcUsd: 25_000,
  cex: [{ ...cexFixture, id: 'binance', trade_volume_24h_btc: 2, trust_score: 10, country: 'Cayman Islands' }],
  dex: [{ ...dexFixture, parentProtocol: undefined, slug: 'uniswap', total24h: 5_000, total48hto24h: 4_000, chains: ['Ethereum'] }],
};
const newerCache = [
  { id: 'binance', volume: 85_000, updatedAt: cacheAt, source: 'CoinGecko', country: 'Cache Country', chains: [], trend: [80_000, 85_000], trendLabels: ['Previous', 'Current'], live: true, status: 'live' },
  { id: 'uniswap', volume: 9_000, updatedAt: cacheAt, source: 'DefiLlama', chains: ['Ethereum', 'Arbitrum'], trend: [8_000, 9_000], trendLabels: ['Previous', 'Current'], live: true, status: 'live' },
];

function endpoint(url) {
  const value = String(url);
  if (value.includes('assets/data/exchanges.json')) return 'snapshot';
  if (value.includes('/exchanges?')) return 'cex';
  if (value.includes('/simple/price?')) return 'btc';
  if (value.includes('/overview/dexs?')) return 'dex';
  throw new Error(`Unexpected network URL: ${value}`);
}

async function setup(t, { cache = [], feeds = {}, gate } = {}) {
  const originalFetch = globalThis.fetch;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });
  const storage = new Map([[cacheKey, JSON.stringify(cache)]]), calls = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  } });
  globalThis.fetch = async (url, options) => {
    const key = endpoint(url); calls.push({ key, options });
    if (gate) await gate;
    if (!(key in feeds) || feeds[key] instanceof Error) throw feeds[key] ?? new TypeError('Mock API unavailable');
    return { ok: true, status: 200, json: async () => structuredClone(feeds[key]) };
  };
  const module = await import(`${moduleUrl.href}?cache-test=${++moduleNumber}`);
  return { module, storage, calls, feeds };
}
const record = (module, id) => module.exchanges.find(item => item.id === id);

test('A newer local cache survives an older snapshot and failed refresh without claiming LIVE', async t => {
  const env = await setup(t, { cache: newerCache, feeds: { snapshot: oldSnapshot } });
  let result = await env.module.loadSnapshot();
  for (const [id, volume] of [['binance', 85_000], ['uniswap', 9_000]]) {
    const item = record(env.module, id);
    assert.equal(item.volume, volume); assert.equal(item.updatedAt, cacheAt);
    assert.equal(item.live, false); assert.equal(item.status, 'stale'); assert.equal(item.available, true);
  }
  assert.equal(result.summary.cexLive, 0); assert.equal(result.summary.dexLive, 0);
  assert.deepEqual(record(env.module, 'uniswap').chains, ['Ethereum', 'Arbitrum']);
  result = await env.module.loadMarketData();
  assert.equal(record(env.module, 'binance').volume, 85_000);
  assert.equal(record(env.module, 'uniswap').volume, 9_000);
  assert.equal(record(env.module, 'binance').live, false);
  assert.equal(result.summary.cexLive + result.summary.dexLive, 0);
  assert.deepEqual(Object.keys(result.errors).sort(), ['btc', 'cex', 'dex']);
  const stored = JSON.parse(env.storage.get(cacheKey));
  assert.equal(stored.find(item => item.id === 'binance').volume, 85_000);
  assert(!stored.some(item => item.live === true));
});

test('Snapshot failure still restores cached observations', async t => {
  const env = await setup(t, { cache: newerCache });
  const result = await env.module.loadSnapshot();
  assert.equal(record(env.module, 'binance').volume, 85_000);
  assert.equal(record(env.module, 'binance').updatedAt, cacheAt);
  assert.equal(record(env.module, 'binance').status, 'stale');
  assert.equal(result.summary.cexLive + result.summary.dexLive, 0);
  assert('snapshot' in result.errors);
});

test('A genuine refresh uses the current BTC price and later outages retain its values', async t => {
  const env = await setup(t, { cache: newerCache, feeds: { snapshot: oldSnapshot } });
  await env.module.loadSnapshot();
  Object.assign(env.feeds, {
    cex: [{ ...cexFixture, id: 'binance', trade_volume_24h_btc: 3, trust_score: 9, volume_change_percentage_24h: -2 }],
    btc: { bitcoin: { usd: 30_000 } },
    dex: { protocols: [{ ...dexFixture, parentProtocol: undefined, slug: 'uniswap', total24h: 20_000, total48hto24h: 10_000, chains: ['Ethereum', 'Solana'], latestFetchIsOk: true }] },
  });
  const result = await env.module.loadMarketData();
  const binance = record(env.module, 'binance'), uniswap = record(env.module, 'uniswap');
  assert.equal(binance.volume, 90_000); assert.equal(binance.live, true); assert.equal(binance.status, 'live');
  assert.equal(binance.trust, 9); assert.equal(binance.changeDay, -2);
  assert(Date.parse(binance.updatedAt) > Date.parse(cacheAt));
  assert.equal(uniswap.volume, 20_000); assert.equal(uniswap.live, true); assert.equal(uniswap.changeDay, 100);
  assert.deepEqual(uniswap.chains, ['Ethereum', 'Solana']);
  assert.equal(result.summary.cexLive, 1); assert.equal(result.summary.dexLive, 1);
  assert.equal(JSON.parse(env.storage.get(cacheKey)).find(item => item.id === 'binance').volume, 90_000);
  delete env.feeds.cex; delete env.feeds.btc; delete env.feeds.dex;
  await env.module.loadMarketData();
  assert.equal(binance.volume, 90_000); assert.equal(binance.live, false); assert.equal(binance.status, 'stale');
  assert.equal(uniswap.volume, 20_000); assert.equal(uniswap.live, false);
});

test('A BTC-denominated quantity never becomes USD without a valid price', async t => {
  const env = await setup(t, { cache: newerCache, feeds: { snapshot: oldSnapshot,
    cex: [{ ...cexFixture, id: 'binance', trade_volume_24h_btc: 123_456 }], btc: { bitcoin: {} } } });
  await env.module.loadSnapshot();
  const result = await env.module.loadMarketData();
  assert.equal(record(env.module, 'binance').volume, 85_000);
  assert.notEqual(record(env.module, 'binance').volume, 123_456);
  assert.equal(record(env.module, 'binance').live, false); assert.equal(result.summary.cexLive, 0);
});

test('Missing live prices use only snapshot conversions; an invalid snapshot price leaves volume unavailable', async t => {
  const env = await setup(t, { feeds: { snapshot: oldSnapshot, cex: [{ ...cexFixture, id: 'binance', trade_volume_24h_btc: 123_456 }] } });
  await env.module.loadMarketData();
  assert.equal(record(env.module, 'binance').volume, 50_000); assert.equal(record(env.module, 'binance').live, false);
  env.feeds.snapshot = { ...oldSnapshot, btcUsd: null }; env.feeds.btc = { bitcoin: { usd: 0 } };
  // A new module models an initial load without a previous successful snapshot.
  const isolated = await import(`${moduleUrl.href}?cache-test=${++moduleNumber}`);
  env.storage.clear(); await isolated.loadMarketData();
  assert.equal(record(isolated, 'binance').volume, null);
  assert.equal(record(isolated, 'binance').live, false); assert.equal(record(isolated, 'binance').available, false);
});

test('Concurrent refresh callers share a four-request batch and release it afterwards', async t => {
  let release; const gate = new Promise(resolveGate => { release = resolveGate; });
  const env = await setup(t, { feeds: { snapshot: oldSnapshot,
    cex: [{ ...cexFixture, id: 'binance', trade_volume_24h_btc: 4 }], btc: { bitcoin: { usd: 25_000 } },
    dex: { protocols: [] } }, gate });
  const first = env.module.loadMarketData(), second = env.module.loadMarketData(), third = env.module.loadMarketData();
  assert.equal(env.calls.length, 4); assert.deepEqual(env.calls.map(item => item.key).sort(), ['btc', 'cex', 'dex', 'snapshot']);
  release(); const results = await Promise.all([first, second, third]);
  assert.equal(results[0], results[1]); assert.equal(results[1], results[2]);
  assert.equal(record(env.module, 'binance').volume, 100_000);
  await env.module.loadMarketData(); assert.equal(env.calls.length, 8, 'inFlight must clear after the first batch');
  assert(env.calls.every(item => item.options.signal instanceof AbortSignal && item.options.cache === 'no-cache'));
});

test('Invalid, expired and future cache entries cannot replace a valid snapshot', async t => {
  const env = await setup(t, { cache: [
    { id: 'binance', volume: 999_999, updatedAt: stamp(8 * 24 * 3600_000) },
    { id: 'uniswap', volume: 999_999, updatedAt: new Date(Date.now() + 600_000).toISOString() },
    { id: 'okx', volume: -5, updatedAt: cacheAt },
  ], feeds: { snapshot: oldSnapshot } });
  await env.module.loadSnapshot();
  assert.equal(record(env.module, 'binance').volume, 50_000);
  assert.equal(record(env.module, 'uniswap').volume, 5_000); assert.equal(record(env.module, 'okx').volume, null);
});

test('Volume formatting distinguishes unavailable values and valid zero', async t => {
  const env = await setup(t);
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(env.module.formatVolume(value), '—');
  assert.equal(env.module.formatVolume(0), '0'); assert.equal(env.module.formatVolume(1000), '1K');
  assert.equal(env.module.formatVolume(1_500_000_000), '1.5B');
});
