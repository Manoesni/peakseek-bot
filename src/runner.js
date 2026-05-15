const { portfolio, autoPolicy, smartExit, persistNow } = require('./state');
const { getBestPrice } = require('./prices');
const { closePaperPosition } = require('./commands/paper');
const { setLastAutoAction } = require('./commands/live');

const runner = {
enabled: false,
intervalMs: 5000,
loopHandle: null
};

function setSemiEnabled(v) {
runner.enabled = !!v;
}

function getSemiStatus() {
return { enabled: runner.enabled, intervalMs: runner.intervalMs };
}

function ageSec(pos) {
return (Date.now() - Number(pos.openedAt || 0)) / 1000;
}

function pnlPct(pos, price) {
const entry = Number(pos.entry || 0);
if (!entry) return 0;
const side = String(pos.side || 'long').toLowerCase();
const move = side === 'short' ? (entry - price) / entry : (price - entry) / entry;
const lev = Number(pos.leverage || pos.lev || 3);
return move * lev * 100;
}

async function tickAutoExits(chatIdForLogs = null) {
if (!runner.enabled) return;
const rows = [...(portfolio.positions || [])];
if (!rows.length) return;

const cfg = {
minHoldSec: Number(smartExit?.minHoldSec || 45),
maxHoldSec: Number(smartExit?.maxHoldSec || 240),
weakPnLPctCut: Number(smartExit?.weakPnLPctCut || -0.35),
armTrailPnLPct: Number(smartExit?.armTrailPnLPct || 0.45),
trailDrawdownPct: Number(smartExit?.trailDrawdownPct || 0.20)
};

for (const p of rows) {
try {
const px = await getBestPrice(p.symbol, {
pairAddress: p.pairAddress || null,
sourceLock: p.priceSource || null,
strict: true,
chainHint: p.chain || null
});

const price = Number(px?.price);
if (!Number.isFinite(price) || price <= 0) continue;

const sec = ageSec(p);
const pp = pnlPct(p, price);

// hard SL / TP2 always respected
if (p.stop != null && price <= Number(p.stop)) {
setLastAutoAction(`SL ${p.symbol}`);
await closePaperPosition(chatIdForLogs || p.chatId || 0, p.symbol, 'SL');
continue;
}
if (p.tp2 != null && price >= Number(p.tp2)) {
setLastAutoAction(`TP2 ${p.symbol}`);
await closePaperPosition(chatIdForLogs || p.chatId || 0, p.symbol, 'TP2');
continue;
}

// Smart Exit: only after minimum hold
if (sec >= cfg.minHoldSec) {
// weak trade cut earlier (reduce fat losses)
if (pp <= cfg.weakPnLPctCut) {
setLastAutoAction(`AI_CUT ${p.symbol}`);
await closePaperPosition(chatIdForLogs || p.chatId || 0, p.symbol, 'AI_CUT');
continue;
}

// arm trailing once enough positive edge
if (!p.trailingOn && pp >= cfg.armTrailPnLPct) {
p.trailingOn = true;
p.highest = price;
p.trailingStop = price * (1 - cfg.trailDrawdownPct / 100);
setLastAutoAction(`AI_TRAIL_ARM ${p.symbol}`);
}

// update trailing
if (p.trailingOn) {
p.highest = Math.max(Number(p.highest || price), price);
const nextStop = p.highest * (1 - cfg.trailDrawdownPct / 100);
p.trailingStop = Math.max(Number(p.trailingStop || 0), nextStop);

if (price <= Number(p.trailingStop || 0)) {
setLastAutoAction(`TRAIL ${p.symbol}`);
await closePaperPosition(chatIdForLogs || p.chatId || 0, p.symbol, 'TRAIL');
continue;
}
}
}

// time fallback only at hard max hold
if (sec >= cfg.maxHoldSec) {
setLastAutoAction(`TIME_EXIT ${p.symbol}`);
await closePaperPosition(chatIdForLogs || p.chatId || 0, p.symbol, 'TIME');
continue;
}
} catch {}
}
}

function startSemiLoop(chatIdForLogs = null) {
if (runner.loopHandle) clearInterval(runner.loopHandle);
runner.loopHandle = setInterval(() => {
tickAutoExits(chatIdForLogs).catch(() => {});
}, runner.intervalMs);
}

module.exports = { runner, setSemiEnabled, getSemiStatus, startSemiLoop, tickAutoExits };
