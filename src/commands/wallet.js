const { reply } = require('../telegram');
const { settings } = require('../state');

function isLikelyEvm(addr) {
return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
function isLikelySol(addr) {
return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

async function handleWallet(chatId, parts) {
// /wallet
// /wallet evm 0x...
// /wallet sol <address>
if (parts.length === 1) {
await reply(
chatId,
`👛 Wallets
EVM: ${settings.wallets.evm || 'not set'}
SOL: ${settings.wallets.sol || 'not set'}

Set with:
• /wallet evm 0x...
• /wallet sol <address>

⚠️ Keep gas reserve on each chain.`
);
return;
}

if (parts.length !== 3) {
await reply(chatId, 'Usage:\n/wallet\n/wallet evm 0x...\n/wallet sol <address>');
return;
}

const kind = (parts[1] || '').toLowerCase();
const addr = parts[2];

if (kind === 'evm') {
if (!isLikelyEvm(addr)) {
await reply(chatId, 'Invalid EVM address format.');
return;
}
settings.wallets.evm = addr;
await reply(chatId, '✅ EVM wallet saved.');
return;
}

if (kind === 'sol') {
if (!isLikelySol(addr)) {
await reply(chatId, 'Invalid Solana address format.');
return;
}
settings.wallets.sol = addr;
await reply(chatId, '✅ Solana wallet saved.');
return;
}

await reply(chatId, 'Unknown wallet type. Use evm or sol.');
}

module.exports = { handleWallet };
