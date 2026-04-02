function sma(arr, len) {
if (arr.length < len) return null;
const x = arr.slice(-len);
return x.reduce((a, b) => a + b, 0) / x.length;
}

function fmt(n, d = 2) {
return Number(n).toFixed(d);
}

function computeSignal(closes) {
if (!closes || closes.length < 60) return null;
const c = closes[closes.length - 1];
const s20 = sma(closes, 20);
const s50 = sma(closes, 50);
if (!s20 || !s50) return null;

// Easier trigger:
// LONG if price above SMA20 and SMA20 slightly above SMA50
// SHORT if price below SMA20 and SMA20 slightly below SMA50
const spreadPct = ((s20 - s50) / s50) * 100;

let side = 'NEUTRAL';
if (c > s20 && spreadPct > -0.10) side = 'LONG';
if (c < s20 && spreadPct < 0.10) side = 'SHORT';

const stopPct = 1.2;
const tpPct = 2.2;
const stop = side === 'LONG' ? c * (1 - stopPct / 100) : side === 'SHORT' ? c * (1 + stopPct / 100) : null;
const tp1 = side === 'LONG' ? c * (1 + tpPct / 100) : side === 'SHORT' ? c * (1 - tpPct / 100) : null;

const confidenceBase = 55;
const confidence = Math.max(42, Math.min(88, confidenceBase + Math.abs(spreadPct) * 80));

return { side, entry: c, stop, tp1, confidence, s20, s50 };
}

function sizingFromRisk(balanceUsd, riskPct, stopPct = 1.2, lev = 5) {
const riskUsd = balanceUsd * (riskPct / 100);
const notional = riskUsd / (stopPct / 100);
const margin = notional / lev;
return { riskUsd, notional, margin };
}

module.exports = { sma, fmt, computeSignal, sizingFromRisk };
