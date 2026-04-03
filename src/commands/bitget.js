const { reply } = require('../telegram');

async function handleBitget(chatId) {
await reply(
chatId,
`🆕 Bitget Listings (skeleton)
Planned fields:
• token
• listing time (UTC)
• market type (spot/futures)
• watch window (T-60 to T+30)

Next: live source integration + alert rules.`
);
}

module.exports = { handleBitget };
