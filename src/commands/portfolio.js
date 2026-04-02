const { reply } = require('../telegram');
const { portfolio } = require('../state');
const { fmt } = require('../indicators');

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

module.exports = { handlePortfolio };
