const risk = {
tier: 'safe',
riskPct: 0.5,
dailyMaxLossPct: 2.0,
maxOpen: 2
};

const settings = {
mode: 'manual', // manual | semi | full
wallets: {
evm: null,
sol: null
},
budgets: {
ETH: 0,
BASE: 0,
BNB: 0,
ARB: 0,
SOL: 0
}
};

const portfolio = {
balance: 1000,
positions: [], // open positions
closed: [] // closed trades history
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

module.exports = { risk, settings, portfolio, RISK_PRESETS, getNextPosId };
