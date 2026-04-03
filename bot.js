const http = require('http');
const fs = require('fs');
const path = require('path');

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
const { handleTrial } = require('./src/commands/trial');
const { handleOpen } = require('./src/commands/open');

function normalizeCommandText(raw = '') {
const idx = raw.indexOf('/');
const clean = idx >= 0 ? raw.slice(idx) : raw;
return clean.trim().replace(/\s+/g, ' ');
}

// ---- static mini app server ----
const PORT = process.env.PORT || 3000;
const WEB_ROOT = path.join(__dirname, 'web');

const mime = {
'.html': 'text/html; charset=utf-8',
'.css': 'text/css; charset=utf-8',
'.js': 'application/javascript; charset=utf-8',
'.json': 'application/json; charset=utf-8',
'.png': 'image/png',
'.jpg': 'image/jpeg',
'.jpeg': 'image/jpeg',
'.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
const urlPath = req.url === '/' ? '/index.html' : req.url;
const cleanPath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
const filePath = path.join(WEB_ROOT, cleanPath);

if (!filePath.startsWith(WEB_ROOT)) {
res.writeHead(403); res.end('Forbidden'); return;
}

fs.readFile(filePath, (err, data) => {
if (err) {
if (req.url === '/healthz') {
res.writeHead(200, { 'Content-Type': 'text/plain' });
res.end('ok');
return;
}
res.writeHead(404); res.end('Not found'); return;
}
const ext = path.extname(filePath).toLowerCase();
res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
res.end(data);
});
});

server.listen(PORT, () => {
console.log(`Mini app server listening on ${PORT}`);
});

// ---- telegram loop ----
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
const normalized = normalizeCommandText(msg.text);
const parts = normalized.split(/\s+/);
const cmd = (parts[0] || '').toLowerCase();

if (cmd === '/start') await handleStart(chatId);
else if (cmd === '/open') await handleOpen(chatId);
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
else if (cmd === '/trial') await handleTrial(chatId, parts);
else await handleStart(chatId);
}
} catch {}
}
})();
