const risk = {
tier: 'safe',
riskPct: 0.5,
dailyMaxLossPct: 2.0,
maxOpen: 2
};

const portfolio = {
balance: 1000,
positions: []
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

module.exports = { risk, portfolio, RISK_PRESETS, getNextPosId };
