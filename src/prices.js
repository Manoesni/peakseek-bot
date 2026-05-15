const { getMids } = require('./hyperliquid');
const { priceGuardCache } = require('./state');

const MAX_JUMP_PCT = 60;

function keyFor(symbol, pairAddress) {
return pairAddress ? `PAIR:${pairAddress}` : `SYM:${symbol}`;
}

function guardedPrice(symbol, pairAddress, raw) {
const key = keyFor(symbol, pairAddress);
const prev = priceGuardCache.get(key);

if (!prev || !Number.isFinite(prev.price)) {
priceGuardCache.set(key, { price: raw, ts: Date.now(), outlierCount: 0 });
return { price: raw, filtered: false };
}

const jumpPct = Math.abs((raw - prev.price) / prev.price) * 100;
if (jumpPct > MAX_JUMP_PCT) {
priceGuardCache.set(key, { ...prev, ts: Date.now(), outlierCount: (prev.outlierCount || 0) + 1 });
return { price: prev.price, filtered: true, jumpPct };
}

priceGuardCache.set(key, { price: raw, ts: Date.now(), outlierCount: 0 });
return { price: raw, filtered: false };
}

async function priceFromHL(symbol) {
try {
const mids = await getMids();
const px = Number(mids?.[symbol]);
if (!Number.isFinite(px)) return null;
return { price: px, source: 'HL' };
} catch { return null; }
}

async function priceFromDexPair(pairAddress, symbol = '') {
try {
if (!pairAddress) return null;
const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/all/${pairAddress}`);
if (!r.ok) return null;
const j = await r.json();
const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
if (!pairs.length) return null;

const p = pairs[0];
const raw = Number(p?.priceUsd);
if (!Number.isFinite(raw)) return null;

const g = guardedPrice(symbol, pairAddress, raw);
return {
price: g.price,
source: 'DEX',
chain: String(p?.chainId || 'n/a').toUpperCase(),
pairAddress: p?.pairAddress || pairAddress,
filteredOutlier: !!g.filtered,
filteredJumpPct: g.jumpPct || null
};
} catch { return null; }
}

async function priceFromDexSearch(symbol) {
try {
const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(symbol)}`);
if (!r.ok) return null;
const j = await r.json();
const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
if (!pairs.length) return null;

pairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
const top = pairs[0];
const raw = Number(top?.priceUsd);
if (!Number.isFinite(raw)) return null;

const pairAddress = top?.pairAddress || null;
const g = guardedPrice(symbol, pairAddress, raw);

return {
price: g.price,
source: 'DEX',
chain: String(top?.chainId || 'n/a').toUpperCase(),
pairAddress,
filteredOutlier: !!g.filtered,
filteredJumpPct: g.jumpPct || null
};
} catch { return null; }
}

// strict fallback: same symbol + same chain only
async function priceFromDexSearchByChain(symbol, chain) {
try {
const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(symbol)}`);
if (!r.ok) return null;
const j = await r.json();
const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
if (!pairs.length) return null;

const chainU = String(chain || '').toUpperCase();
const filtered = pairs.filter(p => String(p?.chainId || '').toUpperCase() === chainU);
if (!filtered.length) return null;

filtered.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
const top = filtered[0];

const raw = Number(top?.priceUsd);
if (!Number.isFinite(raw)) return null;

const pairAddress = top?.pairAddress || null;
const g = guardedPrice(symbol, pairAddress, raw);

return {
price: g.price,
source: 'DEX',
chain: chainU,
pairAddress,
filteredOutlier: !!g.filtered,
filteredJumpPct: g.jumpPct || null
};
} catch { return null; }
}

/**
* opts:
* - pairAddress
* - sourceLock: 'HL' | 'DEX'
* - strict
* - chainHint (for DEX strict fallback)
*/
async function getBestPrice(symbol, opts = {}) {
const s = String(symbol || '').toUpperCase();
const sourceLock = opts.sourceLock || null;
const strict = !!opts.strict;

if (sourceLock === 'DEX') {
// 1) pair lock first
if (opts.pairAddress) {
const p = await priceFromDexPair(opts.pairAddress, s);
if (p) return p;
}
// 2) strict fallback within same chain
if (opts.chainHint) {
const byChain = await priceFromDexSearchByChain(s, opts.chainHint);
if (byChain) return byChain;
}
// 3) strict mode does NOT fallback to HL
if (strict) return null;
return await priceFromDexSearch(s);
}

if (sourceLock === 'HL') {
const hl = await priceFromHL(s);
if (hl) return hl;
if (strict) return null;
if (opts.pairAddress) {
const p = await priceFromDexPair(opts.pairAddress, s);
if (p) return p;
}
return await priceFromDexSearch(s);
}

// unlocked default
if (opts.pairAddress) {
const p = await priceFromDexPair(opts.pairAddress, s);
if (p) return p;
}
const hl = await priceFromHL(s);
if (hl) return hl;
const dex = await priceFromDexSearch(s);
if (dex) return dex;
return null;
}

module.exports = { getBestPrice, priceFromDexPair };
