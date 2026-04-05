const { TG } = require('./config');

let offset = 0;

function replyKeyboard() {
return JSON.stringify({
keyboard: [
[{ text: '🚀 /open' }, { text: '🧪 /dexscan live degen' }],
[{ text: '⚖️ /lev' }, { text: '📌 /positions' }, { text: '📡 /live' }],
[{ text: '🧾 /trial report' }, { text: '🧪 /trial start' }],
[{ text: '🤖 /auto on' }, { text: '⏸ /auto off' }],
[{ text: '🛑 /paper closeall' }, { text: '📂 /portfolio' }, { text: '🆘 /help' }],
[{ text: '📈 /signal BTC' }, { text: '📈 /signal ETH' }, { text: '📈 /signal SOL' }]
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
{ text: '🟢 Long $50', callback_data: `paper_long_${symbol}_50` },
{ text: '🟢 Long $100', callback_data: `paper_long_${symbol}_100` },
{ text: '🟢 Long $1000', callback_data: `paper_long_${symbol}_1000` }
],
[
{ text: '🔴 Short $5', callback_data: `paper_short_${symbol}_5` },
{ text: '🔴 Short $10', callback_data: `paper_short_${symbol}_10` },
{ text: '🔴 Short $20', callback_data: `paper_short_${symbol}_20` }
],
[
{ text: '🔴 Short $50', callback_data: `paper_short_${symbol}_50` },
{ text: '🔴 Short $100', callback_data: `paper_short_${symbol}_100` },
{ text: '🔴 Short $1000', callback_data: `paper_short_${symbol}_1000` }
],
[
{ text: '✍️ Custom Long', callback_data: `paper_custom_long_${symbol}` },
{ text: '✍️ Custom Short', callback_data: `paper_custom_short_${symbol}` }
],
[{ text: '⏭ Skip', callback_data: `paper_skip_${symbol}_0` }]
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

module.exports = { tg, reply, replySignalCard, answerCallback, getOffset, setOffset };
