const { tg, reply } = require('../telegram');
const { settings } = require('../state');
const { getCandles } = require('../hyperliquid');
const { computeSignal } = require('../indicators');

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
const token = cleanSymbol(p?.baseToken?.symbol || p?.base?.symbol || p?.symbol);
const chain = String(p?.chainId || p?.chain || 'n/a').toUpperCase();
const liq = num(p?.liquidity?.usd || p?.liquidityUsd, 0);
const vol = num(p?.volume?.h24 || p?.volume24h, 0);
const chg = num(p?.priceChange?.h24 || p?.priceChange24h, 0);
if (!token) return null;

const score = Math.max(1, Math.min(99, Math.round(
Math.min(35, liq / 50000) +
Math.min(35, vol / 100000) +
Math.min(20, Math.abs(chg) / 2) +
10
)));
return { token, chain, liq, vol, chg, score };
}
function dedupTokenChain(rows) {
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
if (!n) return 'n/a';
if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
return `$${n.toFixed(0)}`;
}
async function fetchSearch(q) {
const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(q)}`);
if (!r.ok) return [];
const j = await r.json();
const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
return pairs.map(normPair).filter(Boolean);
}

async function majorsSummary() {
const out = [];
for (const s of settings.majors) {
try {
const candles = await getCandles(s);
const closes = (candles || []).map(c => Number(c.c));
const sig = computeSignal(closes);
if (!sig) continue;
out.push({ symbol: s, side: sig.side, conf: Math.round(sig.confidence), entry: Number(sig.entry) });
} catch {}
}
return out;
}

async function handleDexscan(chatId, parts = []) {
const sub = (parts[1] || '').toLowerCase();
const mode = (parts[2] || '').toLowerCase();

if (sub === 'live') {
let rows = [
...(await fetchSearch('SOL')),
...(await fetchSearch('BASE')),
...(await fetchSearch('ETH')),
...(await fetchSearch('BNB')),
...(await fetchSearch('ARB')),
...(await fetchSearch('DOGE')),
...(await fetchSearch('PEPE')),
...(await fetchSearch('WIF')),
...(await fetchSearch('BONK')),
...(await fetchSearch('FLOKI'))
];

rows = dedupTokenChain(rows);

if (mode === 'degen') {
rows = rows
.filter(r => r.liq > 1000 && r.liq < 1500000 && Math.abs(r.chg) > 1)
.sort((a, b) => (Math.abs(b.chg) + b.score) - (Math.abs(a.chg) + a.score))
.slice(0, 12);
} else {
rows = rows
.filter(r => r.liq >= 30000)
.sort((a, b) => b.score - a.score)
.slice(0, 12);
}

if (!rows.length) {
await reply(chatId, '🧪 DEX scan found no usable rows right now. Try again shortly.');
return;
}

let txt = `🧪 DEX Scan Live ${mode === 'degen' ? '(DEGEN)' : '(STANDARD)'}\n`;
rows.forEach((r, i) => {
txt += `\n${i + 1}) ${r.token} (${r.chain}) | score ${r.score} | liq ${fmtUsd(r.liq)} | 24h ${r.chg.toFixed(1)}%`;
});

const majors = await majorsSummary();
if (majors.length) {
txt += `\n\n⚡ Majors Futures (lev ${settings.leverage.majors}x)`;
for (const m of majors) {
txt += `\n• ${m.symbol}: ${m.side} | conf ${m.conf} | entry ${m.entry.toFixed(2)}`;
}
txt += `\nUse /signal BTC or /signal ETH for action cards.`;
}

txt += '\n\nTap a pair button to choose amount.';
const buttons = rows.slice(0, 8).map((r, i) => ([
{ text: `${i + 1}) ${r.token} • ${r.chain}`, callback_data: `dexpair_${r.token}_${r.chain}` }
]));

await tg('sendMessage', {
chat_id: String(chatId),
text: txt,
reply_markup: JSON.stringify({ inline_keyboard: buttons })
});
return;
}

await reply(chatId, `🧪 DEX Scan\n• /dexscan live\n• /dexscan live degen\n• /lev`);
}

module.exports = { handleDexscan };
