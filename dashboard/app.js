/* Token Radar page: renders the board, the detail view, the already-trading
   set and the fitted model, all from ../data.js (window.RADAR), which the
   program writes from the same board it hands in. No network, no framework. */
'use strict';
const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`;
const pct = (v) => v === null ? '<span class="flat">—</span>' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
const ageTxt = (d) => d === null ? '—' : d < 730 ? `${d}d` : `${(d / 365).toFixed(1)}y`;
const maxHigh = Math.max(...R.rows.map((r) => r.value_high_usd));
const minLow = Math.min(...R.rows.map((r) => r.value_low_usd));
const logPos = (v) => Math.max(0, Math.min(100, ((Math.log(Math.max(1, v)) - Math.log(minLow)) / (Math.log(maxHigh) - Math.log(minLow))) * 100));

/* Header stats */
$('stats').innerHTML = [
  ['Snapshot', R.as_of], ['Protocols read', R.counts.protocols], ['Peers fitted', R.counts.peers],
  ['Board rows', R.counts.board], ['Watchlist', `${R.counts.watchlist}/${R.counts.watchlist}`],
].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
$('src').textContent = R.source;
$('live-count').textContent = R.counts.peers;

/* Filters */
const cats = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorized'))].sort();
$('f-cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
const chainCount = new Map();
for (const r of R.rows) for (const c of r.chains) chainCount.set(c, (chainCount.get(c) ?? 0) + 1);
$('f-chain').innerHTML = '<option value="">All chains</option>' +
  [...chainCount.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join('');

const state = { q: '', cat: '', chain: '', watch: false, sort: 'rank', sel: null };
function visible() {
  let rows = R.rows.filter((r) =>
    (state.cat === '' || (r.category ?? 'Uncategorized') === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (!state.watch || r.watchlist) &&
    (state.q === '' || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)));
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    multiple: (a, b) => b.model.multiple - a.model.multiple,
  }[state.sort];
  return rows.sort(by);
}
function renderBoard() {
  const rows = visible();
  $('count').textContent = `${rows.length} of ${R.rows.length} protocols`;
  $('rows').innerHTML = rows.map((r) => `<tr data-slug="${esc(r.slug)}" class="${state.sel === r.slug ? 'sel' : ''}">
    <td class="num">${r.rank}</td>
    <td><span class="name">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</td>
    <td>${esc(r.category ?? '—')}</td>
    <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
    <td class="num">${money(r.tvl_usd)}</td><td class="num">${pct(r.change_7d)}</td>
    <td class="num">${ageTxt(r.age_days)}</td><td class="num">×${r.model.multiple.toFixed(2)}</td>
    <td class="num"><strong>${money(r.implied_value_usd)}</strong></td>
    <td><div class="rangebar"><i style="left:${logPos(r.value_low_usd)}%;width:${Math.max(2, logPos(r.value_high_usd) - logPos(r.value_low_usd))}%"></i><b style="left:${logPos(r.implied_value_usd)}%"></b></div>
    <span class="rangetxt">${money(r.value_low_usd)} – ${money(r.value_high_usd)}</span></td></tr>`).join('');
  for (const tr of $('rows').querySelectorAll('tr')) tr.addEventListener('click', () => openDetail(tr.dataset.slug));
}
function openDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  state.sel = slug;
  renderBoard();
  const f = r.model;
  const check = r.tvl_usd * f.multiple * f.size * f.momentum * f.seasoning;
  const d = $('detail');
  d.hidden = false;
  d.innerHTML = `<button class="close" aria-label="Close">×</button>
    <h2>${esc(r.name)}${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</h2>
    <p class="sub">Rank #${r.rank} of ${R.rows.length} · ${esc(r.category ?? 'Uncategorized')} · records no token</p>
    <div class="big">${money(r.implied_value_usd)}</div>
    <div class="bigrange">implied launch value · range ${money(r.value_low_usd)} – ${money(r.value_high_usd)}</div>
    <dl class="kv">
      <dt>TVL</dt><dd>${money(r.tvl_usd)}</dd>
      <dt>7-day change</dt><dd>${r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</dd>
      <dt>Age, no token</dt><dd>${r.age_days === null ? 'unknown' : ageTxt(r.age_days) + ` (${r.age_days} days)`}</dd>
      <dt>Chains</dt><dd>${esc(r.chains.join(', '))}</dd>
      <dt>Tracked since</dt><dd>${esc(r.listed_at ?? '—')}</dd>
    </dl>
    <h3>Why this value</h3>
    <dl class="kv">
      <dt>Category multiple (${esc(r.category ?? 'Uncategorized')})</dt><dd>×${f.multiple.toFixed(3)}</dd>
      <dt>Size factor</dt><dd>×${f.size.toFixed(3)}</dd>
      <dt>Momentum correction</dt><dd>×${f.momentum.toFixed(3)}</dd>
      <dt>Seasoning factor</dt><dd>×${f.seasoning.toFixed(3)}</dd>
    </dl>
    <p class="check-line">${money(r.tvl_usd)} × ${f.multiple.toFixed(2)} × ${f.size.toFixed(2)} × ${f.momentum.toFixed(2)} × ${f.seasoning.toFixed(2)} ≈ ${money(Math.round(check))} — the board's ${money(r.implied_value_usd)}</p>
    <p class="why">${esc(r.name)} is priced from ${r.peers > 0 ? `the ${r.peers} tokenized ${esc(r.category ?? 'Uncategorized')} peers in the snapshot` : 'the whole tokenized cross-section, its category having no priced peer'}:
      their median market cap is ${f.multiple.toFixed(2)}× TVL, shrunk toward the global median. Its range runs from the
      lower quartile multiple (×${f.low_multiple.toFixed(2)}) to the upper quartile (×${f.high_multiple.toFixed(2)}).</p>
    <h3>Farm plan</h3>
    <ol class="plan">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  d.querySelector('.close').addEventListener('click', () => { d.hidden = true; state.sel = null; renderBoard(); });
  d.scrollTop = 0;
}
for (const [id, key, fn] of [['q', 'q', (v) => v.toLowerCase()], ['f-cat', 'cat', (v) => v], ['f-chain', 'chain', (v) => v], ['f-sort', 'sort', (v) => v]])
  $(id).addEventListener('input', (e) => { state[key] = fn(e.target.value); renderBoard(); });
$('f-watch').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });

/* Already trading */
$('live-rows').innerHTML = R.live.map((r) => `<tr>
  <td><span class="name">${esc(r.name)}</span></td><td>${esc(r.symbol ?? '—')}</td><td>${esc(r.category ?? '—')}</td>
  <td class="num">${money(r.tvl_usd)}</td><td class="num"><strong>${money(r.mcap_usd)}</strong></td><td class="num">${pct(r.change_7d)}</td></tr>`).join('');

/* How it works: the fitted numbers, printed from the run's own data */
const m = R.model;
$('fit').innerHTML = [
  ['Tokenized peers fitted', m.peer_count],
  ['Ratios winsorized to', `${m.winsor_low} – ${m.winsor_high}`],
  ['Global median multiple', `×${m.global_multiple}`],
  ['Global interquartile range', `×${m.global_low} – ×${m.global_high}`],
  ['Category shrinkage prior', 'strength 8 toward the global median'],
  ['Peers\' median TVL (size pivot)', money(m.ref_tvl_usd)],
  ['Fitted size elasticity', `slope ${(m.size_exponent * 2 + 1).toFixed(2)}, applied at half strength`],
  ['Fitted momentum slope', `${m.momentum_slope} per +1% weekly TVL, applied at half strength, clamped ×0.90–×1.11`],
  ['Fitted seasoning slope', `${m.seasoning_slope} per log-day of age, applied at half strength, clamped ×0.85–×1.18`],
  ['Peers\' median age (seasoning pivot)', `${m.ref_age_days} days`],
  ['Pre-token protocols in snapshot', R.counts.pre_token],
  ['Ranked on the board', R.counts.board],
].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
$('cat-rows').innerHTML = m.categories.map((c) => `<tr>
  <td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">×${c.multiple.toFixed(2)}</td>
  <td class="num">×${c.low.toFixed(2)} – ×${c.high.toFixed(2)}</td></tr>`).join('');

/* Views and hash presets (#view=method, #detail=<slug>, #cat=<name>, #watch=1) */
function show(view) {
  for (const v of ['board', 'live', 'method']) {
    $(`view-${v}`).hidden = v !== view;
    document.querySelector(`.tab[data-view="${v}"]`).classList.toggle('on', v === view);
  }
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => show(t.dataset.view));
renderBoard();
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('cat')) { state.cat = hash.get('cat'); $('f-cat').value = state.cat; renderBoard(); }
if (hash.get('watch') === '1') { state.watch = true; $('f-watch').checked = true; renderBoard(); }
if (hash.get('sort')) { state.sort = hash.get('sort'); $('f-sort').value = state.sort; renderBoard(); }
if (hash.get('view')) show(hash.get('view'));
if (hash.get('detail')) openDetail(hash.get('detail'));
