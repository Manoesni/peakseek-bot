const { reply } = require('../telegram');

async function handleStart(chatId) {
await reply(chatId, 'PeakSeek online ✅\nUse buttons or /signal BTC');
}

module.exports = { handleStart };
