const { TG } = require('./config');

let offset = 0;

function replyKeyboard() {
return JSON.stringify({
keyboard: [
  [{ text: '📊 /trial' }, { text: '📌 /positions' }, { text: '💰 /portfolio' }],
  [{ text: '🪙 /spot' }, { text: '🐋 /whale' }, { text: '📢 /social' }],
  [{ text: '🤖 /auto on' }, { text: '⏸ /auto off' }, { text: '🛑 /paper closeall' }],
  [{ text: '🚀 /open' }, { text: '🆘 /help' }]
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

/**
 * Send a message with inline buttons.
 * @param {string|number} chatId
 * @param {string} text
 * @param {Array} buttons - Array of rows, each row is array of { text, callback_data }
 */
async function replyWithButtons(chatId, text, buttons) {
return tg('sendMessage', {
chat_id: String(chatId),
text,
parse_mode: 'Markdown',
reply_markup: JSON.stringify({ inline_keyboard: buttons }),
});
}

/**
 * Send a plain message with parse_mode Markdown (for `code` formatting).
 */
async function replyMd(chatId, text) {
return tg('sendMessage', {
chat_id: String(chatId),
text,
parse_mode: 'Markdown',
reply_markup: replyKeyboard(),
});
}

/**
 * Send a clean message with no persistent keyboard (for user-facing flows).
 */
async function replyClean(chatId, text) {
return tg('sendMessage', {
chat_id: String(chatId),
text,
parse_mode: 'Markdown',
reply_markup: JSON.stringify({ remove_keyboard: true }),
});
}

function getOffset() { return offset; }
function setOffset(v) { offset = v; }

module.exports = { tg, reply, replyMd, replyClean, replyWithButtons, replySignalCard, answerCallback, getOffset, setOffset };
