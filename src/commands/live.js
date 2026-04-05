const { reply } = require('../telegram');
const { portfolio, trial } = require('../state');
const { getBestPrice } = require('../prices');
const { fmtAdaptive } = require('../indicators');

let lastAutoAction = 'none';

function setLastAutoAction(txt) {
lastAutoAction = txt || 'none';
}
function getLastAutoAction() {
return lastAutoAction || 'none';
}

async function unrealizedPnl() {
let total = 0;
for (const p of portfolio.positions) {
const px = await getBestPrice(p.symbol);
const price = Number(px?.price);
if (!Number.isFinite(price)) continue;
const move = (price - p.entry) / p.entry;
const signed = p.side === 'long' ? move : -move;
total += p.margin * p.lev * signed;
}
return total;
}

async function handleLive(chatId) {
const open = portfolio.positions.length;
const locked = portfolio.positions.reduce((a, p) => a + Number(p.margin || 0), 0);
const u = await unrealizedPnl();

await reply(
chatId,
`📡 Live Report
Open positions: ${open}
Locked margin: $${fmtAdaptive(locked)}
Unrealized PnL: $${fmtAdaptive(u)}
Realized PnL (trial): $${fmtAdaptive(trial.totalPnl)}
Trial trades: ${trial.trades}
Last auto action: ${getLastAutoAction()}
Balance: $${fmtAdaptive(portfolio.balance)}`
);
}

module.exports = { handleLive, setLastAutoAction };
