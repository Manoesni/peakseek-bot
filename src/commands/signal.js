const { reply, replySignalCard } = require('../telegram');
const { getCandles } = require('../hyperliquid');
const { portfolio, risk } = require('../state');
const { fmt, computeSignal, sizingFromRisk } = require('../indicators');

function recommendationFromSignal(sig) {
if (!sig || sig.side === 'NEUTRAL') return { action: 'SKIP', reason: 'No trend alignment' };

// confidence gate
if (sig.confidence < 58) {
return { action: 'SKIP', reason: `Low confidence (${fmt(sig.confidence, 0)})` };
}

return {
action: sig.side === 'LONG' ? 'LONG' : 'SHORT',
reason: `Trend aligned, confidence ${fmt(sig.confidence, 0)}`
};
}

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
const rec = recommendationFromSignal(sig);

if (sig.side === 'NEUTRAL' || rec.action === 'SKIP') {
await reply(
chatId,
`📍 ${symbol} Signal Check
Side: ${sig.side}
Price: $${fmt(sig.entry)}
SMA20: $${fmt(sig.s20)}
SMA50: $${fmt(sig.s50)}
Confidence: ${fmt(sig.confidence, 0)}/100

Recommendation: SKIP
Reason: ${rec.reason}`
);
return;
}

await replySignalCard(
chatId,
`📌 ${symbol} Trade Recommendation
Direction: ${rec.action}
Entry: $${fmt(sig.entry)}
Stop: $${fmt(sig.stop)}
TP1: $${fmt(sig.tp1)}
Confidence: ${fmt(sig.confidence, 0)}/100
Reason: ${rec.reason}

Sizing (${risk.riskPct}% risk, bal $${fmt(portfolio.balance)}):
Risk $: ${fmt(sz.riskUsd)}
Notional: ${fmt(sz.notional)}
Margin@5x: ${fmt(sz.margin)}`,
symbol
);
}

module.exports = { handleSignal };
