const { reply } = require('../telegram');

async function fetchDexscreenerBoosts() {
const r = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
if (!r.ok) throw new Error('dexscreener fetch failed');
const data = await r.json();
return Array.isArray(data) ? data : [];
}

function pickSymbol(x) {
const candidates = [
x?.tokenSymbol,
x?.symbol,
x?.baseToken?.symbol,
x?.quoteToken?.symbol,
x?.token?.symbol,
x?.ticker
].filter(Boolean);

let s = candidates[0] || 'UNK';
s = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
if (!s || s.length < 2 || s.length > 12) return 'UNK';
return s;
}

function pickChain(x) {
const c = x?.chainId || x?.chain || x?.network || 'n/a';
return String(c).toUpperCase();
}

function num(v, d = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : d;
}

function scoreRow(x) {
// Heuristic score from available fields
const amount = num(x?.amount, 0); // boost amount
const totalAmount = num(x?.totalAmount, 0); // if exists
const liquidity = num(x?.liquidityUsd, 0); // if exists
const vol24 = num(x?.volume24h, 0); // if exists

// weighted compact score
let score = 0;
score += Math.min(40, amount / 25);
score += Math.min(20, totalAmount / 100);
score += Math.min(20, liquidity / 50000);
score += Math.min(20, vol24 / 100000);

// baseline for rows with any signal
if (score === 0 && amount > 0) score = 55;
return Math.max(1, Math.min(99, Math.round(score)));
}

function normalizeRow(x) {
const token = pickSymbol(x);
const chain = pickChain(x);
const score = scoreRow(x);
const liquidityUsd = num(x?.liquidityUsd, 0);
const volume24h = num(x?.volume24h, 0);
return { token, chain, score, liquidityUsd, volume24h };
}

function isUsable(r) {
if (!r) return false;
if (r.token === 'UNK') return false;
if (r.chain === 'N/A') return false;
return true;
}

function uniqByTokenChain(rows) {
const seen = new Set();
const out = [];
for (const r of rows) {
const k = `${r.token}|${r.chain}`;
if (seen.has(k)) continue;
seen.add(k);
out.push(r);
}
return out;
}

function fmtUsd(n) {
if (!Number.isFinite(n) || n <= 0) return 'n/a';
if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
return `$${n.toFixed(0)}`;
}

async function handleDexscan(chatId, parts = []) {
const sub = (parts[1] || '').toLowerCase();

if (sub === 'live') {
try {
const raw = await fetchDexscreenerBoosts();

const rows = raw
.map(normalizeRow)
.filter(isUsable);

const dedup = uniqByTokenChain(rows)
.sort((a, b) => b.score - a.score)
.slice(0, 10);

if (!dedup.length) {
await reply(chatId, '🧪 DEX Scan Live\nNo usable boosted tokens found right now.');
return;
}

let txt = '🧪 DEX Scan Live (quality filtered)\n';
for (const r of dedup) {
txt += `\n• ${r.token} (${r.chain}) | score ${r.score} | liq ${fmtUsd(r.liquidityUsd)} | vol24 ${fmtUsd(r.volume24h)}`;
}
txt += '\n\nPaper test:\n• /dexpick <TOKEN> <amount>\nExample: /dexpick WIF 15';
await reply(chatId, txt);
return;
} catch {
await reply(chatId, 'DEX live scan failed right now. Try again in a minute.');
return;
}
}

await reply(
chatId,
`🧪 DEX Scan
Use:
• /dexscan live (quality-filtered live scan)
• /dexpick <TOKEN> <amount> (paper entry helper)`
);
}

module.exports = { handleDexscan };
