const { tg } = require('../telegram');

const MINI_APP_URL = process.env.PEAKSEEK_MINIAPP_URL || 'https://example.com/peakseek';

async function handleOpen(chatId) {
await tg('sendMessage', {
chat_id: String(chatId),
text: `🧭 PeakSeek Mini App\nOpen the app window to manage wallets, modes, and workflows.`,
reply_markup: JSON.stringify({
inline_keyboard: [
[{ text: '🚀 Open PeakSeek App', web_app: { url: MINI_APP_URL } }]
]
})
});
}

module.exports = { handleOpen };
