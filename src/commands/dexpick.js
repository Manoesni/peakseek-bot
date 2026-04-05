const { reply } = require('../telegram');
const { risk } = require('../state');
const { openPaperPosition } = require('./paper');
const { fmtAdaptive } = require('../indicators');
const { getBestPrice } = require('../prices');

function guardLevels(entry, stop, tp1, tp2) {
// minimum absolute distance = 0.5% of entry
const minDist = entry * 0.005;

if (Math.abs(entry - stop) < minDist) stop = entry - minDist;
if (Math.abs(tp1 - entry) < minDist) tp1 = entry + minDist;
if (Math.abs(tp2 - entry) < minDist * 2) tp2 = entry + minDist * 2;

return { stop, tp1, tp2 };
}

async function handleDexpick(chatId, parts) {
if (parts.length !== 3) {
await reply(chatId, 'Usage: /dexpick <TOKEN> <amount>\nExample: /dexpick WIF 15');
return;
}

const token = parts[1].toUpperCase();
const amount = Number(parts[2]);
if (!Number.isFinite(amount) || amount <= 0) {
await reply(chatId, 'Amount must be a positive number.');
return;
}

const px = await getBestPrice(token);
if (!px || !Number.isFinite(px.price)) {
await reply(chatId, `No live price found for ${token}.`);
return;
}

const entry = px.price;
let stop = entry * (1 - risk.dexStopPct / 100);
let tp1 = entry * 1.20;
let tp2 = entry * 1.40;
const trailingArm = entry * 1.10;

({ stop, tp1, tp2 } = guardLevels(entry, stop, tp1, tp2));

const ok = await openPaperPosition(chatId, 'long', token, 3, amount, {
stop, tp1, tp2, trailingArm
});
if (!ok) return;

await reply(
chatId,
`🧪 DEX paper pick opened
Token: ${token}
Entry: $${fmtAdaptive(entry)}
Plan:
• SL: $${fmtAdaptive(stop)}
• TP1: $${fmtAdaptive(tp1)}
• TP2: $${fmtAdaptive(tp2)}
• Trailing arm: $${fmtAdaptive(trailingArm)}`
);
}

module.exports = { handleDexpick };
