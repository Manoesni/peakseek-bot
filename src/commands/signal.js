const { reply, replySignalCard } = require('../telegram');
const { getCandles } = require('../hyperliquid');
const { portfolio, risk } = require('../state');
const { fmt, computeSignal, sizingFromRisk } = require('../indicators');

async function handleSignal(chatId, parts) {
if (parts.length !== 2) {
await reply(chatId, 'Usage: /signal <TOKEN>\nExample: /signal BTC');
return;
}

const symbol = parts[1].toUpperCase();
const candles = await getCandles(symbol);
const closes = (candles || []).map(c => Number(c.c));
const sig = computeSignal(closes);

if (!sig) {
await reply(chatId, `No market data for ${symbol} right now.`);
return;
}

const sz = sizingFromRisk(portfolio.balance, risk.riskPct, 1.2, 5);

if (sig.side === 'NEUTRAL') {
await reply(
chatId,
`📍 ${symbol} Snapshot (NEUTRAL)
Price: $${fmt(sig.entry)}
SMA20: $${fmt(sig.s20)}
SMA50: $${fmt(sig.s50)}
Confidence: ${fmt(sig.confidence, 0)}/100

No trade trigger yet.`
);
return;
}

await replySignalCard(
chatId,
`📌 ${symbol} Signal
Side: ${sig.side}
Entry: $${fmt(sig.entry)}
Stop: $${fmt(sig.stop)}
TP1: $${fmt(sig.tp1)}
Confidence: ${fmt(sig.confidence, 0)}/100

Sizing (${risk.riskPct}% risk, bal $${fmt(portfolio.balance)}):
Risk $: ${fmt(sz.riskUsd)}
Notional: ${fmt(sz.notional)}
Margin@5x: ${fmt(sz.margin)}

Tap button below to execute paper trade.`,
symbol
);
}

module.exports = { handleSignal };
