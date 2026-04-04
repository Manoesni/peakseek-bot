const { reply } = require('../telegram');

async function handleBitget(chatId, parts = []) {
const sub = (parts[1] || '').toLowerCase();

if (sub === 'live') {
await reply(
chatId,
`🆕 Bitget Live (v0.2.3 placeholder)
Pipeline ready, source connector next:
• listing time
• token
• market type
• watch window

Next patch: wire real Bitget announcements feed parser.`
);
return;
}

await reply(
chatId,
`🆕 Bitget Listings
Use:
• /bitget live

Goal:
catch listing spikes with controlled entry/exit rules.`
);
}

module.exports = { handleBitget };
