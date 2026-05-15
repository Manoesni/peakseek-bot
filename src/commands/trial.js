const { reply } = require('../telegram');
const { trial, portfolio } = require('../state');

function n(v) { return Number(v || 0); }

function ensureTrialShape() {
if (typeof trial.active !== 'boolean') trial.active = false;
if (!Number.isFinite(trial.startBalance)) trial.startBalance = n(portfolio.balance || 10000);
if (!Number.isFinite(trial.realizedPnl)) trial.realizedPnl = 0;
if (!Number.isFinite(trial.trades)) trial.trades = 0;
if (!Number.isFinite(trial.wins)) trial.wins = 0;
if (!Number.isFinite(trial.losses)) trial.losses = 0;
if (!Number.isFinite(trial.reserve)) trial.reserve = 0;
if (!Number.isFinite(trial.reservePct)) trial.reservePct = 0.20;
if (!Array.isArray(trial.history)) trial.history = [];
}

function startTrial() {
ensureTrialShape();
trial.active = true;
trial.startedAt = Date.now();
trial.startBalance = n(portfolio.balance || 10000);
trial.realizedPnl = 0;
trial.trades = 0;
trial.wins = 0;
trial.losses = 0;
trial.reserve = 0;
trial.reservePct = 0.20;
trial.history = [];
}

function recordTrialClose(row) {
ensureTrialShape();
if (!trial.active) return;

const pnl = n(row?.pnl);
trial.realizedPnl += pnl;
trial.trades += 1;
if (pnl >= 0) trial.wins += 1;
else trial.losses += 1;

trial.history.push({
ts: Date.now(),
symbol: row?.symbol || 'UNK',
side: row?.side || 'long',
reason: row?.reason || 'CLOSE',
entry: n(row?.entry),
exit: n(row?.exit),
margin: n(row?.margin),
leverage: n(row?.leverage),
pnl
});

if (trial.history.length > 500) trial.history = trial.history.slice(-500);
}

function trialSnapshot() {
ensureTrialShape();

const trades = n(trial.trades);
const wins = n(trial.wins);
const losses = n(trial.losses);
const total = n(trial.realizedPnl);

const winRate = trades > 0 ? (wins / trades) * 100 : 0;
const avg = trades > 0 ? total / trades : 0;

const winPnls = trial.history.filter(x => n(x.pnl ?? x.pnlUsd) > 0).map(x => Math.min(n(x.pnl ?? x.pnlUsd), (x.budget||10)*2));
const lossPnlsAbs = trial.history.filter(x => n(x.pnl ?? x.pnlUsd) < 0).map(x => Math.abs(n(x.pnl ?? x.pnlUsd)));

const avgWin = winPnls.length ? winPnls.reduce((a,b)=>a+b,0) / winPnls.length : 0;
const avgLoss = lossPnlsAbs.length ? lossPnlsAbs.reduce((a,b)=>a+b,0) / lossPnlsAbs.length : 0;

const grossWin = winPnls.reduce((a,b)=>a+b,0);
const grossLoss = lossPnlsAbs.reduce((a,b)=>a+b,0);
const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 999 : 0);

const reserve = n(trial.reserve);
const reservePct = n(trial.reservePct || 0.20) * 100;
return {
active: !!trial.active,
trades, wins, losses,
winRate, total, avg,
avgWin, avgLoss, pf,
startBalance: n(trial.startBalance),
balanceNow: n(portfolio.balance || 0),
delta: n(portfolio.balance || 0) - n(trial.startBalance),
reserve,
reservePct,
totalValue: n(portfolio.balance || 0) + reserve,
};
}

async function handleTrial(chatId, parts) {
const sub = (parts[1] || 'report').toLowerCase();

if (sub === 'start') {
startTrial();
await reply(chatId, '🧪 Trial started (fresh stats baseline).');
return;
}

const s = trialSnapshot();
await reply(
chatId,
`🧪 Trial Report
Active: ${s.active ? 'YES' : 'NO'}
Trades: ${s.trades}
Wins/Losses: ${s.wins}/${s.losses}
Win rate: ${s.winRate.toFixed(2)}%
Total PnL: $${s.total.toFixed(2)}
Avg PnL/trade: $${s.avg.toFixed(2)}
Avg Win: $${s.avgWin.toFixed(2)}
Avg Loss: $${s.avgLoss.toFixed(2)}
Profit Factor: ${s.pf.toFixed(2)}
Balance Δ: $${s.delta.toFixed(2)}
Trading balance: $${s.balanceNow.toFixed(2)}
🏦 Reserved profit: $${s.reserve.toFixed(2)} (${s.reservePct.toFixed(0)}% of wins locked)
💎 Total value: $${s.totalValue.toFixed(2)}`
);
}

module.exports = {
handleTrial,
startTrial,
recordTrialClose,
trialSnapshot
};
