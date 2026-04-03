const { reply, replySignalCard } = require('../telegram');
const { portfolio, risk, settings } = require('../state');
const { runner } = require('../runner');
const { getCandles } = require('../hyperliquid');
const { fmt, computeSignal, sizingFromRisk } = require('../indicators');
const { openPaperPosition } = require('./paper');

function trendPct(sig) {
if (!sig?.s50) return 0;
return Math.abs(((sig.s20 - sig.s50) / sig.s50) * 100);
}

function recommendationFromSignal(sig) {
if (!sig || sig.side === 'NEUTRAL') return { action: 'SKIP', reason: 'No trend alignment' };

if (sig.confidence < settings.filters.minConfidence) {
return { action: 'SKIP', reason: `Low confidence (${fmt(sig.confidence, 0)})` };
}

const tp = trendPct(sig);
if (tp < settings.filters.minTrendPct) {
return { action: 'SKIP', reason: `Weak trend (${fmt(tp)}% < ${fmt(settings.filters.minTrendPct)}%)` };
}

return {
action: sig.side === 'LONG' ? 'LONG' : 'SHORT',
reason: `Trend+confidence pass (trend ${fmt(tp)}%)`
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
Trend strength: ${fmt(trendPct(sig))}%

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
Trend strength: ${fmt(trendPct(sig))}%
Reason: ${rec.reason}

Sizing (${risk.riskPct}% risk, bal $${fmt(portfolio.balance)}):
Risk $: ${fmt(sz.riskUsd)}
Notional: ${fmt(sz.notional)}
Margin@5x: ${fmt(sz.margin)}`,
symbol
);

if (settings.mode === 'semi' && runner.enabled) {
const side = rec.action === 'LONG' ? 'long' : 'short';
const margin = Math.min(Math.max(5, sz.margin), runner.maxAutoMarginPerTrade);
const opened = await openPaperPosition(chatId, side, symbol, 5, margin, { stop: sig.stop, tp1: sig.tp1 });
if (opened) await reply(chatId, `🤖 Semi-auto entered ${side.toUpperCase()} ${symbol} with $${fmt(margin)} margin.`);
}
}

module.exports = { handleSignal };
