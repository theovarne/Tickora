import { filterExchanges, getChainOptions } from './explore.js?v=17';
import { formatVolume } from './data.js?v=17';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'blocktown:favorites';

export function mountExplorer({ records, onSelect, onRefresh, getSelectedId }) {
  const filters = { query: '', type: 'all', chain: 'all', favoritesOnly: false, sort: 'volume-desc' };
  let favorites = new Set(), results = [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) favorites = new Set(saved.filter(id => records.some(record => record.id === id)));
  } catch {}

  function render() {
    const focused = document.activeElement;
    const focusId = focused?.dataset.venueId, focusClass = focused?.className;
    const chains = getChainOptions(records);
    const options = [new Option('All networks', 'all'), ...chains.map(chain => new Option(chain, chain))];
    if (filters.chain !== 'all' && !chains.includes(filters.chain)) filters.chain = 'all';
    $('explore-chain').replaceChildren(...options);
    $('explore-chain').value = filters.chain;
    $('explore-sort').value = filters.sort;
    $('explore-types').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.type === filters.type)));
    $('explore-favorites').setAttribute('aria-pressed', String(filters.favoritesOnly));
    results = filterExchanges(records, { ...filters, favoriteIds: favorites });
    $('explore-count').textContent = `${results.length} ${results.length === 1 ? 'exchange' : 'exchanges'}${filters.favoritesOnly ? ' in your collection' : ` · ${records.length} in BlockTown`}`;
    $('explore-empty').hidden = results.length > 0;
    const fragment = document.createDocumentFragment();
    for (const record of results) {
      const row = document.createElement('article'); row.className = `explore-result${record.id === getSelectedId() ? ' selected' : ''}`;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'result-select'; select.dataset.venueId = record.id;
      select.setAttribute('aria-label', `Explore ${record.name}`);
      const logo = document.createElement('img'); logo.className = 'logo'; logo.src = record.logo; logo.alt = '';
      const copy = document.createElement('span'); copy.className = 'copy';
      const name = document.createElement('b'); name.textContent = record.name;
      const meta = document.createElement('span'); meta.className='meta'; meta.textContent = `${record.type} · ${record.chains.length ? record.chains.slice(0, 2).join(', ') + (record.chains.length > 2 ? ` +${record.chains.length - 2}` : '') : record.country || 'Global market'}`;
      copy.append(name, meta);
      const volume = document.createElement('span'); volume.className = 'result-volume'; volume.textContent = record.available ? `$${formatVolume(record.volume)}` : '—';
      volume.title = 'Reported 24h trading volume';
      select.append(logo, copy, volume); select.onclick = () => { onSelect(record.id); close(); };
      const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'result-favorite'; favorite.dataset.venueId = record.id;
      favorite.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39L17.56 20 12 17.08 6.44 20l1.06-6.07L3 9.54l6.22-.91Z"/></svg>'; favorite.setAttribute('aria-pressed', String(favorites.has(record.id)));
      favorite.setAttribute('aria-label', `${favorites.has(record.id) ? 'Remove' : 'Save'} ${record.name}${favorites.has(record.id) ? ' from' : ' to'} your collection`);
      favorite.onclick = () => {
        if (favorites.has(record.id)) favorites.delete(record.id); else favorites.add(record.id);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites])); } catch {}
        render();
      };
      row.append(select, favorite); fragment.append(row);
    }
    $('explore-results').replaceChildren(fragment);
    if (focusId) {
      const replacement = [...$('explore-results').querySelectorAll('button')].find(button => button.dataset.venueId === focusId && button.className === focusClass);
      (replacement || $('explore-query')).focus({ preventScroll: true });
    }
  }
  function open() {
    if ($('info').open) $('info').close();
    render(); if (!$('explore-dialog').open) $('explore-dialog').showModal();
    $('explore-query').focus();
  }
  function close() { $('explore-dialog').close(); }
  function reset() {
    Object.assign(filters, { query: '', type: 'all', chain: 'all', favoritesOnly: false, sort: 'volume-desc' });
    $('explore-query').value = ''; render(); $('explore-query').focus();
  }
  $('explore-open').onclick = open;
  $('explore-close').onclick = close;
  $('explore-query').addEventListener('input', event => { filters.query = event.target.value; render(); });
  $('explore-query').addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && results.length) { event.preventDefault(); onSelect(results[0].id); close(); }
    if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); $('explore-results').querySelector('.result-select')?.focus(); }
  });
  $('explore-types').addEventListener('click', event => { const button = event.target.closest('button[data-type]'); if (button) { filters.type = button.dataset.type; render(); } });
  $('explore-chain').onchange = event => { filters.chain = event.target.value; render(); };
  $('explore-sort').onchange = event => { filters.sort = event.target.value; render(); };
  $('explore-favorites').onclick = () => { filters.favoritesOnly = !filters.favoritesOnly; render(); };
  $('explore-reset').onclick = reset;
  $('explore-refresh').onclick = async () => {
    const button = $('explore-refresh'), label = button.innerHTML;
    button.disabled = true; button.textContent = 'Refreshing…';
    try { await onRefresh(); render(); } finally { button.disabled = false; button.innerHTML = label; }
  };
  $('explore-dialog').addEventListener('click', event => {
    if (event.target !== $('explore-dialog')) return;
    const rect = $('explore-dialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  $('explore-results').addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...$('explore-results').querySelectorAll('.result-select')];
    const index = buttons.indexOf(event.target); if (index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus();
  });
  return { open, close, render, reset };
}
