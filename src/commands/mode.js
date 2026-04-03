const { reply } = require('../telegram');
const { settings } = require('../state');

async function handleMode(chatId, parts) {
// /mode
// /mode manual
// /mode semi
// /mode full CONFIRM
if (parts.length === 1) {
await reply(
chatId,
`⚙️ Mode: ${settings.mode.toUpperCase()}

Set with:
• /mode manual
• /mode semi
• /mode full CONFIRM

Full mode is restricted and should be used with strict risk caps.`
);
return;
}

const m = (parts[1] || '').toLowerCase();
if (!['manual', 'semi', 'full'].includes(m)) {
await reply(chatId, 'Usage: /mode manual|semi|full [CONFIRM]');
return;
}

if (m === 'full') {
const ok = (parts[2] || '').toUpperCase() === 'CONFIRM';
if (!ok) {
await reply(chatId, 'To enable FULL mode, run: /mode full CONFIRM');
return;
}
}

settings.mode = m;
await reply(chatId, `✅ Mode set to ${m.toUpperCase()}`);
}

module.exports = { handleMode };
