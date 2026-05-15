const { tg, reply } = require('../telegram');
const { settings, dexPickCache } = require('../state');
const { getCandles } = require('../hyperliquid');
const { computeSignal } = require('../indicators');

const PAGE_SIZE = 6;

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
const pairAddress = p?.pairAddress || null;
const priceUsd = Number(p?.priceUsd);
if (!token || !pairAddress || !Number.isFinite(priceUsd)) return null;

const score = Math.max(1, Math.min(99, Math.round(
Math.min(35, liq / 50000) +
Math.min(35, vol / 100000) +
Math.min(20, Math.abs(chg) / 2) +
10
)));

const riskBadge = liq >= 200000 ? '✅' : liq >= 50000 ? '⚠️' : '⛔';
const baseX = liq >= 200000 ? 1.08 : liq >= 50000 ? 1.15 : 1.25;
const strongX = liq >= 200000 ? 1.18 : liq >= 50000 ? 1.35 : 1.80;
const stretchX = liq >= 200000 ? 1.35 : liq >= 50000 ? 1.9 : 3.5;

// safety: filter major-like weird micro prices
const majorLike = ['BTC', 'ETH', 'BNB', 'SOL', 'DOGE'].includes(token);
if (majorLike && priceUsd < 0.01) return null;

return { token, chain, liq, vol, chg, score, pairAddress, priceUsd, riskBadge, baseX, strongX, stretchX };
}
function dedupByPair(rows) {
const seen = new Set();
const out = [];
for (const r of rows) {
if (seen.has(r.pairAddress)) continue;
seen.add(r.pairAddress);
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

// CMC intake skeleton (non-blocking placeholder for next patch)
async function fetchCmcDexSignalsSkeleton() {
return {
enabled: true,
source: 'CMC',
note: 'connector skeleton active (full parse next patch)',
url: 'https://dex.coinmarketcap.com/token/all/?tableRankBy=trending_5m'
};
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

function buildPage(rows, page, mode) {
const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
const p = Math.max(0, Math.min(page, totalPages - 1));
const start = p * PAGE_SIZE;
const slice = rows.slice(start, start + PAGE_SIZE);

let txt = `🧪 DEX Scan ${mode === 'degen' ? '(DEGEN)' : '(STANDARD)'}\nPage ${p + 1}/${totalPages}\n`;
slice.forEach((r, i) => {
const idx = start + i;
txt += `\n${idx + 1}) ${r.riskBadge} ${r.token} (${r.chain}) | score ${r.score} | liq ${fmtUsd(r.liq)} | 24h ${r.chg.toFixed(1)}%`;
txt += `\n X: Base ${r.baseX.toFixed(2)}x | Strong ${r.strongX.toFixed(2)}x | Stretch ${r.stretchX.toFixed(2)}x`;
});

return { page: p, totalPages, slice, text: txt };
}

async function sendPaged(chatId, rows, mode, page = 0) {
const { page: p, totalPages, slice, text } = buildPage(rows, page, mode);
const buttons = slice.map((r, i) => {
const globalIdx = p * PAGE_SIZE + i;
return [{ text: `${globalIdx + 1}) ${r.token} • ${r.chain}`, callback_data: `dexpairidx_${globalIdx}` }];
});

const nav = [];
if (p > 0) nav.push({ text: '⬅️ Prev', callback_data: `dexpage_${mode}_${p - 1}` });
if (p < totalPages - 1) nav.push({ text: 'Next ➡️', callback_data: `dexpage_${mode}_${p + 1}` });
if (nav.length) buttons.push(nav);

await tg('sendMessage', {
chat_id: String(chatId),
text: text + '\n\nTap a pair button to choose amount.',
reply_markup: JSON.stringify({ inline_keyboard: buttons })
});
}

async function handleDexscan(chatId, parts = []) {
const sub = (parts[1] || 'live').toLowerCase();
const mode = (parts[2] || 'degen').toLowerCase();

if (sub !== 'live') {
await reply(chatId, `🧪 DEX Scan\n• /dexscan live\n• /dexscan live degen`);
return;
}

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

rows = dedupByPair(rows);

if (mode === 'degen') {
rows = rows
.filter(r => r.liq > 1000 && r.liq < 1500000 && Math.abs(r.chg) > 1)
.sort((a, b) => (Math.abs(b.chg) + b.score) - (Math.abs(a.chg) + a.score))
.slice(0, 24);
} else {
rows = rows
.filter(r => r.liq >= 30000)
.sort((a, b) => b.score - a.score)
.slice(0, 24);
}

if (!rows.length) {
await reply(chatId, '🧪 DEX scan found no usable rows right now. Try again shortly.');
return;
}

dexPickCache.set(String(chatId), rows);
await sendPaged(chatId, rows, mode, 0);

const cmc = await fetchCmcDexSignalsSkeleton();
await reply(chatId, `📡 Source status: DexScreener live ✅ | CMC ${cmc.enabled ? 'skeleton ✅' : 'off'} (${cmc.note})`);

const majors = await majorsSummary();
if (majors.length) {
let mtxt = `⚡ HL Majors Snapshot (lev ${settings.leverage.majors}x)`;
for (const m of majors) mtxt += `\n• ${m.symbol}: ${m.side} | conf ${m.conf} | entry ${m.entry.toFixed(2)}`;
mtxt += `\nUse /top hl for HL-only list, /top dex for DEX list.`;
await reply(chatId, mtxt);
}
}

module.exports = { handleDexscan, sendPaged };
