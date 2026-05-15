const { reply } = require('../telegram');
const { portfolio } = require('../state');
const { fmtAdaptive } = require('../indicators');

async function handlePositions(chatId) {
const rows = portfolio.positions || [];
if (!rows.length) {
await reply(chatId, 'No open positions.');
return;
}

const lines = rows.map((p) => {
const lev = Number(p.leverage || p.lev || 3);
return `#${p.id} ${String(p.symbol || '').toUpperCase()} ${String(p.side || 'long').toUpperCase()}
Entry: $${fmtAdaptive(p.entry)} | Margin: $${fmtAdaptive(p.margin)} | Lev: ${lev}x
SL: ${p.stop != null ? `$${fmtAdaptive(p.stop)}` : '-'} | TP1: ${p.tp1 != null ? `$${fmtAdaptive(p.tp1)}` : '-'} | TP2: ${p.tp2 != null ? `$${fmtAdaptive(p.tp2)}` : '-'}
Trail: ${p.trailingOn ? `ON (${p.trailingStop ? '$' + fmtAdaptive(p.trailingStop) : 'n/a'})` : 'OFF'}
Source: ${p.priceSource || 'n/a'}${p.chain ? ` (${p.chain})` : ''}
Pair: ${p.pairAddress || 'n/a'}`;
});

await reply(chatId, `📌 Open Positions (${rows.length})\n\n${lines.join('\n\n')}`);
}

module.exports = { handlePositions };
