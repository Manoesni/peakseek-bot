const { tg } = require('../telegram');

async function handleStart(chatId) {
  await tg('sendMessage', {
    chat_id: chatId,
    text: `⛰️ *PeakSeek* — use /start to set up your account.`,
    parse_mode: 'Markdown',
    reply_markup: JSON.stringify({ remove_keyboard: true }),
  });
}

module.exports = { handleStart };
