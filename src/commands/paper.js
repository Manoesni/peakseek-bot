const { reply } = require('../telegram');
const { getMids } = require('../hyperliquid');
const { portfolio, risk, getNextPosId } = require('../state');
const { fmt } = require('../indicators');

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
id: getNextPosId(),
symbol,
side,
lev,
margin,
entry
});

await reply(chatId, `✅ PAPER ${side.toUpperCase()} ${symbol}\nLev: ${lev}x Margin: $${fmt(margin)} Entry: $${fmt(entry)}`);
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

module.exports = { handlePaper, openPaperPosition };
