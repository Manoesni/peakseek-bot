const { reply } = require('../telegram');
const { settings } = require('../state');

const ALLOWED = [2, 3, 5, 10];

async function handleLev(chatId, parts) {
// /lev
// /lev majors 5
// /lev dex 3
if (parts.length === 1) {
await reply(
chatId,
`⚖️ Leverage
Majors: ${settings.leverage.majors}x
DEX: ${settings.leverage.dex}x

Set:
• /lev majors 2|3|5|10
• /lev dex 2|3|5|10`
);
return;
}

if (parts.length !== 3) {
await reply(chatId, 'Usage: /lev <majors|dex> <2|3|5|10>');
return;
}

const kind = (parts[1] || '').toLowerCase();
const lev = Number(parts[2]);

if (!['majors', 'dex'].includes(kind)) {
await reply(chatId, 'Kind must be majors or dex.');
return;
}
if (!ALLOWED.includes(lev)) {
await reply(chatId, 'Leverage must be one of: 2, 3, 5, 10');
return;
}

settings.leverage[kind] = lev;
await reply(chatId, `✅ ${kind.toUpperCase()} leverage set to ${lev}x`);
}

module.exports = { handleLev };
