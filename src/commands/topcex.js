const { reply } = require('../telegram');

async function handleTopCex(chatId) {
await reply(
chatId,
`🆕 CEX Listings (preview)
This section will track:
• exchange listing times
• token ticker + venue
• pre-listing watch windows

Coming in v0.1.5 with live sources.`
);
}

module.exports = { handleTopCex };
