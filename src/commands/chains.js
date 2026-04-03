const { reply } = require('../telegram');
const { settings } = require('../state');

const CHAINS = ['ETH', 'BASE', 'BNB', 'ARB', 'SOL'];

async function handleChains(chatId, parts) {
// /chains
// /chains ETH 20
if (parts.length === 1) {
const b = settings.budgets;
await reply(
chatId,
`🧱 Chain Budgets
ETH: $${b.ETH}
BASE: $${b.BASE}
BNB: $${b.BNB}
ARB: $${b.ARB}
SOL: $${b.SOL}

Set with:
• /chains ETH 20
• /chains SOL 10`
);
return;
}

if (parts.length !== 3) {
await reply(chatId, 'Usage:\n/chains\n/chains <ETH|BASE|BNB|ARB|SOL> <amount>');
return;
}

const chain = (parts[1] || '').toUpperCase();
const amount = Number(parts[2]);

if (!CHAINS.includes(chain)) {
await reply(chatId, 'Unknown chain. Use ETH, BASE, BNB, ARB, SOL.');
return;
}
if (!Number.isFinite(amount) || amount < 0) {
await reply(chatId, 'Amount must be a number >= 0.');
return;
}

settings.budgets[chain] = amount;
await reply(chatId, `✅ Budget updated: ${chain} = $${amount}`);
}

module.exports = { handleChains };
