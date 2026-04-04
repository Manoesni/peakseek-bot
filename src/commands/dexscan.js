const { reply } = require('../telegram');

async function fetchDexscreenerBoosts() {
// lightweight public endpoint
const r = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
if (!r.ok) throw new Error('dexscreener fetch failed');
const data = await r.json();
return Array.isArray(data) ? data : [];
}

function fmtRow(x) {
const token = x?.tokenSymbol || x?.symbol || 'UNK';
const chain = x?.chainId || x?.chain || 'n/a';
const score = x?.amount ? Math.min(99, Math.round(Number(x.amount))) : 60;
return { token: String(token).toUpperCase(), chain: String(chain).toUpperCase(), score };
}

async function handleDexscan(chatId, parts = []) {
const sub = (parts[1] || '').toLowerCase();

// /dexscan live
if (sub === 'live') {
try {
const rows = await fetchDexscreenerBoosts();
const top = rows.slice(0, 8).map(fmtRow);

if (!top.length) {
await reply(chatId, '🧪 DEX Scan Live\nNo boosted tokens found right now.');
return;
}

let txt = '🧪 DEX Scan Live (DexScreener boosts)\n';
for (const r of top) {
txt += `\n• ${r.token} (${r.chain}) | heat ${r.score}`;
}
txt += '\n\nNext step:\n• /dexpick <TOKEN> <amount>\nExample: /dexpick WIF 15';
await reply(chatId, txt);
return;
} catch (e) {
await reply(chatId, 'DEX live scan failed right now. Try again in a minute.');
return;
}
}

// default skeleton
await reply(
chatId,
`🧪 DEX Scan
Use:
• /dexscan live (fetch live boosted tokens)
• /dexpick <TOKEN> <amount> (paper entry helper)`
);
}

module.exports = { handleDexscan };
