const { reply } = require('../telegram');
const { settings } = require('../state');
const { setSemiEnabled, getSemiStatus } = require('../runner');

async function handleSemi(chatId, parts) {
// /semi
// /semi on
// /semi off
// /semi status
const sub = (parts[1] || 'status').toLowerCase();

if (sub === 'on') {
settings.mode = 'semi';
setSemiEnabled(true);
await reply(chatId, '🤖 Semi-auto ENABLED (paper mode).');
return;
}

if (sub === 'off') {
setSemiEnabled(false);
if (settings.mode === 'semi') settings.mode = 'manual';
await reply(chatId, '🛑 Semi-auto DISABLED.');
return;
}

const s = getSemiStatus();
await reply(
chatId,
`🤖 Semi-auto status
Enabled: ${s.enabled ? 'YES' : 'NO'}
Mode: ${settings.mode.toUpperCase()}
Symbols: ${s.symbols.join(', ')}
Check interval: ${Math.round(s.intervalMs / 1000)}s
Max auto margin/trade: $${s.maxAutoMarginPerTrade}`
);
}

module.exports = { handleSemi };
