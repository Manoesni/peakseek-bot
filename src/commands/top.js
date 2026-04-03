const { reply } = require('../telegram');
const { getCandles } = require('../hyperliquid');
const { computeSignal, fmt } = require('../indicators');

const DEFAULT_SCAN = ['BTC', 'ETH', 'SOL', 'ARB', 'BNB', 'DOGE', 'XRP', 'ADA'];

async function scanOne(symbol) {
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

async function handleTop(chatId) {
const results = [];

for (const s of DEFAULT_SCAN) {
const r = await scanOne(s);
if (r && r.side !== 'NEUTRAL') results.push(r);
}

if (!results.length) {
await reply(chatId, '📊 /top: No strong LONG/SHORT setups right now.');
return;
}

results.sort((a, b) => b.confidence - a.confidence);
const top = results.slice(0, 5);

let txt = '🔥 Top Signals (v0.1.3)\n';
for (const r of top) {
txt += `\n• ${r.symbol} ${r.side} | conf ${fmt(r.confidence, 0)} | entry $${fmt(r.entry)} | stop $${fmt(r.stop)} | tp1 $${fmt(r.tp1)}`;
}

await reply(chatId, txt);
}

module.exports = { handleTop };
