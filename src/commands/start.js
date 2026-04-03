const { reply } = require('../telegram');
const { settings } = require('../state');

async function handleStart(chatId) {
await reply(
chatId,
`🌑 PeakSeek (Dark Pro)
Mode: ${settings.mode.toUpperCase()}

Start workflow:
1) /wallet
2) /chains
3) /risk
4) /top dex or /signal BTC

Manual / Semi / Full automation controls are now active.`
);
}

module.exports = { handleStart };
