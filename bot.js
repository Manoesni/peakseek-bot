const { tg, getOffset, setOffset } = require('./src/telegram');
const { handleStart } = require('./src/commands/start');
const { handlePing } = require('./src/commands/ping');
const { handleRisk } = require('./src/commands/risk');
const { handleSignal } = require('./src/commands/signal');
const { handleTop } = require('./src/commands/top');
const { handlePortfolio } = require('./src/commands/portfolio');
const { handlePaper } = require('./src/commands/paper');
const { handleCallback } = require('./src/commands/callback');
const { handleHistory } = require('./src/commands/history');
const { handleWallet } = require('./src/commands/wallet');
const { handleMode } = require('./src/commands/mode');
const { handleChains } = require('./src/commands/chains');

(async () => {
await tg('deleteWebhook', { drop_pending_updates: 'true' });
console.log('PeakSeek modular bot running...');

while (true) {
try {
const u = await tg('getUpdates', { timeout: '30', offset: String(getOffset()) });
if (!u.ok) continue;

for (const it of u.result) {
setOffset(it.update_id + 1);

if (it.callback_query) {
await handleCallback(it.callback_query);
continue;
}

const msg = it.message;
if (!msg || !msg.text) continue;

const chatId = msg.chat.id;
const parts = msg.text.trim().split(/\s+/);
const cmd = (parts[0] || '').toLowerCase();

if (cmd === '/start') await handleStart(chatId);
else if (cmd === '/ping') await handlePing(chatId);
else if (cmd === '/risk') await handleRisk(chatId, parts);
else if (cmd === '/signal') await handleSignal(chatId, parts);
else if (cmd === '/top') await handleTop(chatId, parts);
else if (cmd === '/portfolio') await handlePortfolio(chatId);
else if (cmd === '/paper') await handlePaper(chatId, parts);
else if (cmd === '/history') await handleHistory(chatId);
else if (cmd === '/wallet') await handleWallet(chatId, parts);
else if (cmd === '/mode') await handleMode(chatId, parts);
else if (cmd === '/chains') await handleChains(chatId, parts);
else await handleStart(chatId);
}
} catch {}
}
})();
