const { reply } = require('../telegram');
const { setSemiEnabled, getSemiStatus, startSemiLoop } = require('../runner');
async function handleAuto(chatId, parts) {
const arg = (parts[1] || '').toLowerCase();

if (arg === 'on') {
setSemiEnabled(true);
startSemiLoop(chatId);
await reply(chatId, '🤖 Auto mode ENABLED (paper mode).');
return;
}

if (arg === 'off') {
setSemiEnabled(false);
await reply(chatId, '⏸ Auto mode DISABLED.');
return;
}

const s = getSemiStatus();
await reply(
chatId,
`🤖 Auto Status
Enabled: ${s.enabled ? 'YES' : 'NO'}
Interval: ${Math.round((s.intervalMs || 0) / 1000)}s

Commands:
• /auto on
• /auto off`
);
}

module.exports = { handleAuto };
