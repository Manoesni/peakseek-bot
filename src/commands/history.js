const { reply } = require('../telegram');
const { portfolio } = require('../state');
const { fmt } = require('../indicators');

async function handleHistory(chatId) {
const closed = portfolio.closed || [];
if (!closed.length) {
await reply(chatId, '📜 No closed trades yet.');
return;
}

const last = closed.slice(0, 10);
let wins = 0;
let losses = 0;
let totalPnl = 0;

for (const t of closed) {
totalPnl += t.pnl;
if (t.pnl >= 0) wins++;
else losses++;
}

let txt = `📜 Trade History (last ${last.length})\n`;
txt += `Total closed: ${closed.length}\n`;
txt += `Wins/Losses: ${wins}/${losses}\n`;
txt += `Total PnL: $${fmt(totalPnl)}\n`;

for (const t of last) {
txt += `\n• ${t.symbol} ${t.side.toUpperCase()} lev=${t.lev} pnl=$${fmt(t.pnl)}`;
}

await reply(chatId, txt);
}

module.exports = { handleHistory };
