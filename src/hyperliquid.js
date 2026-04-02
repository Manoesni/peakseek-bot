async function hlInfo(payload) {
const r = await fetch('https://api.hyperliquid.xyz/info', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});
return r.json();
}

async function getMids() {
return hlInfo({ type: 'allMids' });
}

async function getCandles(symbol, interval = '15m', n = 120) {
const end = Date.now();
const start = end - n * 15 * 60 * 1000;
return hlInfo({
type: 'candleSnapshot',
req: { coin: symbol, interval, startTime: start, endTime: end }
});
}

module.exports = { hlInfo, getMids, getCandles };
