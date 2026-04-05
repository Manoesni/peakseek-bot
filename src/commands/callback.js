const { answerCallback, tg } = require('../telegram');
const { openPaperPosition } = require('./paper');

async function handleCallback(cb) {
const data = cb?.data || '';
const chatId = cb?.message?.chat?.id;
if (!chatId) return;

if (data.startsWith('paper_custom_')) {
const parts = data.split('_');
const side = parts[2];
const symbol = (parts[3] || '').toUpperCase();

await answerCallback(cb.id, `Use custom amount for ${side} ${symbol}`);
await tg('sendMessage', {
chat_id: String(chatId),
text: `Custom ${side.toUpperCase()} amount:\nUse /paper ${side} ${symbol} <amount>\nExample: /paper ${side} ${symbol} 250`
});
return;
}

if (data.startsWith('paper_')) {
const parts = data.split('_');
const side = parts[1];
const symbol = (parts[2] || '').toUpperCase();
const amount = Number(parts[3] || 0);

await answerCallback(cb.id, `${side.toUpperCase()} ${symbol} $${amount}`);
if (side === 'skip') return;
if (!['long', 'short'].includes(side) || !symbol || !amount) return;

await openPaperPosition(chatId, side, symbol, 5, amount);
return;
}

if (data.startsWith('dexpair_')) {
const parts = data.split('_');
const token = (parts[1] || '').toUpperCase();
const chain = (parts[2] || '').toUpperCase();
await answerCallback(cb.id, `Pick amount for ${token} (${chain})`);
await tg('sendMessage', {
chat_id: String(chatId),
text: `Select paper amount for ${token} (${chain})`,
reply_markup: JSON.stringify({
inline_keyboard: [
[
{ text: '$5', callback_data: `dexpickamt_${token}_5` },
{ text: '$10', callback_data: `dexpickamt_${token}_10` },
{ text: '$25', callback_data: `dexpickamt_${token}_25` }
],
[
{ text: '$50', callback_data: `dexpickamt_${token}_50` },
{ text: '$100', callback_data: `dexpickamt_${token}_100` }
],
[{ text: 'Custom', callback_data: `dexpickcustom_${token}` }]
]
})
});
return;
}

if (data.startsWith('dexpickcustom_')) {
const token = data.split('_')[1]?.toUpperCase();
await answerCallback(cb.id, `Use: /dexpick ${token} <amount>`);
await tg('sendMessage', {
chat_id: String(chatId),
text: `Custom amount:\nUse /dexpick ${token} <amount>\nExample: /dexpick ${token} 37`
});
return;
}

if (data.startsWith('dexpickamt_')) {
const parts = data.split('_');
const token = (parts[1] || '').toUpperCase();
const amount = Number(parts[2] || 0);
if (!token || !amount) return;

await answerCallback(cb.id, `Buying ${token} $${amount}`);
const { handleDexpick } = require('./dexpick');
await handleDexpick(chatId, ['/dexpick', token, String(amount)]);
return;
}
}

module.exports = { handleCallback };
