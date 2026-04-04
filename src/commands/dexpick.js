const { reply } = require('../telegram');
const { risk } = require('../state');
const { openPaperPosition } = require('./paper');
const { fmt } = require('../indicators');

async function handleDexpick(chatId, parts) {
// /dexpick WIF 15
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

// DEX paper plan defaults
// Since no direct per-token DEX price feed is wired yet, paper entry still uses current engine symbol availability.
// For unsupported tokens, user gets graceful message from openPaperPosition.
const syntheticEntry = 1; // only for plan math
const stop = syntheticEntry * (1 - risk.dexStopPct / 100);
const tp1 = syntheticEntry * (1 + risk.dexTpPct / 100);

const ok = await openPaperPosition(chatId, 'long', token, 3, amount, { stop, tp1 });
if (!ok) return;

await reply(
chatId,
`🧪 DEX paper pick opened
Token: ${token}
Amount: $${fmt(amount)}
Plan: TP +${risk.dexTpPct}% | SL -${risk.dexStopPct}%

When real DEX price adapter is added, TP/SL will be market-accurate per token.`
);
}

module.exports = { handleDexpick };
