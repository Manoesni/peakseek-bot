const { reply } = require('../telegram');
const { risk, settings, executionTuning } = require('../state');
const { openPaperPosition } = require('./paper');
const { fmtAdaptive } = require('../indicators');
const { getBestPrice } = require('../prices');
const { canAutoTrade, policyAmount, consumePolicyBudget, rollbackPolicyBudget } = require('../autocore');

function guardLevels(entry, stop, tp1, tp2) {
const minDist = entry * 0.003; // wider min distance
if (Math.abs(entry - stop) < minDist) stop = entry - minDist;
if (Math.abs(tp1 - entry) < minDist) tp1 = entry + minDist;
if (Math.abs(tp2 - entry) < minDist * 2) tp2 = entry + minDist * 2;
return { stop, tp1, tp2 };
}

async function handleDexpick(chatId, parts) {
if (parts.length < 3) {
await reply(chatId, 'Usage: /dexpick <TOKEN> <amount>');
return;
}

const token = parts[1].toUpperCase();
const requestedAmount = Number(parts[2]);
if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
await reply(chatId, 'Amount must be a positive number.');
return;
}

const chainLocked = parts[3] || null;
const pairLocked = parts[4] || null;
const priceLocked = Number(parts[5]);
const chgHint = Number(parts[6]); // optional 24h change from autopicker

const gate = canAutoTrade(chainLocked || 'ETH');
if (!gate.ok) {
await reply(chatId, `🚫 AutoCore block: ${gate.reason}`);
return;
}

// anti-churn entry filter
if (Number.isFinite(chgHint) && Math.abs(chgHint) < Number(executionTuning.minMovePctToEnterDex || 0.8)) {
await reply(chatId, `⏭ Skip ${token}: move too small (${chgHint.toFixed(2)}% < ${executionTuning.minMovePctToEnterDex}%).`);
return;
}

const amount = policyAmount(requestedAmount);
if (amount <= 0) {
await reply(chatId, '🚫 AutoCore perTradeUsd is zero.');
return;
}

let entry = null;
let source = 'DEX';
let chain = chainLocked;
let pairAddress = pairLocked;

if (Number.isFinite(priceLocked) && priceLocked > 0 && chainLocked && pairLocked) {
entry = priceLocked;
} else {
const px = await getBestPrice(token);
if (!px || !Number.isFinite(px.price)) {
await reply(chatId, `No live price found for ${token}.`);
return;
}
entry = px.price;
source = px.source;
chain = chain || px.chain || null;
pairAddress = pairAddress || px.pairAddress || null;
}

let stop = entry * (1 - Number(executionTuning.dexStopPctTight || risk.dexStopPct) / 100);
let tp1 = entry * (1 + Number(executionTuning.dexTp1Pct || 12) / 100);
let tp2 = entry * (1 + Number(executionTuning.dexTp2Pct || 24) / 100);
const trailingArm = entry * 1.02;

({ stop, tp1, tp2 } = guardLevels(entry, stop, tp1, tp2));

const lev = Number(settings.leverage?.dex || 3) || 3;

consumePolicyBudget(amount);
const ok = await openPaperPosition(chatId, 'long', token, lev, amount, {
stop, tp1, tp2, trailingArm, forcedEntry: entry, forcedSource: source, forcedChain: chain, forcedPairAddress: pairAddress
});
if (!ok) {
rollbackPolicyBudget(amount);
return;
}
await reply(
chatId,
`🧪 DEX paper pick opened
Token: ${token}
Leverage: ${lev}x
Amount: $${fmtAdaptive(amount)}
Entry: $${fmtAdaptive(entry)}
Chain: ${chain || 'n/a'}
Pair: ${pairAddress || 'n/a'}
Plan:
• SL: $${fmtAdaptive(stop)}
• TP1: $${fmtAdaptive(tp1)}
• TP2: $${fmtAdaptive(tp2)}
• Trailing arm: $${fmtAdaptive(trailingArm)}`
);
}

module.exports = { handleDexpick };
