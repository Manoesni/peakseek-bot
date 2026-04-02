const { answerCallback, reply } = require('../telegram');
const { openPaperPosition } = require('./paper');

async function handleCallback(cb) {
const data = cb.data || '';
const chatId = cb.message?.chat?.id;
if (!chatId) return;

// accepts:
// paper_long_BTC_10
// paper_short_ETH_5
// paper_skip_SOL_0
const parts = data.split('_');
if (parts.length !== 4 || parts[0] !== 'paper') {
await answerCallback(cb.id, 'Unknown action');
return;
}

const action = parts[1]; // long | short | skip
const symbol = (parts[2] || '').toUpperCase();
const amount = Number(parts[3]);

if (!['long', 'short', 'skip'].includes(action) || !symbol) {
await answerCallback(cb.id, 'Unknown action');
return;
}

if (action === 'skip') {
await answerCallback(cb.id, 'Skipped');
await reply(chatId, `⏭ Skipped ${symbol}`);
return;
}

if (!Number.isFinite(amount) || amount <= 0) {
await answerCallback(cb.id, 'Bad amount');
return;
}

await answerCallback(cb.id, `${action.toUpperCase()} ${symbol} $${amount}`);
await openPaperPosition(chatId, action, symbol, 5, amount);
}

module.exports = { handleCallback };