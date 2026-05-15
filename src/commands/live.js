const { reply } = require('../telegram');
const { portfolio } = require('../state');
const { getBestPrice } = require('../prices');
const { fmtAdaptive } = require('../indicators');
const { trialSnapshot } = require('./trial');

let _lastAutoAction = 'none';
function setLastAutoAction(v) { _lastAutoAction = v || 'none'; }
function getLastAutoAction() { return _lastAutoAction || 'none'; }

function n(v){ return Number(v || 0); }

async function calcUnrealized() {
let total = 0;
for (const p of portfolio.positions || []) {
const px = await getBestPrice(p.symbol, {
pairAddress: p.pairAddress || null,
sourceLock: p.priceSource || null,
strict: true,
chainHint: p.chain || null
});
const price = n(px?.price);
if (!Number.isFinite(price) || price <= 0) continue;

const entry = n(p.entry);
if (!entry) continue;

const side = String(p.side || 'long').toLowerCase();
const move = side === 'short' ? (entry - price) / entry : (price - entry) / entry;
total += n(p.margin) * n(p.leverage || p.lev || 3) * move;
}
return total;
}

async function handleLive(chatId) {
const open = (portfolio.positions || []).length;
const locked = (portfolio.positions || []).reduce((a,p)=>a+n(p.margin),0);
const unreal = await calcUnrealized();
const ts = trialSnapshot ? trialSnapshot() : { total: 0, trades: 0 };

await reply(chatId, `📡 Live Report
Open positions: ${open}
Locked margin: $${fmtAdaptive(locked)}
Unrealized PnL: $${fmtAdaptive(unreal)}
Realized PnL (trial): $${fmtAdaptive(n(ts.total))}
Trial trades: ${n(ts.trades)}
Last auto action: ${getLastAutoAction()}
Balance: $${fmtAdaptive(n(portfolio.balance))}`);
}

module.exports = { handleLive, setLastAutoAction, getLastAutoAction };
