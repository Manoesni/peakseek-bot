function sma(arr, n) {
if (!arr || arr.length < n) return null;
const slice = arr.slice(arr.length - n);
const sum = slice.reduce((a, b) => a + Number(b || 0), 0);
return sum / n;
}

function fmt(n, d = 2) {
if (!Number.isFinite(Number(n))) return 'n/a';
return Number(n).toFixed(d);
}

function fmtAdaptive(n) {
const x = Number(n);
if (!Number.isFinite(x)) return 'n/a';
const ax = Math.abs(x);
if (ax >= 1000) return x.toFixed(2);
if (ax >= 1) return x.toFixed(4);
if (ax >= 0.01) return x.toFixed(6);
return x.toFixed(8);
}

function computeSignal(closes) {
if (!closes || closes.length < 60) return null;
const s20 = sma(closes, 20);
const s50 = sma(closes, 50);
const entry = closes[closes.length - 1];

if (!s20 || !s50 || !entry) return null;

let side = 'NEUTRAL';
if (s20 > s50) side = 'LONG';
if (s20 < s50) side = 'SHORT';

const stop = side === 'LONG'
? entry * 0.988
: side === 'SHORT'
? entry * 1.012
: entry;

const tp1 = side === 'LONG'
? entry * 1.018
: side === 'SHORT'
? entry * 0.982
: entry;

const confidence = Math.min(99, Math.max(51, 55 + Math.abs((s20 - s50) / s50) * 500));

return { side, entry, stop, tp1, confidence, s20, s50 };
}

function sizingFromRisk(balanceUsd, riskPct, stopPct = 1.2, lev = 5) {
const riskUsd = (balanceUsd * riskPct) / 100;
const notional = riskUsd / (stopPct / 100);
const margin = notional / lev;
return { riskUsd, notional, margin };
}

module.exports = { sma, fmt, fmtAdaptive, computeSignal, sizingFromRisk };
