const { reply } = require('../telegram');

// v0.2.2 skeleton (safe placeholder list for now)
// Next step: plug real APIs (DexScreener/GeckoTerminal/Birdeye etc.)
async function handleDexscan(chatId) {
const sample = [
{ token: 'WIF', chain: 'SOL', score: 72, note: 'Momentum candidate' },
{ token: 'PEPE', chain: 'ETH', score: 68, note: 'High volatility' },
{ token: 'BONK', chain: 'SOL', score: 65, note: 'Watch liquidity' },
{ token: 'FLOKI', chain: 'BNB', score: 61, note: 'Trend continuation watch' },
{ token: 'AERO', chain: 'BASE', score: 59, note: 'Borderline setup' }
];

let txt = '🧪 DEX Scan (Skeleton)\nTop watchlist for paper testing:\n';
for (const r of sample) {
txt += `\n• ${r.token} (${r.chain}) | score ${r.score} | ${r.note}`;
}
txt += '\n\nUse /signal <TOKEN> for current engine check.\nNext patch: real live DEX source integration.';
await reply(chatId, txt);
}

module.exports = { handleDexscan };
