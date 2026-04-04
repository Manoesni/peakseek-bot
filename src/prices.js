const { getMids } = require('./hyperliquid');

async function priceFromHyperliquid(symbol) {
try {
const mids = await getMids();
const px = Number(mids?.[symbol]);
return Number.isFinite(px) ? { price: px, source: 'HL' } : null;
} catch {
return null;
}
}

async function priceFromDexscreener(symbol) {
try {
// Generic token search fallback
const q = encodeURIComponent(symbol);
const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${q}`);
if (!r.ok) return null;

const j = await r.json();
const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
if (!pairs.length) return null;

// pick best by liquidity first
pairs.sort((a, b) => {
const la = Number(a?.liquidity?.usd || 0);
const lb = Number(b?.liquidity?.usd || 0);
return lb - la;
});

const top = pairs[0];
const px = Number(top?.priceUsd);
if (!Number.isFinite(px)) return null;

return {
price: px,
source: 'DEX',
chain: String(top?.chainId || 'n/a').toUpperCase(),
pairAddress: top?.pairAddress || null
};
} catch {
return null;
}
}

async function getBestPrice(symbol) {
const s = String(symbol || '').toUpperCase();

const hl = await priceFromHyperliquid(s);
if (hl) return hl;

const dex = await priceFromDexscreener(s);
if (dex) return dex;

return null;
}

module.exports = { getBestPrice, priceFromHyperliquid, priceFromDexscreener };
