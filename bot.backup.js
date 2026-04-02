const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const token = (env.match(/TELEGRAM_BOT_TOKEN=(.*)/) || [])[1]?.trim();
if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');

const TG = `https://api.telegram.org/bot${token}`;
let offset = 0;

// In-memory state (later -> SQLite)
const risk = {
tier: 'safe',
riskPct: 0.5,
dailyMaxLossPct: 2.0,
maxOpen: 2
};

const portfolio = {
balance: 1000,
positions: [] // { id, symbol, side, lev, margin, entry }
};

let nextPosId = 1;

const RISK_PRESETS = {
safe: { riskPct: 0.5, dailyMaxLossPct: 2.0, maxOpen: 2 },
balanced: { riskPct: 1.0, dailyMaxLossPct: 4.0, maxOpen: 4 },
aggressive: { riskPct: 2.0, dailyMaxLossPct: 7.0, maxOpen: 6 }
};

function replyKeyboard() {
return JSON.stringify({
keyboard: [
[{ text: '/signal BTC' }, { text: '/signal ETH' }, { text: '/signal SOL' }],
[{ text: '/risk' }, { text: '/portfolio' }],
[{ text: '/paper long BTC 5 10' }, { text: '/paper close BTC' }],
[{ text: '/start' }, { text: '/ping' }]
],
resize_keyboard: true
});
}

function signalInlineKeyboard(symbol) {
return JSON.stringify({
inline_keyboard: [
[
{ text: '🟢 Paper Long', callback_data: `paper_long_${symbol}` },
{ text: '🔴 Paper Short', callback_data: `paper_short_${symbol}` }
],
[
{ text: '⏭ Skip', callback_data: `paper_skip_${symbol}` }
]
]
});
}

async function tg(method, params = {}) {
const body = new URLSearchParams(params);
const r = await fetch(`${TG}/${method}`, { method: 'POST', body });
return r.json();
}

async function reply(chatId, text) {
return tg('sendMessage', {
chat_id: String(chatId),
text,
reply_markup: replyKeyboard()
});
}

async function replySignalCard(chatId, text, symbol) {
return tg('sendMessage', {
chat_id: String(chatId),
text,
reply_markup: signalInlineKeyboard(symbol)
});
}

async function answerCallback(id, text = '') {
return tg('answerCallbackQuery', {
callback_query_id: id,
text
});
}

async function hlInfo(payload) {
const r = await fetch('https://api.hyperliquid.xyz/info', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});
return r.json();
}

async function getMids() {
return hlInfo({ type: 'allMids' });
}

async function getCandles(symbol, interval = '15m', n = 120) {
const end = Date.now();
const start = end - n * 15 * 60 * 1000;
return hlInfo({
type: 'candleSnapshot',
req: { coin: symbol, interval, startTime: start, endTime: end }
});
}

function sma(arr, len) {
if (arr.length < len) return null;
const x = arr.slice(-len);
return x.reduce((a, b) => a + b, 0) / x.length;
}

function fmt(n, d = 2) {
return Number(n).toFixed(d);
}

function computeSignal(closes) {
if (!closes || closes.length < 60) return null;
const c = closes[closes.length - 1];
const s20 = sma(closes, 20);
const s50 = sma(closes, 50);
if (!s20 || !s50) return null;

let side = 'NEUTRAL';
if (c > s20 && s20 > s50) side = 'LONG';
if (c < s20 && s20 < s50) side = 'SHORT';

const stopPct = 1.2;
const tpPct = 2.2;
const stop = side === 'LONG' ? c * (1 - stopPct / 100) : side === 'SHORT' ? c * (1 + stopPct / 100) : null;
const tp1 = side === 'LONG' ? c * (1 + tpPct / 100) : side === 'SHORT' ? c * (1 - tpPct / 100) : null;

const trendGap = Math.abs((s20 - s50) / s50) * 100;
const confidence = Math.max(40, Math.min(90, 52 + trendGap * 1200));

return { side, entry: c, stop, tp1, confidence, s20, s50 };
}

function sizingFromRisk(balanceUsd, riskPct, stopPct = 1.2, lev = 5) {
const riskUsd = balanceUsd * (riskPct / 100);
const notional = riskUsd / (stopPct / 100);
const margin = notional / lev;
return { riskUsd, notional, margin };
}

async function openPaperPosition(chatId, side, symbol, lev, margin) {
if (portfolio.positions.length >= risk.maxOpen) {


await reply(chatId, `Risk block: max open positions is ${risk.maxOpen}`);
return;
}
if (margin > portfolio.balance) {


await reply(chatId, `Not enough balance. Available: $${fmt(portfolio.balance)}`);
return;
}

const mids = await getMids();
const entry = Number(mids?.[symbol]);
if (!Number.isFinite(entry)) {
await reply(chatId, `No Hyperliquid price for ${symbol}`);
return;
}

portfolio.balance -= margin;
portfolio.positions.push({
id: nextPosId++,
symbol,
side,
lev,
margin,
entry
});

await reply(chatId, `✅ PAPER ${side.toUpperCase()} ${symbol}\nLev: ${lev}x Margin: $${fmt(margin)} Entry: $${fmt(entry)}`);
}

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

async function handleSignal(chatId, parts) {
if (parts.length !== 2) {
await reply(chatId, 'Usage: /signal <TOKEN>\nExample: /signal BTC');
return;
}

const symbol = parts[1].toUpperCase();
const candles = await getCandles(symbol);
const closes = (candles || []).map(c => Number(c.c));
const sig = computeSignal(closes);

if (!sig) {
await reply(chatId, `No market data for ${symbol} right now.`);
return;
}

const sz = sizingFromRisk(portfolio.balance, risk.riskPct, 1.2, 5);

if (sig.side === 'NEUTRAL') {
await reply(
chatId,
`📍 ${symbol} Snapshot (NEUTRAL)
Price: $${fmt(sig.entry)}
SMA20: $${fmt(sig.s20)}
SMA50: $${fmt(sig.s50)}
Confidence: ${fmt(sig.confidence, 0)}/100

No trade trigger yet.`
);
return;
}

await replySignalCard(
chatId,
`📌 ${symbol} Signal
Side: ${sig.side}
Entry: $${fmt(sig.entry)}
Stop: $${fmt(sig.stop)}
TP1: $${fmt(sig.tp1)}
Confidence: ${fmt(sig.confidence, 0)}/100

Sizing (${risk.riskPct}% risk, bal $${fmt(portfolio.balance)}):
Risk $: ${fmt(sz.riskUsd)}
Notional: ${fmt(sz.notional)}
Margin@5x: ${fmt(sz.margin)}`,
symbol
);
}

async function handlePortfolio(chatId) {
if (!portfolio.positions.length) {
await reply(chatId, `📂 Portfolio\nBalance: $${fmt(portfolio.balance)}\nNo open positions.`);
return;
}

let txt = `📂 Portfolio\nBalance: $${fmt(portfolio.balance)}\nOpen: ${portfolio.positions.length}`;
for (const p of portfolio.positions) {
txt += `\n• #${p.id} ${p.symbol} ${p.side} lev=${p.lev} margin=$${fmt(p.margin)} entry=$${fmt(p.entry)}`;
}
await reply(chatId, txt);
}

async function handlePaper(chatId, parts) {
if (parts.length < 3) {
await reply(chatId, 'Usage:\n/paper long BTC 5 10\n/paper short ETH 3 20\n/paper close BTC');
return;
}

const action = (parts[1] || '').toLowerCase();

if (action === 'close') {
const symbol = (parts[2] || '').toUpperCase();
const idx = portfolio.positions.findIndex(p => p.symbol === symbol);
if (idx === -1) {
await reply(chatId, `No open paper position for ${symbol}`);
return;
}

const pos = portfolio.positions[idx];
const mids = await getMids();
const now = Number(mids?.[symbol]);

let pnl = 0;
if (Number.isFinite(now)) {
const move = (now - pos.entry) / pos.entry;
const signed = pos.side === 'long' ? move : -move;
pnl = pos.margin * pos.lev * signed;
}

portfolio.balance += pos.margin + pnl;
portfolio.positions.splice(idx, 1);

await reply(chatId, `✅ Closed ${symbol}\nPnL: $${fmt(pnl)}\nBalance: $${fmt(portfolio.balance)}`);
return;
}

if (parts.length !== 5) {
await reply(chatId, 'Usage: /paper <long|short> <SYMBOL> <LEV> <MARGIN_USD>');
return;
}

const side = action;
const symbol = parts[2].toUpperCase();
const lev = Number(parts[3]);
const margin = Number(parts[4]);

if (!['long', 'short'].includes(side)) {
await reply(chatId, 'Side must be long or short.');
return;
}


if (!Number.isFinite(lev) || !Number.isFinite(margin) || lev <= 0 || margin <= 0) {


await reply(chatId, 'LEV and MARGIN must be positive numbers.');
return;
}

await openPaperPosition(chatId, side, symbol, lev, margin);
}

async function handleCallback(cb) {
const data = cb.data || '';
const chatId = cb.message?.chat?.id;
if (!chatId) return;

// pattern: paper_long_BTC / paper_short_ETH / paper_skip_SOL
const m = data.match(/^paper_(long|short|skip)_([A-Z0-9]+)$/);
if (!m) {
await answerCallback(cb.id, 'Unknown action');
return;
}

const action = m[1];
const symbol = m[2];

if (action === 'skip') {
await answerCallback(cb.id, 'Skipped');
await reply(chatId, `⏭ Skipped ${symbol}`);
return;
}

// default quick execution params for inline v1
const side = action;
const lev = 5;
const margin = 10;

await answerCallback(cb.id, `Executing ${side.toUpperCase()} ${symbol}`);
await openPaperPosition(chatId, side, symbol, lev, margin);
}

(async () => {
await tg('deleteWebhook', { drop_pending_updates: 'true' });
console.log('PeakSeek is running...');

while (true) {
try {
const u = await tg('getUpdates', { timeout: '30', offset: String(offset) });
if (!u.ok) continue;

for (const it of u.result) {
offset = it.update_id + 1;

// 1) callback query path (inline button clicks)
if (it.callback_query) {
await handleCallback(it.callback_query);
continue;
}

// 2) regular message path
const msg = it.message;
if (!msg || !msg.text) continue;

const chatId = msg.chat.id;
const parts = msg.text.trim().split(/\s+/);
const cmd = (parts[0] || '').toLowerCase();

if (cmd === '/start') {
await reply(chatId, 'PeakSeek online ✅\nUse buttons or /signal BTC');
} else if (cmd === '/ping') {
await reply(chatId, 'pong 🏓');
} else if (cmd === '/signal') {
await handleSignal(chatId, parts);
} else if (cmd === '/risk') {
await handleRisk(chatId, parts);
} else if (cmd === '/portfolio') {
await handlePortfolio(chatId);
} else if (cmd === '/paper') {
await handlePaper(chatId, parts);
} else {
await reply(chatId, 'Try /start, /signal BTC, /risk, /portfolio');
}
}
} catch {}
}
})();
