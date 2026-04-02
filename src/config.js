const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const token = (env.match(/TELEGRAM_BOT_TOKEN=(.*)/) || [])[1]?.trim();
if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');

module.exports = {
token,
TG: `https://api.telegram.org/bot${token}`
};
