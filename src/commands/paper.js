const { reply } = require('../telegram');
const { getMids } = require('../hyperliquid');
const { portfolio, risk, trial, getNextPosId } = require('../state');
const { fmt } = require('../indicators');

async function openPaperPosition(chatId, side, symbol, lev, margin, plan = null) {
const existing = portfolio.positions.find(p => p.symbol === symbol);
if (existing) {
await reply(chatId, `⚠️ ${symbol} already open (#${existing.id}, ${existing.side.toUpperCase()}).\nClose first: /paper close ${symbol}`);
return false;
}

if (portfolio.positions.length >= risk.maxOpen) {
await reply(chatId, `Risk block: max open positions is ${risk.maxOpen}`);
return false;
}

if (margin > portfolio.balance) {
await reply(chatId, `Not enough balance. Available: $${fmt(portfolio.balance)}`);
return false;
}

const mids = await getMids();
const entry = Number(mids?.[symbol]);
if (!Number.isFinite(entry)) {
await reply(chatId, `No Hyperliquid price for ${symbol}`);
return false;
}

portfolio.balance -= margin;
portfolio.positions.push({
id: getNextPosId(),
chatId,
symbol,
side,
lev,
margin,
entry,
stop: plan?.stop ?? null,
tp1: plan?.tp1 ?? null,
openedAt: Date.now()
});

await reply(chatId, `✅ PAPER ${side.toUpperCase()} ${symbol}\nLev: ${lev}x Margin: $${fmt(margin)} Entry: $${fmt(entry)}`);
return true;
}

async function closePaperPosition(chatId, symbol) {
const idx = portfolio.positions.findIndex(p => p.symbol === symbol);
if (idx === -1) {
if (chatId) await reply(chatId, `No open paper position for ${symbol}`);
return false;
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

const closedTrade = { ...pos, exit: Number.isFinite(now) ? now : null, pnl, closedAt: Date.now() };
portfolio.closed.unshift(closedTrade);
if (portfolio.closed.length > 500) portfolio.closed.length = 500;

if (trial.active) {
trial.trades += 1;
trial.totalPnl += pnl;
if (pnl >= 0) {
trial.wins += 1;
trial.grossWin += pnl;
} else {
trial.losses += 1;
trial.grossLossAbs += Math.abs(pnl);
}
}

if (chatId) await reply(chatId, `✅ Closed ${symbol}\nPnL: $${fmt(pnl)}\nBalance: $${fmt(portfolio.balance)}`);
return true;
}

async function handlePaper(chatId, parts) {
if (parts.length < 3) {
await reply(chatId, 'Usage:\n/paper long BTC 5 10\n/paper short ETH 3 20\n/paper close BTC');
return;
}

const action = (parts[1] || '').toLowerCase();
if (action === 'close') {
const symbol = (parts[2] || '').toUpperCase();
await closePaperPosition(chatId, symbol);
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

module.exports = { handlePaper, openPaperPosition, closePaperPosition };
