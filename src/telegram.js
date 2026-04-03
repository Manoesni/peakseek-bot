const { TG } = require('./config');

let offset = 0;

function replyKeyboard() {
return JSON.stringify({
keyboard: [
[{ text: '🚀 /open' }, { text: '📊 /top dex' }, { text: '🆕 /top cex' }],
[{ text: '📌 /signal BTC' }, { text: '📌 /signal ETH' }, { text: '📌 /signal SOL' }],
[{ text: '👛 /wallet' }, { text: '⚙️ /mode' }, { text: '🤖 /semi status' }, { text: '🧱 /chains' }],
[{ text: '🛡 /risk' }, { text: '📂 /portfolio' }, { text: '📜 /history' }, { text: '🧪 /trial report' }],
[{ text: '🏁 /trial start' }, { text: '🛑 /trial stop' }, { text: '▶️ /semi on' }, { text: '⏸ /semi off' }],
[{ text: '🚀 /start' }, { text: '🏓 /ping' }]
],
resize_keyboard: true
});
}

function signalInlineKeyboard(symbol) {
return JSON.stringify({
inline_keyboard: [
[
{ text: '🟢 Long $5', callback_data: `paper_long_${symbol}_5` },
{ text: '🟢 Long $10', callback_data: `paper_long_${symbol}_10` },
{ text: '🟢 Long $20', callback_data: `paper_long_${symbol}_20` }
],
[
{ text: '🔴 Short $5', callback_data: `paper_short_${symbol}_5` },
{ text: '🔴 Short $10', callback_data: `paper_short_${symbol}_10` },
{ text: '🔴 Short $20', callback_data: `paper_short_${symbol}_20` }
],
[
{ text: '⏭ Skip', callback_data: `paper_skip_${symbol}_0` }
]
]
});
}

async function tg(method, params = {}) {
const body = new URLSearchParams(params);
const r = await fetch(`${TG}/${method}`, { method: 'POST', body });
return r.json();
}

async function reply(chatId, text) {
return tg('sendMessage', {
chat_id: String(chatId),
text,
reply_markup: replyKeyboard()
});
}

async function replySignalCard(chatId, text, symbol) {
return tg('sendMessage', {
chat_id: String(chatId),
text,
reply_markup: signalInlineKeyboard(symbol)
});
}

async function answerCallback(id, text = '') {
return tg('answerCallbackQuery', {
callback_query_id: id,
text
});
}

function getOffset() { return offset; }
function setOffset(v) { offset = v; }

module.exports = {
tg, reply, replySignalCard, answerCallback,
getOffset, setOffset
};
