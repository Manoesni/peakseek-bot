const { reply } = require('../telegram');
const { settings } = require('../state');
const { setSemiEnabled, getSemiStatus } = require('../runner');

async function handleSemi(chatId, parts) {
// Supports both /semi and /auto routes via bot.js
const sub = (parts[1] || 'status').toLowerCase();

if (sub === 'on') {
settings.mode = 'semi';
setSemiEnabled(true);
await reply(chatId, '🤖 Auto mode ENABLED (paper mode).');
return;
}

if (sub === 'off') {
setSemiEnabled(false);
if (settings.mode === 'semi') settings.mode = 'manual';
await reply(chatId, '⏸ Auto mode DISABLED.');
return;
}

const s = getSemiStatus();
await reply(
chatId,
`🤖 Auto mode status
Enabled: ${s.enabled ? 'YES' : 'NO'}
Mode: ${settings.mode.toUpperCase()}
Symbols: ${s.symbols.join(', ')}
Check interval: ${Math.round(s.intervalMs / 1000)}s
Max auto margin/trade: $${s.maxAutoMarginPerTrade}

Commands:
• /auto on
• /auto off
• /auto status`
);
}

module.exports = { handleSemi };
