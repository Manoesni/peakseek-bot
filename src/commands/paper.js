const { reply } = require('../telegram');
const { persistNow } = require('../state');
const { portfolio, settings, lossCooldown } = require('../state');
const { getBestPrice } = require('../prices');
const { fmtAdaptive } = require('../indicators');
const { recordTrialClose } = require('./trial');

function n(v){ return Number(v || 0); }

function findOpen(symbol) {
return portfolio.positions.find(p => p.symbol === symbol);
}

function calcPnlUsd(pos, exitPrice) {
const entry = n(pos.entry);
const lev = n(pos.leverage || 1);
const margin = n(pos.margin);
if (!entry || !margin) return 0;

const side = String(pos.side || 'long').toLowerCase();
const move = side === 'short' ? (entry - exitPrice) / entry : (exitPrice - entry) / entry;
return margin * lev * move;
}

async function openPaperPosition(chatId, side, symbol, leverage, margin, extras = {}) {
const px = Number(extras.forcedEntry);
const price = Number.isFinite(px) ? px : Number((await getBestPrice(symbol))?.price);

if (!Number.isFinite(price) || price <= 0) {
await reply(chatId, `No live price for ${symbol}.`);
return false;
}
if (n(portfolio.balance) < n(margin)) {
await reply(chatId, 'Insufficient paper balance.');
return false;
}

const pos = {
id: Date.now() + Math.floor(Math.random()*1000),
chatId,
openedAt: Date.now(),
side: side || 'long',
symbol,
leverage: n(leverage || settings.leverage?.dex || 3),
margin: n(margin),
entry: n(price),
stop: Number.isFinite(n(extras.stop)) ? n(extras.stop) : null,
tp1: Number.isFinite(n(extras.tp1)) ? n(extras.tp1) : null,
tp2: Number.isFinite(n(extras.tp2)) ? n(extras.tp2) : null,
trailingArm: Number.isFinite(n(extras.trailingArm)) ? n(extras.trailingArm) : null,
trailingOn: false,
trailingStop: null,
highest: n(price),
priceSource: extras.forcedSource || 'DEX',
chain: extras.forcedChain || null,
pairAddress: extras.forcedPairAddress || null
};

portfolio.positions.push(pos);
portfolio.balance = n(portfolio.balance) - n(margin);
  persistNow();

await reply(
chatId,
`✅ PAPER ${String(pos.side).toUpperCase()} ${symbol}
Lev: ${pos.leverage}x Margin: $${fmtAdaptive(pos.margin)}
Entry: $${fmtAdaptive(pos.entry)}
Source: ${pos.priceSource}${pos.chain ? ` (${pos.chain})` : ''}
Pair: ${pos.pairAddress || 'n/a'}`
);

return true;
}

async function closePaperPosition(chatId, symbol, reason = 'MANUAL') {
const i = portfolio.positions.findIndex(p => p.symbol === symbol);
if (i < 0) {
if (chatId) await reply(chatId, `No open paper position for ${symbol}`);
return false;
}

const pos = portfolio.positions[i];
const px = await getBestPrice(symbol, {
pairAddress: pos.pairAddress || null,
sourceLock: pos.priceSource || null,
strict: true,
chainHint: pos.chain || null
});

const exit = n(px?.price);
if (!Number.isFinite(exit) || exit <= 0) {
if (chatId) await reply(chatId, `No live price to close ${symbol} right now. Try again.`);
return false;
}

const pnl = calcPnlUsd(pos, exit);
portfolio.positions.splice(i, 1);
portfolio.balance = n(portfolio.balance) + n(pos.margin) + pnl;
  persistNow();

// unified accounting event
recordTrialClose({
 symbol: pos.symbol,
 side: pos.side,
 reason,
 entry: pos.entry,
 exit,
 margin: pos.margin,
 leverage: pos.leverage,
 pnl
 });

 if (pnl < 0) {
 const until = Date.now() + (Number(lossCooldown?.minutes || 30) * 60 * 1000);
 if (pos.symbol) lossCooldown.bySymbol[String(pos.symbol).toUpperCase()] = until;
 if (pos.pairAddress) lossCooldown.byPair[String(pos.pairAddress)] = until;
 }

if (chatId) {
await reply(
chatId,
`📕 CLOSED ${pos.symbol} (${reason})
Entry: $${fmtAdaptive(pos.entry)}
Exit: $${fmtAdaptive(exit)}
PnL: $${fmtAdaptive(pnl)}
Balance: $${fmtAdaptive(portfolio.balance)}`
);
}

return true;
}

async function handlePaper(chatId, parts) {
const sub = (parts[1] || '').toLowerCase();

if (sub === 'closeall') {
const symbols = [...new Set(portfolio.positions.map(p => p.symbol))];
if (!symbols.length) {
await reply(chatId, 'No open paper positions.');
return;
}
for (const s of symbols) {
await closePaperPosition(chatId, s, 'CLOSEALL');
}
return;
}

if (sub === 'close' && parts[2]) {
await closePaperPosition(chatId, parts[2].toUpperCase(), 'MANUAL');
return;
}

await reply(chatId, 'Paper commands:\n• /paper close <SYMBOL>\n• /paper closeall');
}

module.exports = { handlePaper, openPaperPosition, closePaperPosition };
