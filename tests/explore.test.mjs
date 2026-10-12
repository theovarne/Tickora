import assert from 'node:assert/strict';
import test from 'node:test';
import { filterExchanges, getChainOptions, exchangeAliases } from '../explore.js';

const ids = values => values.map(record => record.id);
const fixtures = [
  { id: 'binance', name: 'Binance', type: 'CEX', country: 'Cayman Islands', chains: [], volume: 100, changeDay: -5 },
  { id: 'uniswap', name: 'Uniswap', type: 'DEX', country: null, chains: ['Ethereum', 'Arbitrum'], volume: 50, changeDay: 8 },
  { id: 'pumpfun', name: 'pump.fun', type: 'DEX', country: null, chains: ['Solana'], volume: 0, changeDay: 0 },
  { id: 'raydium', name: 'Raydium', type: 'DEX', country: null, chains: ['solana', 'Ethereum'], volume: null, changeDay: null },
  { id: 'okx', name: 'OKX', type: 'CEX', country: 'Seychelles', chains: [], volume: Number.NaN, changeDay: undefined },
  { id: 'jupiter', name: 'Jupiter', type: 'DEX', country: null, chains: ['Solana'], volume: undefined, changeDay: -10 },
];
const before = structuredClone(fixtures);
for (const record of fixtures) { Object.freeze(record.chains); Object.freeze(record); }
Object.freeze(fixtures);

test('Search normalizes multilingual aliases, width, punctuation and combined terms', () => {
  for (const [query, expected] of [
    ['币安', ['binance']], ['ＢＩＮＡＮＣＥ', ['binance']], ['pump . FUN', ['pumpfun']],
    ['PUMP.FUN', ['pumpfun']], ['uniswap dex ETHEREUM', ['uniswap']],
    ['币安 cex cayman islands', ['binance']], ['币安 solana', []], ['not-a-real-exchange', []],
  ]) assert.deepEqual(ids(filterExchanges(fixtures, { query })), expected);
  assert.deepEqual(ids(filterExchanges(fixtures, { query: ' . -- ' })), ids(filterExchanges(fixtures)));
});

test('Type, chain and favorites filters combine without inventing chain coverage', () => {
  assert.deepEqual(ids(filterExchanges(fixtures, { type: 'CEX', chain: 'Solana' })), []);
  assert.deepEqual(ids(filterExchanges(fixtures, { type: 'dex', chain: 'eThErEuM' })), ['uniswap', 'raydium']);
  assert.deepEqual(ids(filterExchanges(fixtures, { chain: 'Unknown Chain' })), []);
  assert.deepEqual(getChainOptions(fixtures), ['Arbitrum', 'Ethereum', 'Solana']);
  assert.deepEqual(getChainOptions([{ chains: [' Ethereum ', 'ethereum', '', null, 'SOLANA'] }, { chains: [] }, {}]), ['Ethereum', 'SOLANA']);
  assert.deepEqual(ids(filterExchanges(fixtures, { favoritesOnly: true, favoriteIds: ['raydium', 'binance', 'unknown'] })), ['binance', 'raydium']);
  assert.deepEqual(ids(filterExchanges(fixtures, { favoritesOnly: true, favoriteIds: new Set(['PUMP.FUN']) })), ['pumpfun']);
  assert.deepEqual(ids(filterExchanges(fixtures, { favoritesOnly: true })), []);
  assert.deepEqual(ids(filterExchanges(fixtures, { query: 'dex', chain: 'SOLANA', favoritesOnly: true, favoriteIds: ['pumpfun', 'binance'], sort: 'name-asc' })), ['pumpfun']);
  assert.deepEqual(ids(filterExchanges(fixtures, { query: 'cex', chain: 'Solana', favoritesOnly: true, favoriteIds: ['binance'] })), []);
});

test('Sorts keep missing or invalid metrics after valid zero and preserve stable ties', () => {
  assert.deepEqual(ids(filterExchanges(fixtures, { sort: 'volume-desc' })), ['binance', 'uniswap', 'pumpfun', 'raydium', 'okx', 'jupiter']);
  assert.deepEqual(ids(filterExchanges(fixtures, { sort: 'volume-asc' })), ['pumpfun', 'uniswap', 'binance', 'raydium', 'okx', 'jupiter']);
  assert.deepEqual(ids(filterExchanges(fixtures, { sort: 'change-desc' })), ['uniswap', 'pumpfun', 'binance', 'jupiter', 'raydium', 'okx']);
  assert.deepEqual(ids(filterExchanges(fixtures, { sort: 'name-asc' })), ['binance', 'jupiter', 'okx', 'pumpfun', 'raydium', 'uniswap']);
  const invalid = [
    { id: 'null', volume: null, changeDay: null }, { id: 'empty', volume: '', changeDay: '' },
    { id: 'boolean', volume: false, changeDay: false }, { id: 'infinite', volume: Infinity, changeDay: Infinity },
    { id: 'zero', volume: 0, changeDay: 0 }, { id: 'numeric', volume: '12', changeDay: '-2' },
  ];
  assert.deepEqual(ids(filterExchanges(invalid, { sort: 'volume-asc' })), ['zero', 'numeric', 'null', 'empty', 'boolean', 'infinite']);
  assert.deepEqual(ids(filterExchanges(invalid, { sort: 'change-desc' })), ['zero', 'numeric', 'null', 'empty', 'boolean', 'infinite']);
  const ties = [{ id: 'z', name: 'Same', volume: 5 }, { id: 'a', name: 'same', volume: 5 }];
  assert.deepEqual(ids(filterExchanges(ties)), ['z', 'a']);
  assert.deepEqual(ids(filterExchanges(ties, { sort: 'name-asc' })), ['z', 'a']);
});

test('Discovery preserves input objects and alias lists do not leak mutations', () => {
  filterExchanges(fixtures, { query: 'dex', sort: 'name-asc' });
  assert.deepEqual(fixtures, before);
  assert.equal(filterExchanges(fixtures, { query: '币安' })[0], fixtures[0]);
  const aliases = exchangeAliases({ id: 'binance', aliases: ['Custom Tag'] });
  assert(aliases.includes('币安') && aliases.includes('Custom Tag'));
  aliases.push('should not persist');
  assert(!exchangeAliases({ id: 'binance' }).includes('should not persist'));
  assert.deepEqual(exchangeAliases({ id: 'unknown', aliases: ['标签', null, ''] }), ['标签']);
  assert.deepEqual(getChainOptions([]), []);
  assert.deepEqual(filterExchanges([]), []);
});

test('Every tracked exchange recognizes its existing alias vocabulary', () => {
  const cases = [
    ['binance', '币安'], ['uniswap', 'uni swap'], ['okx', '欧易'], ['bybit', '比特'],
    ['coinbase', 'GDAX'], ['kraken', '海妖'], ['pancakeswap', '薄饼'], ['pumpfun', 'pump.fun'],
    ['raydium', 'RAYDIUM'], ['hyperliquid', '超流'], ['jupiter', '木星'], ['lighter', 'LIGHTER'],
    ['bitget', 'bit get'], ['fomo', 'fomo-wallet'],
  ];
  for (const [id, query] of cases) assert.deepEqual(ids(filterExchanges([{ id, name: id, volume: 1 }], { query })), [id]);
});
