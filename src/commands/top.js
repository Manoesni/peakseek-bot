const { reply } = require('../telegram');
const { getCandles } = require('../hyperliquid');
const { computeSignal, fmt } = require('../indicators');
const { handleDexscan } = require('./dexscan');

const HL_DEFAULT = ['BTC', 'ETH', 'SOL'];

async function scanHL(symbol) {
try {
const candles = await getCandles(symbol);
const closes = (candles || []).map(c => Number(c.c));
const sig = computeSignal(closes);
if (!sig) return null;
return { symbol, ...sig };
} catch {
return null;
}
}

async function handleTop(chatId, parts) {
// /top
// /top hl
// /top dex
const sub = (parts[1] || 'hl').toLowerCase();

if (sub === 'dex') {
// delegate to dex scanner
return handleDexscan(chatId, ['/dexscan', 'live', 'degen']);
}

if (sub !== 'hl') {
await reply(chatId, 'Usage: /top [hl|dex]');
return;
}

const rows = [];
for (const s of HL_DEFAULT) {
const r = await scanHL(s);
if (r) rows.push(r);
}

if (!rows.length) {
await reply(chatId, '⚡ HL scan: no data right now.');
return;
}

let txt = '⚡ HL Majors Scan\n';
for (const r of rows) {
txt += `\n• ${r.symbol}: ${r.side} | conf ${fmt(r.confidence, 0)} | entry $${fmt(r.entry)} | stop $${fmt(r.stop)} | tp1 $${fmt(r.tp1)}`;
}
txt += '\n\nUse /signal BTC|ETH|SOL for verdict cards.';
await reply(chatId, txt);
}

module.exports = { handleTop };
