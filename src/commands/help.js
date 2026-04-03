const { reply } = require('../telegram');

async function handleHelp(chatId) {
await reply(
chatId,
`🧭 PeakSeek (App-First)

Primary workflow:
1) /open → open Mini App control center
2) Configure wallets, mode, budgets
3) Use trial + semi-auto controls in app

Chat fallback:
• /signal BTC
• /semi off (emergency)
• /help`
);
}

module.exports = { handleHelp };
