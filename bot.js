const http = require('http');
const fs = require('fs');
const path = require('path');

const { tg, getOffset, setOffset, reply } = require('./src/telegram');
const { settings, portfolio, trial } = require('./src/state');
const { setSemiEnabled, getSemiStatus, startSemiLoop } = require('./src/runner');

const { handleStart } = require('./src/commands/start');
const { handleHelp } = require('./src/commands/help');
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
const { handleSemi } = require('./src/commands/semi');
const { handleBitget } = require('./src/commands/bitget');
const { handleDexscan } = require('./src/commands/dexscan');
const { handleDexpick } = require('./src/commands/dexpick');

function normalizeCommandText(raw = '') {
const idx = raw.indexOf('/');
const clean = idx >= 0 ? raw.slice(idx) : raw;
return clean.trim().replace(/\s+/g, ' ');
}

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

function sendJson(res, code, obj) {
res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
res.end(JSON.stringify(obj));
}

function parseBody(req) {
return new Promise((resolve) => {
let data = '';
req.on('data', c => data += c);
req.on('end', () => {
try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
});
});
}
const server = http.createServer(async (req, res) => {
if (req.url === '/healthz') {
res.writeHead(200, { 'Content-Type': 'text/plain' });
res.end('ok');
return;
}

if (req.method === 'GET' && req.url === '/api/status') {
const semi = getSemiStatus();
return sendJson(res, 200, {
ok: true,
mode: settings.mode,
semiEnabled: semi.enabled,
balance: portfolio.balance,
openPositions: portfolio.positions.length,
trialActive: trial.active,
trialTrades: trial.trades,
trialPnl: Number(trial.totalPnl.toFixed(4))
});
}

if (req.method === 'POST' && req.url === '/api/setup') {
const body = await parseBody(req);
const w = body.wallets || {};
const b = body.budgets || {};

settings.mode = body.mode || settings.mode;
settings.wallets.evm = w.evm || settings.wallets.evm;
settings.wallets.sol = w.sol || settings.wallets.sol;
settings.budgets.ETH = Number(b.ETH || 0);
settings.budgets.BASE = Number(b.BASE || 0);
settings.budgets.BNB = Number(b.BNB || 0);
settings.budgets.ARB = Number(b.ARB || 0);
settings.budgets.SOL = Number(b.SOL || 0);

return sendJson(res, 200, { ok: true });
}

if (req.method === 'POST' && req.url === '/api/semi') {
const body = await parseBody(req);
const enabled = !!body.enabled;
setSemiEnabled(enabled);
settings.mode = enabled ? 'semi' : (settings.mode === 'semi' ? 'manual' : settings.mode);
return sendJson(res, 200, { ok: true, enabled });
}

if (req.method === 'POST' && req.url === '/api/trial') {
const body = await parseBody(req);
const action = (body.action || '').toLowerCase();

if (action === 'start') {
trial.active = true;
trial.startedAt = Date.now();
trial.startBalance = portfolio.balance;
trial.trades = 0;
trial.wins = 0;
trial.losses = 0;
trial.totalPnl = 0;
trial.grossWin = 0;
trial.grossLossAbs = 0;
return sendJson(res, 200, { ok: true, action: 'start' });
}

if (action === 'stop') {
trial.active = false;
return sendJson(res, 200, { ok: true, action: 'stop' });
}

return sendJson(res, 400, { ok: false, error: 'invalid action' });
}

const urlPath = req.url === '/' ? '/index.html' : req.url;
const cleanPath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
const filePath = path.join(WEB_ROOT, cleanPath);

if (!filePath.startsWith(WEB_ROOT)) {
res.writeHead(403); res.end('Forbidden'); return;
}

fs.readFile(filePath, (err, data) => {
if (err) { res.writeHead(404); res.end('Not found'); return; }
const ext = path.extname(filePath).toLowerCase();
res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
res.end(data);
});
});

server.listen(PORT, () => {
console.log(`Mini app server listening on ${PORT}`);
});

startSemiLoop(null, reply);
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
else if (cmd === '/help') await handleHelp(chatId);
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
else if (cmd === '/semi') await handleSemi(chatId, parts);
else if (cmd === '/bitget') await handleBitget(chatId, parts);
else if (cmd === '/dexscan') await handleDexscan(chatId, parts);
else if (cmd === '/dexpick') await handleDexpick(chatId, parts);
else await handleStart(chatId);
}
} catch {}
}
})();
