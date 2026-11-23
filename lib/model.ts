// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board prices every protocol that records no token yet by what its launch
// would be worth. The price is not a constant anyone picked: it is fitted, at
// run time, to the snapshot's own tokenized protocols — the peers whose tokens
// already trade and whose market caps the same file records.
//
//   implied = tvl x categoryMultiple x sizeFactor x momentumFactor x seasoningFactor
//
// - categoryMultiple: the median market-cap/TVL of the category's tokenized
//   peers, ratios winsorized to the cross-section's 5th-95th percentiles and
//   the median shrunk toward the global median with prior strength SHRINK_K,
//   so a category with one loud peer cannot price a board. The 25th and 75th
//   percentiles, shrunk the same way, give each row a value range.
// - sizeFactor: among the peers, market cap grows sublinearly with TVL (a
//   log-log fit; slope near 0.52 on this snapshot). Half of that fitted
//   elasticity is applied around the peers' median TVL, so size tempers the
//   multiple instead of compounding it.
// - momentumFactor: a joint fit of log market cap on log TVL, weekly growth
//   and log age finds market caps lag a one-week TVL surge (the denominator
//   moves before any re-rating). Half of that fitted slope, clamped to a
//   narrow band, corrects for it: one week of movement is a correction,
//   never a re-rating.
// - seasoningFactor: the same joint fit's age slope, half strength, clamped.
//   On this snapshot it is small and slightly favours the young; the radar
//   reports it rather than assuming the usual "older is worth more".
//
// Every fitted number is computed from the file the program is handed and is
// printed into the dashboard's data, so the page can show the model's own
// coefficients. The only chosen constants are the shrinkage strength, the
// half-strength damping and the clamps, and they are stated here and on the
// page. No protocol name is ever special-cased: one function prices every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Prior strength of the global median when shrinking a category's multiple. */
export const SHRINK_K = 8;
/** The dashboard's model label. */
export const MODEL_VERSION = 'peerfit-2';
/** How many already-trading protocols the dashboard's live view carries. */
export const LIVE_ROWS = 24;

/** Parse and lightly validate the sealed snapshot document. */
export function parseSnapshot(text: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not valid JSON');
  }
  const d = doc as Partial<Snapshot>;
  if (typeof d.as_of !== 'string' || !Array.isArray(d.protocols) || !Array.isArray(d.watchlist)) {
    throw new SnapshotError('the snapshot lacks as_of, protocols or watchlist');
  }
  if (d.protocols.length === 0) throw new SnapshotError('the snapshot carries no protocols');
  return d as Snapshot;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const sortedCopy = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

/** The median of a non-empty sample. */
export function median(xs: number[]): number {
  const s = sortedCopy(xs);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The p-quantile of a sample, nearest-rank. */
export function quantile(xs: number[], p: number): number {
  const s = sortedCopy(xs);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]!;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Ordinary least squares for y ~ 1 + xs (rows already aligned); null when the system is singular. */
function ols(rows: number[][], ys: number[]): number[] | null {
  const k = rows[0]!.length + 1;
  const xtx: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const xty: number[] = Array(k).fill(0);
  rows.forEach((r, i) => {
    const a = [1, ...r];
    for (let u = 0; u < k; u++) {
      xty[u] += a[u]! * ys[i]!;
      for (let v = 0; v < k; v++) xtx[u]![v] += a[u]! * a[v]!;
    }
  });
  const m = xtx.map((r, i) => [...r, xty[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    if (Math.abs(m[piv]![c]!) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= k; j++) m[r]![j] -= f * m[c]![j]!;
    }
  }
  return m.map((r, i) => r[k]! / m[i]![i]!);
}

/** One category's fitted multiples: the shrunk median and the shrunk interquartile band. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  multiple: number;
  low: number;
  high: number;
}

/** Everything the cross-section fit produces, stated on the dashboard as the model's own numbers. */
export interface PeerModel {
  peer_count: number;
  winsor_low: number;
  winsor_high: number;
  global_multiple: number;
  global_low: number;
  global_high: number;
  ref_tvl_usd: number;
  size_exponent: number;
  momentum_slope: number;
  seasoning_slope: number;
  ref_age_days: number;
  categories: CategoryMultiple[];
  byCategory: Map<string, CategoryMultiple>;
}

/**
 * Fit the peer model to the snapshot's tokenized protocols: those with a
 * recorded market cap above zero. Everything downstream is a function of
 * this fit and of the protocol's own record.
 */
export function fitPeerModel(snapshot: Snapshot): PeerModel {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (peers.length < 20) throw new SnapshotError(`only ${peers.length} tokenized peers with a market cap: too few to fit a model`);
  const rawRatios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
  const winsorLow = quantile(rawRatios, 0.05);
  const winsorHigh = quantile(rawRatios, 0.95);
  const ratioOf = new Map(peers.map((p) => [p.slug, clamp(p.mcap_usd! / p.tvl_usd, winsorLow, winsorHigh)]));
  const winsorized = peers.map((p) => ratioOf.get(p.slug)!);
  const globalMultiple = median(winsorized);
  const globalLow = quantile(winsorized, 0.25);
  const globalHigh = quantile(winsorized, 0.75);
  const capLow = quantile(winsorized, 0.1);
  const capHigh = quantile(winsorized, 0.9);

  const shrink = (sample: number[], stat: (xs: number[]) => number, globalStat: number): number =>
    (sample.length * stat(sample) + SHRINK_K * globalStat) / (sample.length + SHRINK_K);

  const groups = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? 'Uncategorized';
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [ratioOf.get(p.slug)!]);
    else list.push(ratioOf.get(p.slug)!);
  }
  const categories: CategoryMultiple[] = [...groups.entries()]
    .map(([category, sample]) => {
      const multiple = clamp(shrink(sample, median, globalMultiple), capLow, capHigh);
      const low = Math.min(multiple, shrink(sample, (xs) => quantile(xs, 0.25), globalLow));
      const high = Math.max(multiple, shrink(sample, (xs) => quantile(xs, 0.75), globalHigh));
      return { category, peers: sample.length, multiple: round3(multiple), low: round3(low), high: round3(high) };
    })
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));

  // The scale fit: log market cap on log TVL. Its slope below 1 is what the
  // size factor applies, at half strength, around the peers' median TVL.
  const scaleRows = peers.map((p) => [Math.log(p.tvl_usd)]);
  const scaleYs = peers.map((p) => Math.log(p.tvl_usd * ratioOf.get(p.slug)!));
  const scaleFit = ols(scaleRows, scaleYs);
  const scaleSlope = scaleFit === null ? 1 : clamp(scaleFit[1]!, 0.3, 0.9);
  const sizeExponent = (scaleSlope - 1) / 2;
  const refTvl = median(peers.map((p) => p.tvl_usd));

  // The joint fit behind the two tilts: log market cap on log TVL, weekly
  // growth (winsorized to the range the field guide reports) and log age.
  const jointRows: number[][] = [];
  const jointYs: number[] = [];
  const peerAges: number[] = [];
  for (const p of peers) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (p.change_7d === null || age === null) continue;
    jointRows.push([Math.log(p.tvl_usd), clamp(p.change_7d, -60, 120), Math.log(Math.max(7, age))]);
    jointYs.push(Math.log(p.tvl_usd * ratioOf.get(p.slug)!));
    peerAges.push(age);
  }
  const joint = jointRows.length >= 40 ? ols(jointRows, jointYs) : null;
  const momentumSlope = joint === null ? 0 : joint[2]!;
  const seasoningSlope = joint === null ? 0 : joint[3]!;
  const refAge = peerAges.length > 0 ? median(peerAges) : 365;

  return {
    peer_count: peers.length,
    winsor_low: round3(winsorLow),
    winsor_high: round3(winsorHigh),
    global_multiple: round3(globalMultiple),
    global_low: round3(globalLow),
    global_high: round3(globalHigh),
    ref_tvl_usd: Math.round(refTvl),
    size_exponent: round3(sizeExponent),
    momentum_slope: round3(momentumSlope),
    seasoning_slope: round3(seasoningSlope),
    ref_age_days: Math.round(refAge),
    categories,
    byCategory: new Map(categories.map((c) => [c.category, c])),
  };
}

/** The fitted factors one protocol gets; every factor is 1 for a median peer-shaped protocol. */
export interface Factors {
  multiple: number;
  low_multiple: number;
  high_multiple: number;
  size: number;
  momentum: number;
  seasoning: number;
}

/** Price one pre-token protocol under the fitted model. */
export function priceProtocol(p: SnapshotProtocol, model: PeerModel, asOf: string): { implied: number; low: number; high: number; factors: Factors; age: number | null; peers: number } {
  const cat = model.byCategory.get(p.category ?? 'Uncategorized');
  const peers = cat?.peers ?? 0;
  const multiple = cat?.multiple ?? model.global_multiple;
  const lowMultiple = cat?.low ?? model.global_low;
  const highMultiple = cat?.high ?? model.global_high;
  const size = clamp(Math.pow(p.tvl_usd / model.ref_tvl_usd, model.size_exponent), 0.3, 1.6);
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -60, 120);
  const momentum = clamp(Math.exp(0.5 * model.momentum_slope * growth), 0.9, 1.11);
  const age = ageDays(asOf, p.listed_at);
  const seasoning = age === null ? 1 : clamp(Math.exp(0.5 * model.seasoning_slope * (Math.log(Math.max(7, age)) - Math.log(model.ref_age_days))), 0.85, 1.18);
  const common = size * momentum * seasoning;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * common));
  const low = Math.min(implied, Math.max(1, Math.round(p.tvl_usd * lowMultiple * common)));
  const high = Math.max(implied, Math.round(p.tvl_usd * highMultiple * common));
  return {
    implied,
    low,
    high,
    age,
    peers,
    factors: {
      multiple,
      low_multiple: lowMultiple,
      high_multiple: highMultiple,
      size: round3(size),
      momentum: round3(momentum),
      seasoning: round3(seasoning),
    },
  };
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * The radar's own selection rule: the watchlist's definition, applied at
 * every TVL instead of only above its floor. A pre-token protocol qualifies
 * unless it is a wrapped, staked, bridged or versioned product of another
 * protocol, or an exchange's own page. The watchlist itself is always
 * carried whole, whatever this rule would say.
 */
export function isGenuineLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Farm plans. Each plan is generated from the protocol's own record: its
// category picks the playbook, its chains pick where the steps happen and
// what an action costs there, its TVL picks the position size, and its age
// picks how many weeks the plan runs. No plan names a protocol the record
// does not name.
// ---------------------------------------------------------------------------

/** What one on-chain action costs, by the chain it happens on (gas, in dollars). */
function actionCostUsd(chain: string): number {
  if (chain === 'Ethereum') return 9;
  if (chain === 'Solana' || chain === 'Base' || chain === 'Arbitrum' || chain === 'OP Mainnet' || chain === 'Polygon' || chain === 'Avalanche' || chain === 'BSC') return 1;
  return 3;
}

/** The position size the plan works with, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 75;
  return 40;
}

/** How many weeks the plan runs, from how long the protocol has run with no token. */
function planWeeks(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 10;
  if (age < 730) return 8;
  return 6;
}

interface Playbook {
  open: string;
  second: string;
  habit: string;
}

/** The category's playbook: the core action, the second-order action, the weekly habit. */
function playbookFor(category: string | null): Playbook {
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

/** Keep one farm step inside the gate's 20..600 trimmed characters. */
function stepText(text: string): string {
  let s = text.trim();
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep records of every transaction hash.`;
  return s;
}

/** One protocol's farm plan: six steps, each with what it costs and how long it takes. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = actionCostUsd(chain);
  const capital = capitalFor(p.tvl_usd);
  const weeks = planWeeks(age);
  const book = playbookFor(p.category);
  const name = p.name;
  const steps = [
    `Set up one wallet for ${name} and fund it on ${chain} with $${capital} of USDC plus about $${gas * 6} for gas across the plan. Cost: about $${gas * 6} in gas on top of the position. Time: 20 minutes, once.`,
    `Open the position: ${book.open}. Cost: about $${gas} in gas; the $${capital} stays yours and withdrawable unless the product says otherwise. Time: 15 minutes.`,
    secondChain === null
      ? `Go one step deeper on ${chain}: ${book.second}. Cost: about $${gas * 2} in gas. Time: 25 minutes.`
      : `Repeat the core action on ${secondChain}, ${name}'s second chain, with a quarter of the capital, so the account is active on both deployments. Cost: about $${actionCostUsd(secondChain) * 2} in gas plus any bridge fee. Time: 30 minutes.`,
    `Run the weekly habit for ${weeks} weeks: ${book.habit}. Cost: about $${gas} a week in gas, $${gas * weeks} over the plan. Time: 10 minutes a week, ${weeks} weeks.`,
    `Hold the position through the whole ${weeks} weeks without emptying the wallet: protocols read snapshots of balances and activity, and a wallet that leaves early usually scores as a passer-by. Cost: the $${capital} stays committed. Time: ${weeks} weeks of holding.`,
    `At a launch, act in the first claim window: check the wallet's allocation on ${name}'s own page, claim to the same wallet that farmed, and read the vesting terms before moving anything. Cost: about $${gas * 2} in gas. Time: about 1 hour, once, when it happens.`,
  ];
  return steps.map(stepText);
}

// ---------------------------------------------------------------------------
// The board and the dashboard's data.
// ---------------------------------------------------------------------------

/** One row of board.json: the ranked claim, its fitted factors and its farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  /** How many tokenized peers of its category priced this row (0: priced on the global cross-section). */
  peers: number;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  model: Factors;
  farm_steps: string[];
}

/** The dashboard's compact copy of one row (the page re-derives nothing). */
export interface RadarRow extends Omit<BoardRow, 'farm_steps'> {
  farm_steps: string[];
}

/** An already-trading protocol, shown apart from the ranked board at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the live set, and the fitted model that priced it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  counts: { protocols: number; peers: number; pre_token: number; board: number; watchlist: number; live: number };
  model: Omit<PeerModel, 'byCategory'>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Build the ranked board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; data: RadarData } {
  const model = fitPeerModel(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isGenuineLaunchCandidate(p)) chosen.set(p.slug, p);
  // The watchlist is the floor: carried whole even if the selection rule
  // above would have left a name out (on this snapshot it leaves none out).
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const priced = priceProtocol(p, model, snapshot.as_of);
    return { p, ...priced };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    watchlist: watch.has(s.p.slug),
    peers: s.peers,
    implied_value_usd: s.implied,
    value_low_usd: s.low,
    value_high_usd: s.high,
    model: s.factors,
    farm_steps: farmSteps(s.p, s.age),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, change_7d: p.change_7d }));
  const { byCategory: _drop, ...modelPublic } = model;
  const data: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    counts: {
      protocols: snapshot.protocols.length,
      peers: model.peer_count,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      live: live.length,
    },
    model: modelPublic,
    rows: board,
    live,
  };
  return { board, data };
}

/** The dashboard's data as the script the page loads beside it. */
export function dataScript(data: RadarData): string {
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}

/**
 * The gate's board rows, checked the way the sealed scorer checks them:
 * returns the first problem, or null when the board is valid.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, not ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000)
      return `row ${i + 1}: implied value ${row.implied_value_usd} is not a positive whole number within the cap`;
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises with rank`;
    if (i > 0 && row.implied_value_usd !== board[0]!.implied_value_usd) allEqual = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: ${row.farm_steps.length} farm steps, outside 3..12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters, outside 20..600`;
    }
  }
  if (allEqual) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  return null;
}
