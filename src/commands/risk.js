const { reply } = require('../telegram');
const { risk, RISK_PRESETS } = require('../state');

async function handleRisk(chatId, parts) {
if (parts.length === 1) {
await reply(
chatId,
`🛡 Risk Profile
Tier: ${risk.tier.toUpperCase()}
Risk/trade: ${risk.riskPct}%
Daily max loss: ${risk.dailyMaxLossPct}%
Max open positions: ${risk.maxOpen}

Change with:
/risk safe
/risk balanced
/risk aggressive`
);
return;
}

const tier = (parts[1] || '').toLowerCase();
if (!RISK_PRESETS[tier]) {
await reply(chatId, 'Usage: /risk safe|balanced|aggressive');
return;
}

Object.assign(risk, { tier }, RISK_PRESETS[tier]);
await reply(chatId, `✅ Risk tier set to ${tier.toUpperCase()}`);
}

module.exports = { handleRisk };
