const { reply } = require('../telegram');

async function handleStart(chatId) {
await reply(
chatId,
`🌑 PeakSeek v0.2.0 (App-First)

Open control center:
🚀 /open

Use chat mainly for:
• /signal BTC
• /semi off (emergency)
• /help`
);
}
module.exports = { handleStart };
