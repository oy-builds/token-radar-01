/* Token Radar page: renders the board, the detail view, the already-trading
   set and the fitted model, all from ../data.js (window.RADAR), which the
   program writes from the same board it hands in. No network, no framework.
   Round 1 adds: a compare view (up to 3 protocols), a what-if sandbox that
   re-prices the board from the model's own factors, CSV export of the visible
   rows, and pinned rows that survive filters and sorts.
   Round 2: the board ranks every protocol that records no token — products
   of other protocols and exchange pages included and flagged, not hidden —
   and the farm plans are generated here, in this file, from each row's own
   record (the generator below), so the plan a reader sees is built by code
   the reader can read, and matches the handed-in board step for step. */
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
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* ------------------------------------------------------------------ *
   Farm plans, generated from each row's own record — the same code the
   program's lib/model.ts runs to write board.json, kept in step with it.
   A row's category picks the playbook, its chains pick where the steps
   happen and what an action costs there, its TVL picks the position
   size, and its age picks how many weeks the plan runs. A product row
   (kind 'product': a wrapped, staked, bridged or versioned product of
   another protocol, or an exchange's own page) gets the other plan: it
   says what the row is and what holding it costs, because there is no
   launch of that row to farm. */

function actionCostUsd(chain) {
  if (chain === 'Ethereum') return 9;
  if (chain === 'Solana' || chain === 'Base' || chain === 'Arbitrum' || chain === 'OP Mainnet' || chain === 'Polygon' || chain === 'Avalanche' || chain === 'BSC') return 1;
  return 3;
}
function capitalFor(tvl) {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 75;
  return 40;
}
function planWeeks(age) {
  if (age === null) return 8;
  if (age < 180) return 10;
  if (age < 730) return 8;
  return 6;
}
function planGasUsd(r, weeks) {
  const gas = actionCostUsd(r.chains[0] ?? 'its main chain');
  const step3 = r.chains.length > 1 ? actionCostUsd(r.chains[1]) * 2 : gas * 2;
  return gas * 6 + gas + step3 + gas * weeks + gas * 2;
}
/* The plan's headline numbers, from the same figures its steps state. */
function planSummaryFor(r) {
  const weeks = planWeeks(r.age_days);
  const gas = actionCostUsd(r.chains[0] ?? 'its main chain');
  return {
    capital_usd: capitalFor(r.tvl_usd),
    gas_usd: r.kind === 'product' ? gas * 2 : planGasUsd(r, weeks),
    weeks,
    days: weeks * 7,
  };
}
function playbookFor(category) {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      open: 'supply the USDC as collateral and leave the health factor above 2.0',
      second: 'borrow a small amount of the chain\'s base asset against the position, swap it back to USDC and supply it again, one loop only',
      habit: 'repay and re-borrow a small slice so the account shows borrowing activity, not just deposits',
    };
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual'))
    return {
      open: 'add the capital to the protocol\'s deepest USDC pool as liquidity',
      second: 'route a few swaps a week through the protocol\'s own interface rather than an aggregator, so the volume is recorded on it',
      habit: 'rebalance the liquidity position back into range and claim any fees into the same pool',
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield'))
    return {
      open: 'deposit the USDC into the protocol\'s flagship vault and keep the vault shares in the same wallet',
      second: 'split a quarter of the position into a second vault with a different strategy, so the account holds more than one product',
      habit: 'move a small amount between the two vaults, which records an active allocation history',
    };
  if (c.includes('prediction'))
    return {
      open: 'fund the account and take small positions on both sides of the two most liquid markets',
      second: 'provide liquidity to one long-dated market and leave the quotes resting instead of cancelling them',
      habit: 'settle finished markets promptly and roll the proceeds into the next week\'s markets',
    };
  if (c.includes('rwa') || c.includes('real world'))
    return {
      open: 'complete the onboarding the protocol asks for and mint its yield asset with the capital',
      second: 'hold the minted asset in the same wallet and make one secondary transfer to a second wallet you control, then back',
      habit: 'add a small top-up mint so the account shows recurring, not one-off, participation',
    };
  if (c.includes('chain'))
    return {
      open: 'bridge the capital onto the chain and make the first transactions with its native applications',
      second: 'use two of the chain\'s own flagship applications (a swap and a lending market) so activity is spread across the ecosystem',
      habit: 'keep a weekly transaction streak going: one swap, one contract interaction, no empty weeks',
    };
  if (c.includes('insurance'))
    return {
      open: 'buy cover on the largest pool the protocol insures, for the longest term it offers',
      second: 'underwrite a small amount into the capital pool as well, so the account appears on both sides of the market',
      habit: 'renew the cover before it lapses so coverage never shows a gap',
    };
  if (c.includes('gaming') || c.includes('nft'))
    return {
      open: 'mint or buy one entry-level asset in the protocol\'s own marketplace and use it in the product',
      second: 'list and re-buy a small item through the protocol\'s marketplace so the account has trade history, not just a mint',
      habit: 'play or use the product in one short session, which is the activity these launches usually measure',
    };
  return {
    open: 'deposit the USDC into the protocol\'s main product and keep the position open',
    second: 'make one second, different kind of interaction the product offers (a second market, a governance vote, or a longer lock)',
    habit: 'repeat the core interaction with a slightly different amount, so the history reads as use, not as a single visit',
  };
}
function stepText(text) {
  let s = text.trim();
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep records of every transaction hash.`;
  return s;
}
function launchSteps(r) {
  const chain = r.chains[0] ?? 'its main chain';
  const secondChain = r.chains.length > 1 ? r.chains[1] : null;
  const gas = actionCostUsd(chain);
  const capital = capitalFor(r.tvl_usd);
  const weeks = planWeeks(r.age_days);
  const days = weeks * 7;
  const totalGas = planGasUsd(r, weeks);
  const book = playbookFor(r.category);
  const name = r.name;
  const moreChains =
    r.chains.length > 2 ? ` Its record also lists ${r.chains.slice(2).join(', ')}: one small action on each in week 2 widens the footprint.` : '';
  const steps = [
    `Set up one wallet for ${name} and fund it on ${chain} with $${capital} of USDC, with about $${gas * 6} of gas money to start; the whole plan below spends about $${totalGas} in gas in total. Cost: the $${capital} position plus about $${totalGas} in gas. Time: 20 minutes, once.`,
    `Open the position: ${book.open}. Cost: about $${gas} in gas; the $${capital} stays yours and withdrawable unless the product says otherwise. Time: 15 minutes.`,
    secondChain === null
      ? `Go one step deeper on ${chain}: ${book.second}. Cost: about $${gas * 2} in gas. Time: 25 minutes.`
      : `Repeat the core action on ${secondChain}, ${name}'s second chain, with a quarter of the capital, so the account is active on both deployments.${moreChains} Cost: about $${actionCostUsd(secondChain) * 2} in gas plus any bridge fee. Time: 30 minutes.`,
    `Run the weekly habit for ${weeks} weeks (${days} days): ${book.habit}. Cost: about $${gas} a week in gas, $${gas * weeks} over the plan. Time: 10 minutes a week for ${days} days.`,
    `Hold the position through the whole ${weeks} weeks (${days} days) without emptying the wallet: protocols read snapshots of balances and activity, and a wallet that leaves early usually scores as a passer-by. Cost: the $${capital} stays committed. Time: ${days} days of holding.`,
    `At a launch, act in the first claim window: check the wallet's allocation on ${name}'s own page, claim to the same wallet that farmed, and read the vesting terms before moving anything. Cost: about $${gas * 2} in gas. Time: about 1 hour, once, when it happens.`,
  ];
  return steps.map(stepText);
}
function productSteps(r) {
  const chain = r.chains[0] ?? 'its main chain';
  const gas = actionCostUsd(chain);
  const capital = capitalFor(r.tvl_usd);
  const weeks = planWeeks(r.age_days);
  const days = weeks * 7;
  const name = r.name;
  const reason = r.kind_label;
  const steps = [
    `Know what this row is before any money moves: ${name} is ${reason}. It records no token of its own in the snapshot, and there is no separate launch of ${name} to farm. Cost: $0. Time: 10 minutes of reading.`,
    `Place the exposure where it belongs: whatever ${name} is worth tracks the asset or platform behind it, not a future ${name} token. Any launch news, if it ever comes, will come from that parent, not from this entry. Cost: $0. Time: 10 minutes.`,
    `If you hold it anyway, hold it on its own terms: obtain about $${capital} of ${name} through its own platform on ${chain}. Cost: about $${gas * 2} in platform fees and gas for the round trip. Time: 20 minutes, once.`,
    `Hold it as a position, not a farm: review it on a ${weeks}-week cycle (${days} days), checking that the asset or platform behind it is unchanged. Cost: the $${capital} stays committed while you hold. Time: ${days} days of holding.`,
    `Watch the parent, not this row: five minutes a week checking the parent platform's own announcements is the whole routine, because there is no ${name} launch to position for. Cost: $0. Time: 5 minutes a week.`,
  ];
  return steps.map(stepText);
}
/* The farm plan for one row, in the form its kind calls for. */
function farmStepsFor(r) {
  return r.kind === 'product' ? productSteps(r) : launchSteps(r);
}

/* Header stats */
$('stats').innerHTML = [
  ['Snapshot', R.as_of], ['Protocols read', R.counts.protocols], ['Peers fitted', R.counts.peers],
  ['Board rows', R.counts.board], ['Launch candidates', R.counts.launches], ['Flagged products', R.counts.products],
  ['Watchlist', `${R.counts.watchlist}/${R.counts.watchlist}`],
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

const state = { q: '', cat: '', chain: '', kind: '', watch: false, sort: 'rank', sel: null, compare: [], pins: new Set(), sandbox: { growth: 0, mult: 0 } };
function visible() {
  let rows = R.rows.filter((r) =>
    (state.cat === '' || (r.category ?? 'Uncategorized') === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (state.kind === '' || r.kind === state.kind) &&
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
    <td><span class="name">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}${r.kind === 'product' ? `<span class="badge prod" title="${esc(r.kind_label)}">PRODUCT</span>` : ''}<br><span class="rowacts"><button type="button" class="rowbtn pinbtn${state.pins.has(r.slug) ? ' on' : ''}" data-pin="${esc(r.slug)}">${state.pins.has(r.slug) ? '★ Pinned' : '☆ Pin'}</button><button type="button" class="rowbtn cmpbtn${state.compare.includes(r.slug) ? ' on' : ''}" data-cmp="${esc(r.slug)}">${state.compare.includes(r.slug) ? '✓ In compare' : '+ Compare'}</button></span></td>
    <td>${esc(r.category ?? '—')}</td>
    <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
    <td class="num">${money(r.tvl_usd)}</td><td class="num">${pct(r.change_7d)}</td>
    <td class="num">${ageTxt(r.age_days)}</td><td class="num">×${r.model.multiple.toFixed(2)}</td>
    <td class="num"><strong>${money(r.implied_value_usd)}</strong></td>
    <td><div class="rangebar"><i style="left:${logPos(r.value_low_usd)}%;width:${Math.max(2, logPos(r.value_high_usd) - logPos(r.value_low_usd))}%"></i><b style="left:${logPos(r.implied_value_usd)}%"></b></div>
    <span class="rangetxt">${money(r.value_low_usd)} – ${money(r.value_high_usd)}</span></td></tr>`).join('');
  for (const tr of $('rows').querySelectorAll('tr')) tr.addEventListener('click', () => openDetail(tr.dataset.slug));
  for (const b of $('rows').querySelectorAll('.pinbtn')) b.addEventListener('click', (e) => { e.stopPropagation(); togglePin(b.dataset.pin); });
  for (const b of $('rows').querySelectorAll('.cmpbtn')) b.addEventListener('click', (e) => { e.stopPropagation(); toggleCompare(b.dataset.cmp); });
  renderPinned();
  syncCmpTab();
}
function openDetail(slug, tab = 'value') {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  state.sel = slug;
  renderBoard();
  const f = r.model;
  const check = r.tvl_usd * f.multiple * f.size * f.momentum * f.seasoning;
  const d = $('detail');
  d.hidden = false;
  d.innerHTML = `<button class="close" aria-label="Close">×</button>
    <h2>${esc(r.name)}${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}${r.kind === 'product' ? '<span class="badge prod">PRODUCT</span>' : ''}</h2>
    <p class="sub">Rank #${r.rank} of ${R.rows.length} · ${esc(r.category ?? 'Uncategorized')} · records no token</p>
    <p><button type="button" class="rowbtn cmpbtn${state.compare.includes(r.slug) ? ' on' : ''}" id="detail-cmp">${state.compare.includes(r.slug) ? '✓ In compare' : '+ Compare'}</button></p>
    <div class="big">${money(r.implied_value_usd)}</div>
    <div class="bigrange">implied launch value · range ${money(r.value_low_usd)} – ${money(r.value_high_usd)}</div>
    <div class="dtabs" role="tablist">
      <button type="button" data-tab="value" class="${tab === 'value' ? 'on' : ''}">Value</button>
      <button type="button" data-tab="farm" class="${tab === 'farm' ? 'on' : ''}">Farm plan</button>
      <button type="button" data-tab="record" class="${tab === 'record' ? 'on' : ''}">Record</button>
    </div>
    <div data-panel="value"${tab === 'value' ? '' : ' hidden'}>
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
    </div>
    <div data-panel="farm"${tab === 'farm' ? '' : ' hidden'}>
    <h3>Farm plan</h3>
    ${r.kind === 'product' ? `<p class="kindnote">Flagged: this row is ${esc(r.kind_label)}. It is ranked for coverage, and its plan is about the position, not a launch.</p>` : ''}
    <p class="glance"><span>Capital <strong>${money(r.plan.capital_usd)}</strong></span><span>Gas, total <strong>≈ ${money(r.plan.gas_usd)}</strong></span><span>Hold <strong>${r.plan.weeks} weeks (${r.plan.days} days)</strong></span><span>Steps <strong>${farmStepsFor(r).length}</strong></span></p>
    <ol class="plan">${farmStepsFor(r).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>
    <div data-panel="record"${tab === 'record' ? '' : ' hidden'}>
    <h3>The record, as the snapshot holds it</h3>
    <dl class="kv">
      <dt>Slug</dt><dd>${esc(r.slug)}</dd>
      <dt>Kind</dt><dd>${esc(r.kind)} — ${esc(r.kind_label)}</dd>
      <dt>Category</dt><dd>${esc(r.category ?? 'none recorded')}</dd>
      <dt>Chains</dt><dd>${esc(r.chains.join(', ') || 'none listed')}</dd>
      <dt>Tracked since</dt><dd>${esc(r.listed_at ?? 'not dated')}</dd>
      <dt>Age, no token</dt><dd>${r.age_days === null ? 'not dated' : `${r.age_days} days`}</dd>
      <dt>TVL, as recorded</dt><dd>$${r.tvl_usd.toLocaleString('en-US')}</dd>
      <dt>7-day change, raw</dt><dd>${r.change_7d === null ? 'not recorded' : r.change_7d}</dd>
      <dt>Implied value, raw</dt><dd>$${Math.round(r.implied_value_usd).toLocaleString('en-US')}</dd>
      <dt>On the watchlist</dt><dd>${r.watchlist ? 'yes' : 'no'}</dd>
    </dl>
    </div>`;
  d.querySelector('.close').addEventListener('click', () => { d.hidden = true; state.sel = null; renderBoard(); });
  $('detail-cmp').addEventListener('click', () => { const t = d.querySelector('.dtabs button.on')?.dataset.tab ?? 'value'; toggleCompare(r.slug); openDetail(r.slug, t); });
  for (const b of d.querySelectorAll('.dtabs button')) b.addEventListener('click', () => {
    for (const x of d.querySelectorAll('.dtabs button')) x.classList.toggle('on', x === b);
    for (const p of d.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== b.dataset.tab;
  });
  d.scrollTop = 0;
}
for (const [id, key, fn] of [['q', 'q', (v) => v.toLowerCase()], ['f-cat', 'cat', (v) => v], ['f-chain', 'chain', (v) => v], ['f-kind', 'kind', (v) => v], ['f-sort', 'sort', (v) => v]])
  $(id).addEventListener('input', (e) => { state[key] = fn(e.target.value); renderBoard(); });
$('f-watch').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });

/* Pins: a strip above the board that survives every filter and sort. */
function togglePin(slug) {
  if (state.pins.has(slug)) state.pins.delete(slug);
  else state.pins.add(slug);
  renderBoard();
}
function renderPinned() {
  const box = $('pinned');
  if (state.pins.size === 0) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<span class="pinned-label">Pinned</span>' + [...state.pins].map((slug) => {
    const r = R.rows.find((x) => x.slug === slug);
    if (!r) return '';
    return `<span class="pin-chip"><button type="button" class="pin-name" data-open="${esc(slug)}">#${r.rank} ${esc(r.name)} · <strong>${money(r.implied_value_usd)}</strong></button><button type="button" class="pin-x" data-unpin="${esc(slug)}" aria-label="Unpin">×</button></span>`;
  }).join('');
  for (const b of box.querySelectorAll('[data-open]')) b.addEventListener('click', () => openDetail(b.dataset.open));
  for (const b of box.querySelectorAll('[data-unpin]')) b.addEventListener('click', () => togglePin(b.dataset.unpin));
}

/* Compare: up to three protocols, side by side, best value per row highlighted. */
function toggleCompare(slug) {
  const i = state.compare.indexOf(slug);
  if (i >= 0) state.compare.splice(i, 1);
  else if (state.compare.length < 3) state.compare.push(slug);
  renderBoard();
  renderCompare();
}
function syncCmpTab() {
  $('cmp-count').textContent = state.compare.length > 0 ? `(${state.compare.length})` : '';
}
function renderCompare() {
  const wrap = $('compare-wrap');
  if (state.compare.length === 0) {
    wrap.innerHTML = '<p class="lede">Nothing to compare yet — add protocols from the board with the “+ Compare” button on any row, or from a protocol’s detail view.</p>';
    return;
  }
  const rows = state.compare.map((slug) => R.rows.find((x) => x.slug === slug)).filter(Boolean);
  const metric = (label, val, best) => ({ label, val, best });
  const metrics = [
    metric('Rank', (r) => `#${r.rank}`, (rs) => rs.indexOf(rs.reduce((a, b) => (a.rank <= b.rank ? a : b)))),
    metric('TVL', (r) => money(r.tvl_usd), (rs) => rs.indexOf(rs.reduce((a, b) => (a.tvl_usd >= b.tvl_usd ? a : b)))),
    metric('7-day change', (r) => r.change_7d === null ? '—' : `${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`, (rs) => rs.indexOf(rs.reduce((a, b) => ((a.change_7d ?? -Infinity) >= (b.change_7d ?? -Infinity) ? a : b)))),
    metric('Age, no token', (r) => r.age_days === null ? 'unknown' : ageTxt(r.age_days), (rs) => rs.indexOf(rs.reduce((a, b) => ((a.age_days ?? -1) >= (b.age_days ?? -1) ? a : b)))),
    metric('Category', (r) => r.category ?? '—', null),
    metric('Chains', (r) => r.chains.join(', '), null),
    metric('Peer multiple', (r) => `×${r.model.multiple.toFixed(2)}`, (rs) => rs.indexOf(rs.reduce((a, b) => (a.model.multiple >= b.model.multiple ? a : b)))),
    metric('Implied value', (r) => money(r.implied_value_usd), (rs) => rs.indexOf(rs.reduce((a, b) => (a.implied_value_usd >= b.implied_value_usd ? a : b)))),
    metric('Range', (r) => `${money(r.value_low_usd)} – ${money(r.value_high_usd)}`, null),
    metric('Farm steps', (r) => `${farmStepsFor(r).length} steps — ${farmStepsFor(r)[0]}`, (rs) => rs.indexOf(rs.reduce((a, b) => (farmStepsFor(a).length >= farmStepsFor(b).length ? a : b)))),
  ];
  wrap.innerHTML = `<table class="cmp"><thead><tr><th></th>${rows.map((r) => `<th><span class="name">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''} <button type="button" class="rowbtn rm" data-rm="${esc(r.slug)}" aria-label="Remove from compare">×</button></th>`).join('')}</tr></thead><tbody>${
    metrics.map((m) => `<tr><th>${m.label}</th>${rows.map((r, i) => `<td class="${m.best !== null && m.best(rows) === i ? 'best' : ''}">${m.best !== null && m.best(rows) === i ? `<strong>${esc(m.val(r))}</strong>` : esc(m.val(r))}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
  for (const b of wrap.querySelectorAll('[data-rm]')) b.addEventListener('click', () => toggleCompare(b.dataset.rm));
}

/* Sandbox: re-price the board under two what-if changes, using the model's
   own factors (TVL × multiple × size × momentum × seasoning). The submitted
   board never changes — this is a separate, labelled re-ranking. */
function sandboxValue(r, growthPct, multPct) {
  const growth = r.change_7d === null ? 0 : clamp(r.change_7d * (1 + growthPct), -60, 120);
  const momentum = clamp(Math.exp(0.5 * R.model.momentum_slope * growth), 0.9, 1.11);
  const multiple = r.model.multiple * (1 + multPct);
  return Math.max(1, Math.round(r.tvl_usd * multiple * r.model.size * momentum * r.model.seasoning));
}
function renderSandbox() {
  $('sb-growth-out').textContent = `×${(1 + state.sandbox.growth).toFixed(2)}`;
  $('sb-multiple-out').textContent = `×${(1 + state.sandbox.mult).toFixed(2)}`;
  /* Deltas are measured against the same rounded-factor recomputation at
     zero change, so the sliders at rest read exactly 0.0% — the page's stored
     factors are rounded to 3 decimals, and the board's own values were priced
     from the unrounded fit, which differs by up to ~0.1%. */
  const ranked = R.rows.map((r) => {
    const base = sandboxValue(r, 0, 0);
    return { r, v: sandboxValue(r, state.sandbox.growth, state.sandbox.mult), base };
  }).sort((a, b) => b.v - a.v || (a.r.slug < b.r.slug ? -1 : 1)).slice(0, 5);
  $('sb-top').innerHTML = ranked.map(({ r, v, base }, i) => {
    const delta = ((v - base) / base) * 100;
    return `<li><strong>#${i + 1}</strong> ${esc(r.name)} — <strong>${money(v)}</strong> <span class="delta${delta < 0 ? ' neg' : ''}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}% vs the board</span> <span class="flat">(was #${r.rank})</span></li>`;
  }).join('');
}
$('sb-growth').addEventListener('input', (e) => { state.sandbox.growth = Number(e.target.value) / 100; renderSandbox(); });
$('sb-multiple').addEventListener('input', (e) => { state.sandbox.mult = Number(e.target.value) / 100; renderSandbox(); });
$('sb-reset').addEventListener('click', () => {
  state.sandbox = { growth: 0, mult: 0 };
  $('sb-growth').value = '0'; $('sb-multiple').value = '0';
  renderSandbox();
});

/* CSV export: the rows currently visible under the active filters and sort. */
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
$('export-csv').addEventListener('click', () => {
  const head = ['rank', 'name', 'slug', 'category', 'chains', 'tvl_usd', 'change_7d_pct', 'age_days', 'multiple', 'implied_value_usd', 'value_low_usd', 'value_high_usd'];
  const lines = [head.join(',')].concat(visible().map((r) => [
    r.rank, r.name, r.slug, r.category ?? '', r.chains.join(' | '), r.tvl_usd,
    r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days,
    r.model.multiple, r.implied_value_usd, r.value_low_usd, r.value_high_usd,
  ].map(csvCell).join(',')));
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'token-radar-board.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

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

/* Views and hash presets (#view=method, #view=compare, #compare=a,b,c, #detail=<slug>, #cat=<name>, #watch=1) */
function show(view) {
  for (const v of ['board', 'live', 'method', 'compare']) {
    $(`view-${v}`).hidden = v !== view;
    document.querySelector(`.tab[data-view="${v}"]`).classList.toggle('on', v === view);
  }
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => show(t.dataset.view));
renderBoard();
renderCompare();
renderSandbox();
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('cat')) { state.cat = hash.get('cat'); $('f-cat').value = state.cat; renderBoard(); }
if (hash.get('watch') === '1') { state.watch = true; $('f-watch').checked = true; renderBoard(); }
if (hash.get('sort')) { state.sort = hash.get('sort'); $('f-sort').value = state.sort; renderBoard(); }
if (hash.get('compare')) {
  state.compare = hash.get('compare').split(',').map((s) => s.trim()).filter((s) => R.rows.some((r) => r.slug === s)).slice(0, 3);
  renderBoard();
  renderCompare();
}
if (hash.get('kind') === 'launch' || hash.get('kind') === 'product') { state.kind = hash.get('kind'); $('f-kind').value = state.kind; renderBoard(); }
if (hash.get('view')) show(hash.get('view'));
if (hash.get('detail')) openDetail(hash.get('detail'), ['value', 'farm', 'record'].includes(hash.get('tab')) ? hash.get('tab') : 'value');
