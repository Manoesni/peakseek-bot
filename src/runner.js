const { portfolio } = require('./state');
const { getBestPrice } = require('./prices');
const { closePaperPosition } = require('./commands/paper');
const { setLastAutoAction } = require('./commands/live');

const runner = {
enabled: false,
symbols: ['BTC', 'ETH', 'SOL', 'ARB', 'BNB'],
intervalMs: 20000,
maxAutoMarginPerTrade: 10,
loopHandle: null
};

function setSemiEnabled(v) {
runner.enabled = !!v;
}

function getSemiStatus() {
return {
enabled: runner.enabled,
symbols: runner.symbols,
intervalMs: runner.intervalMs,
maxAutoMarginPerTrade: runner.maxAutoMarginPerTrade
};
}

async function checkAndClose(pos, price, chatIdForLogs, replyFn) {
if (Number.isFinite(price)) {
pos.highest = Math.max(pos.highest || price, price);
}

if (!pos.trailingOn && Number.isFinite(pos.trailingArm) && price >= pos.trailingArm) {
pos.trailingOn = true;
pos.trailingStop = (pos.highest || price) * 0.92;
setLastAutoAction(`TRAIL_ARM ${pos.symbol}`);
if (replyFn && chatIdForLogs) {
await replyFn(chatIdForLogs, `🛡 Trailing armed for ${pos.symbol}`);
}
}

if (pos.trailingOn) {
const nextTrail = (pos.highest || price) * 0.92;
if (!pos.trailingStop || nextTrail > pos.trailingStop) pos.trailingStop = nextTrail;
}

if (Number.isFinite(pos.stop) && price <= pos.stop) {
setLastAutoAction(`SL ${pos.symbol}`);
await closePaperPosition(chatIdForLogs || pos.chatId || 0, pos.symbol, 'SL');
return true;
}

if (pos.trailingOn && Number.isFinite(pos.trailingStop) && price <= pos.trailingStop) {
setLastAutoAction(`TRAIL ${pos.symbol}`);
await closePaperPosition(chatIdForLogs || pos.chatId || 0, pos.symbol, 'TRAIL');
return true;
}

if (Number.isFinite(pos.tp2) && price >= pos.tp2) {
setLastAutoAction(`TP2 ${pos.symbol}`);
await closePaperPosition(chatIdForLogs || pos.chatId || 0, pos.symbol, 'TP2');
return true;
}

if (Number.isFinite(pos.tp1) && price >= pos.tp1) {
pos.trailingOn = true;
const tighter = (pos.highest || price) * 0.95;
if (!pos.trailingStop || tighter > pos.trailingStop) pos.trailingStop = tighter;
setLastAutoAction(`TP1_TOUCH ${pos.symbol}`);
}

return false;
}

async function tickAutoExits(chatIdForLogs = null, replyFn = null) {
if (!runner.enabled) return;
if (!portfolio.positions.length) return;

for (const p of [...portfolio.positions]) {
const px = await getBestPrice(p.symbol);
const price = Number(px?.price);
if (!Number.isFinite(price)) continue;
await checkAndClose(p, price, chatIdForLogs, replyFn);
}
}

function startSemiLoop(chatIdForLogs = null, replyFn = null) {
if (runner.loopHandle) clearInterval(runner.loopHandle);
runner.loopHandle = setInterval(() => {
tickAutoExits(chatIdForLogs, replyFn).catch(() => {});
}, runner.intervalMs);
}

module.exports = { runner, setSemiEnabled, getSemiStatus, startSemiLoop, tickAutoExits };
