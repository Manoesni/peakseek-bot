const { reply } = require('../telegram');
const { portfolio, risk, trial, getNextPosId } = require('../state');
const { fmt, fmtAdaptive } = require('../indicators');
const { getBestPrice } = require('../prices');

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

const px = await getBestPrice(symbol);
if (!px || !Number.isFinite(px.price)) {
await reply(chatId, `No price found for ${symbol} (HL+DEX lookup failed).`);
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
entry: px.price,
priceSource: px.source,
chain: px.chain || null,
pairAddress: px.pairAddress || null,
stop: plan?.stop ?? null,
tp1: plan?.tp1 ?? null,
tp2: plan?.tp2 ?? null,
trailingArm: plan?.trailingArm ?? null,
trailingOn: false,
trailingStop: null,
highest: px.price,
openedAt: Date.now()
});

await reply(
chatId,
`✅ PAPER ${side.toUpperCase()} ${symbol}
Lev: ${lev}x Margin: $${fmt(margin)}
Entry: $${fmtAdaptive(px.price)}
Source: ${px.source}${px.chain ? ` (${px.chain})` : ''}`
);
return true;
}

async function closePaperPosition(chatId, symbol, reason = null, silent = false) {
const idx = portfolio.positions.findIndex(p => p.symbol === symbol);
if (idx === -1) {
if (chatId && !silent) await reply(chatId, `No open paper position for ${symbol}`);
return false;
}

const pos = portfolio.positions[idx];
const px = await getBestPrice(symbol);

if (!px || !Number.isFinite(px.price)) {
if (chatId && !silent) await reply(chatId, `No live price to close ${symbol} right now. Try again.`);
return false;
}

const move = (px.price - pos.entry) / pos.entry;
const signed = pos.side === 'long' ? move : -move;
const pnl = pos.margin * pos.lev * signed;
const roiPct = signed * 100 * pos.lev;

portfolio.balance += pos.margin + pnl;
portfolio.positions.splice(idx, 1);

const closedTrade = {
...pos,
exit: px.price,
exitSource: px.source,
closeReason: reason || 'manual',
pnl,
roiPct,
closedAt: Date.now()
};

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

if (chatId && !silent) {
await reply(
chatId,
`✅ Closed ${symbol}${reason ? ` (${reason})` : ''}
Entry: $${fmtAdaptive(pos.entry)}
Exit: $${fmtAdaptive(px.price)}
PnL: $${fmtAdaptive(pnl)} (${fmtAdaptive(roiPct)}%)
Balance: $${fmtAdaptive(portfolio.balance)}
Exit source: ${px.source}`
);
}
return true;
}

async function closeAllPositions(chatId) {
const syms = portfolio.positions.map(p => p.symbol);
if (!syms.length) {
await reply(chatId, 'No open positions to close.');
return;
}

let closed = 0;
for (const s of syms) {
const ok = await closePaperPosition(chatId, s, 'manual-closeall', true);
if (ok) closed += 1;
}

await reply(chatId, `✅ Close-all complete.\nClosed: ${closed}\nOpen now: ${portfolio.positions.length}\nBalance: $${fmtAdaptive(portfolio.balance)}`);
}

async function handlePaper(chatId, parts) {
if (parts.length < 2) {
await reply(chatId, 'Usage:\n/paper long BTC 5 10\n/paper short ETH 3 20\n/paper close BTC\n/paper closeall');
return;
}

const action = (parts[1] || '').toLowerCase();
if (action === 'closeall') {
await closeAllPositions(chatId);
return;
}

if (action === 'close') {
const symbol = (parts[2] || '').toUpperCase();
if (!symbol) {
await reply(chatId, 'Usage: /paper close <SYMBOL>');
return;
}
await closePaperPosition(chatId, symbol, 'manual');
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

module.exports = { handlePaper, openPaperPosition, closePaperPosition, closeAllPositions };
