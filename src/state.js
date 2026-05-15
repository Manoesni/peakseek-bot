const risk = {
tier: 'safe',
riskPct: 0.5,
dailyMaxLossPct: 2.0,
maxOpen: 2,
dexStopPct: 12,
dexTpPct: 25
};

const settings = {
mode: 'manual', // manual | semi | full
wallets: { evm: null, sol: null },
budgets: { ETH: 0, BASE: 0, BNB: 0, ARB: 0, SOL: 0 },
filters: {
minConfidence: 56,
minTrendPct: 0.15,
noTradeTrendPct: 0.10,
minTierForExecution: 'C'
},
leverage: { majors: 5, dex: 2 },
majors: ['BTC', 'ETH', 'SOL']
};

// Auto Core policy (future full-auto)
const autoPolicy = {
enabled: false,
mode: 'paper', // paper | live
perTradeUsd: 5,
dailyMaxUsd: 200,
maxOpen: 4,
chainsEnabled: {
ETH: true,
BASE: true,
BNB: true,
ARB: true,
SOL: true
},
gasMin: {
ETH: 0.003,
BASE: 0.002,
BNB: 0.005,
ARB: 0.002,
SOL: 0.03
}
};

// Runtime status caches for auto-core
const executionTuning = {
 minHoldMs: 60000,
 minMovePctToEnterDex: 1.5,
 dexStopPctTight: 3.5,
 dexTp1Pct: 6.0,
 dexTp2Pct: 12.0
};

const autoRuntime = {
startedAt: null,
spentTodayUsd: 0,
gasStatus: {
ETH: { ok: false, reason: 'unknown' },
BASE: { ok: false, reason: 'unknown' },
BNB: { ok: false, reason: 'unknown' },
ARB: { ok: false, reason: 'unknown' },
SOL: { ok: false, reason: 'unknown' }
}
};

const pendingInput = new Map();
const dexPickCache = new Map();
const priceGuardCache = new Map();

const portfolio = {
balance: 10000,
positions: [],
closed: []
};

const trial = {
active: false,
startedAt: null,
startBalance: 10000,
trades: 0,
wins: 0,
losses: 0,
totalPnl: 0,
grossWin: 0,
grossLossAbs: 0,
reserve: 0,         // locked profit — 20% of every win, never risked again
reservePct: 0.20,   // configurable reserve rate
};

let nextPosId = 1;

const RISK_PRESETS = {
safe: { riskPct: 0.5, dailyMaxLossPct: 2.0, maxOpen: 2 },
balanced: { riskPct: 1.0, dailyMaxLossPct: 4.0, maxOpen: 2 },
aggressive: { riskPct: 2.0, dailyMaxLossPct: 7.0, maxOpen: 2 }
};

function getNextPosId() {
return nextPosId++;
}

const smartAi = {
 enabled: true,
 minScoreToTrade: 55,
 minLiquidityUsd: 50000,
 minAbsChange24hPct: 0.5,
 maxSpreadPct: 1.5
};

const smartExit = {
 enabled: true,
 minHoldSec: 120,
 maxHoldSec: 14400,
 weakPnLPctCut: -4.0,
 armTrailPnLPct: 3.0,
 trailDrawdownPct: 1.2
};

const lossCooldown = { bySymbol: {}, byPair: {}, minutes: 30 };

const { saveState, loadState } = require('./persist');
const _state = { portfolio, trial, autoPolicy, autoRuntime, settings, smartExit, smartAi, lossCooldown };
const _runnerEnabled = false;

function persistNow() { saveState({ portfolio, trial, autoPolicy, autoRuntime, settings, smartExit, smartAi, lossCooldown, _runnerEnabled: global._runnerEnabled || false }); }
function bootLoad()   { loadState({ portfolio, trial, autoPolicy, autoRuntime, settings, smartExit, smartAi, lossCooldown }); }

module.exports = { lossCooldown,  smartExit,  smartAi,  executionTuning, 
risk, settings, portfolio, trial, RISK_PRESETS, getNextPosId,
pendingInput, dexPickCache, priceGuardCache,
autoPolicy, autoRuntime,
  persistNow, bootLoad
};
