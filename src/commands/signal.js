const { reply, replySignalCard } = require('../telegram');
const { portfolio, risk, settings } = require('../state');
const { getCandles } = require('../hyperliquid');
const { fmt, computeSignal, sizingFromRisk } = require('../indicators');

function trendPct(sig) {
if (!sig?.s50) return 0;
return Math.abs(((sig.s20 - sig.s50) / sig.s50) * 100);
}

function confidenceTier(c) {
if (c >= 72) return 'A';
if (c >= 62) return 'B';
return 'C';
}

function recommendationFromSignal(sig) {
if (!sig || sig.side === 'NEUTRAL') {
return {
verdict: '⛔ SKIP',
action: 'SKIP',
reason: 'No trend alignment',
breakdown: ['trend: neutral']
};
}

const t = trendPct(sig);
const c = sig.confidence;

const breakdown = [
`confidence=${fmt(c, 0)}`,
`trend=${fmt(t)}%`,
`sma20_vs_sma50=${sig.s20 > sig.s50 ? 'bull' : 'bear'}`
];

if (c < settings.filters.minConfidence) {
return {
verdict: '⛔ SKIP',
action: 'SKIP',
reason: `Low confidence (${fmt(c, 0)} < ${settings.filters.minConfidence})`,
breakdown
};
}

if (t < settings.filters.minTrendPct) {
return {
verdict: '⛔ SKIP',
action: 'SKIP',
reason: `Weak trend (${fmt(t)}% < ${fmt(settings.filters.minTrendPct)}%)`,
breakdown
};
}

const action = sig.side === 'LONG' ? 'LONG' : 'SHORT';
return {
verdict: action === 'LONG' ? '✅ RECOMMEND LONG' : '✅ RECOMMEND SHORT',
action,
reason: `Trend+confidence pass`,
breakdown
};
}

function scenarioText(side) {
if (side === 'LONG') return 'Scenario: Base 1.05x | Strong 1.15x | Stretch 1.30x';
if (side === 'SHORT') return 'Scenario: Base +5% move | Strong +12% move | Stretch +20% move';
return 'Scenario: wait for better setup';
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

const lev = Number(settings.leverage?.majors || 5);
const sz = sizingFromRisk(portfolio.balance, risk.riskPct, 1.2, lev);
const rec = recommendationFromSignal(sig);
const tier = confidenceTier(sig.confidence);

const common = `🎯 ${symbol} Verdict Card
${rec.verdict}
Confidence: ${fmt(sig.confidence, 0)}/100 (Tier ${tier})
Trend strength: ${fmt(trendPct(sig))}%
Reason: ${rec.reason}
Breakdown: ${rec.breakdown.join(' | ')}

Entry: $${fmt(sig.entry)}
Stop: $${fmt(sig.stop)}
TP1: $${fmt(sig.tp1)}

Leverage preset: ${lev}x
Sizing (${risk.riskPct}% risk, bal $${fmt(portfolio.balance)}):
Risk $: ${fmt(sz.riskUsd)}
Notional: ${fmt(sz.notional)}
Margin@${lev}x: ${fmt(sz.margin)}

${scenarioText(rec.action)}

(Analysis only — no auto execution from /signal)`;

if (rec.action === 'SKIP') {
await reply(chatId, common);
return;
}

await replySignalCard(chatId, common, symbol);
}

module.exports = { handleSignal };
