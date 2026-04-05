const { reply } = require('../telegram');
const { portfolio } = require('../state');
const { fmtAdaptive } = require('../indicators');

async function handlePositions(chatId) {
if (!portfolio.positions.length) {
await reply(chatId, 'No open positions.');
return;
}

let txt = `📌 Open Positions (${portfolio.positions.length})`;
for (const p of portfolio.positions) {
txt += `

#${p.id} ${p.symbol} ${p.side.toUpperCase()}
Entry: $${fmtAdaptive(p.entry)} | Margin: $${fmtAdaptive(p.margin)} | Lev: ${p.lev}x
SL: ${p.stop ? `$${fmtAdaptive(p.stop)}` : '-'} | TP1: ${p.tp1 ? `$${fmtAdaptive(p.tp1)}` : '-'} | TP2: ${p.tp2 ? `$${fmtAdaptive(p.tp2)}` : '-'}
Trail: ${p.trailingOn ? `ON @ $${fmtAdaptive(p.trailingStop || 0)}` : 'OFF'}
Source: ${p.priceSource || 'n/a'}${p.chain ? ` (${p.chain})` : ''}${p.pairAddress ? `\nPair: ${p.pairAddress}` : ''}`;
}

await reply(chatId, txt);
}

module.exports = { handlePositions };
