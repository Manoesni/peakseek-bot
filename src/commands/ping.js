const { reply } = require('../telegram');

async function handlePing(chatId) {
await reply(chatId, 'pong 🏓');
}

module.exports = { handlePing };
