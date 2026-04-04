const risk = {
tier: 'safe',
riskPct: 0.5,
dailyMaxLossPct: 2.0,
maxOpen: 2
};

const settings = {
mode: 'manual', // manual | semi | full
wallets: { evm: null, sol: null },
budgets: { ETH: 0, BASE: 0, BNB: 0, ARB: 0, SOL: 0 },
filters: {
minConfidence: 55,
minTrendPct: 0.01 // abs((sma20-sma50)/sma50)*100
}
};

const portfolio = {
balance: 1000,
positions: [],
closed: []
};

const trial = {
active: false,
startedAt: null,
startBalance: 1000,
trades: 0,
wins: 0,
losses: 0,
totalPnl: 0,
grossWin: 0,
grossLossAbs: 0
};

let nextPosId = 1;

const RISK_PRESETS = {
safe: { riskPct: 0.5, dailyMaxLossPct: 2.0, maxOpen: 2 },
balanced: { riskPct: 1.0, dailyMaxLossPct: 4.0, maxOpen: 4 },
aggressive: { riskPct: 2.0, dailyMaxLossPct: 7.0, maxOpen: 6 }
};

function getNextPosId() {
return nextPosId++;
}

module.exports = { risk, settings, portfolio, trial, RISK_PRESETS, getNextPosId };
