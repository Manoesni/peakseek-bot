const { settings, portfolio } = require('./state');
const { getMids } = require('./hyperliquid');
const { closePaperPosition } = require('./commands/paper');

const runner = {
enabled: false,
symbols: ['BTC', 'ETH', 'SOL', 'ARB', 'BNB'],
intervalMs: 30000,
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

async function tickAutoExits(chatIdForLogs = null, replyFn = null) {
if (!runner.enabled) return;
if (!portfolio.positions.length) return;

const mids = await getMids();

for (const p of [...portfolio.positions]) {
const px = Number(mids?.[p.symbol]);
if (!Number.isFinite(px)) continue;

// Simple TP/SL model from stored plan if exists
const tp = p.tp1;
const sl = p.stop;
if (!Number.isFinite(tp) || !Number.isFinite(sl)) continue;

const hitTp = p.side === 'long' ? px >= tp : px <= tp;
const hitSl = p.side === 'long' ? px <= sl : px >= sl;

if (hitTp || hitSl) {
await closePaperPosition(chatIdForLogs || p.chatId || 0, p.symbol);
if (replyFn && chatIdForLogs) {
await replyFn(chatIdForLogs, `🤖 Semi-auto exit ${p.symbol}: ${hitTp ? 'TP hit' : 'SL hit'}`);
}
}
}
}

function startSemiLoop(chatIdForLogs = null, replyFn = null) {
if (runner.loopHandle) clearInterval(runner.loopHandle);
runner.loopHandle = setInterval(() => {
tickAutoExits(chatIdForLogs, replyFn).catch(() => {});
}, runner.intervalMs);
}

module.exports = { runner, setSemiEnabled, getSemiStatus, startSemiLoop, tickAutoExits };
