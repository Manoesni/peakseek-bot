const { reply } = require('../telegram');
const { trial, portfolio } = require('../state');
const { fmt } = require('../indicators');

async function handleTrial(chatId, parts) {
const sub = (parts[1] || 'report').toLowerCase();

if (sub === 'start') {
trial.active = true;
trial.startedAt = Date.now();
trial.startBalance = portfolio.balance;
trial.trades = 0;
trial.wins = 0;
trial.losses = 0;
trial.totalPnl = 0;
trial.grossWin = 0;
trial.grossLossAbs = 0;
await reply(chatId, `🧪 Trial started\nStart balance: $${fmt(trial.startBalance)}`);
return;
}

if (sub === 'stop') {
trial.active = false;
await reply(chatId, '🧪 Trial stopped.');
return;
}

const winRate = trial.trades > 0 ? (trial.wins / trial.trades) * 100 : 0;
const avgPnl = trial.trades > 0 ? trial.totalPnl / trial.trades : 0;
const avgWin = trial.wins > 0 ? trial.grossWin / trial.wins : 0;
const avgLoss = trial.losses > 0 ? trial.grossLossAbs / trial.losses : 0;
const pf = trial.grossLossAbs > 0 ? trial.grossWin / trial.grossLossAbs : (trial.grossWin > 0 ? 99 : 0);
const deltaBal = portfolio.balance - trial.startBalance;

await reply(
chatId,
`🧪 Trial Report
Active: ${trial.active ? 'YES' : 'NO'}
Trades: ${trial.trades}
Wins/Losses: ${trial.wins}/${trial.losses}
Win rate: ${fmt(winRate)}%
Total PnL: $${fmt(trial.totalPnl)}
Avg PnL/trade: $${fmt(avgPnl)}
Avg Win: $${fmt(avgWin)}
Avg Loss: $${fmt(avgLoss)}
Profit Factor: ${fmt(pf)}
Balance Δ: $${fmt(deltaBal)}
Current balance: $${fmt(portfolio.balance)}`
);
}

module.exports = { handleTrial };
