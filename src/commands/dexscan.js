const { reply } = require('../telegram');

function num(v, d = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : d;
}

function cleanSymbol(s) {
s = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (!s || s.length < 2 || s.length > 12) return null;
return s;
}

function normPair(p) {
const base = cleanSymbol(p?.baseToken?.symbol || p?.base?.symbol || p?.symbol);
const chain = String(p?.chainId || p?.chain || 'n/a').toUpperCase();
const liq = num(p?.liquidity?.usd || p?.liquidityUsd, 0);
const vol = num(p?.volume?.h24 || p?.volume24h, 0);
const change = num(p?.priceChange?.h24 || p?.priceChange24h, 0);

if (!base) return null;
const score = Math.max(1, Math.min(99, Math.round(
Math.min(35, liq / 50000) +
Math.min(35, vol / 100000) +
Math.min(20, Math.abs(change) / 2) +
10
)));

return { token: base, chain, liq, vol, change, score };
}

function dedup(rows) {
const out = [];
const seen = new Set();
for (const r of rows) {
const k = `${r.token}|${r.chain}`;
if (seen.has(k)) continue;
seen.add(k);
out.push(r);
}
return out;
}

function fmtUsd(n) {
if (!n) return 'n/a';
if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
return `$${n.toFixed(0)}`;
}

async function fetchBoosts() {
const r = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
if (!r.ok) return [];
const j = await r.json();
if (!Array.isArray(j)) return [];
return j.map(x => ({
token: cleanSymbol(x?.tokenSymbol || x?.symbol),
chain: String(x?.chainId || x?.chain || 'n/a').toUpperCase(),
liq: 0,
vol: 0,
change: 0,
score: Math.max(55, Math.min(95, Math.round(num(x?.amount, 60))))
})).filter(x => x.token);
}

async function fetchSolanaPairsFallback() {
// fallback: stable response format in practice
const url = 'https://api.dexscreener.com/latest/dex/search/?q=SOL/USDC';
const r = await fetch(url);
if (!r.ok) return [];
const j = await r.json();
const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
return pairs.map(normPair).filter(Boolean);
}

async function handleDexscan(chatId, parts = []) {
const sub = (parts[1] || '').toLowerCase();

if (sub === 'live') {
try {
let rows = await fetchBoosts();

// fallback if boosts are poor/unknown
if (rows.length < 3) {
const fb = await fetchSolanaPairsFallback();
rows = fb;
}

rows = dedup(rows).sort((a, b) => b.score - a.score).slice(0, 10);

if (!rows.length) {
await reply(chatId, '🧪 DEX Scan Live\nNo tokens found right now. Try again in 1–2 min.');
return;
}

let txt = '🧪 DEX Scan Live\n';
for (const r of rows) {
txt += `\n• ${r.token} (${r.chain}) | score ${r.score} | liq ${fmtUsd(r.liq)} | vol24 ${fmtUsd(r.vol)}`;
}
txt += '\n\nPaper test:\n• /dexpick <TOKEN> <amount>\nExample: /dexpick WIF 15';
await reply(chatId, txt);
return;
} catch {
await reply(chatId, 'DEX live scan failed right now. Try again in 1–2 minutes.');
return;
}
}

await reply(
chatId,
`🧪 DEX Scan
Use:
• /dexscan live
• /dexpick <TOKEN> <amount> (paper entry helper)`
);
}

module.exports = { handleDexscan };
