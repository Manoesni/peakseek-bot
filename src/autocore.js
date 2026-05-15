const { autoPolicy, autoRuntime, settings } = require('./state');
const { getBestPrice } = require('./prices');

const RPC = {
ETH: [
'https://rpc.ankr.com/eth',
'https://eth.llamarpc.com',
'https://ethereum.publicnode.com'
],
BASE: [
'https://mainnet.base.org',
'https://base.llamarpc.com'
],
BNB: [
'https://bsc-dataseed.binance.org',
'https://bsc.publicnode.com'
],
ARB: [
'https://arb1.arbitrum.io/rpc',
'https://arbitrum.llamarpc.com'
],
SOL: [
'https://api.mainnet-beta.solana.com'
]
};

function isLikelyEvm(addr) {
return /^0x[a-fA-F0-9]{40}$/.test(addr || '');
}
function isLikelySol(addr) {
return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr || '');
}

async function evmNativeBalanceFromRpc(rpcUrl, address) {
const body = {
jsonrpc: '2.0',
id: 1,
method: 'eth_getBalance',
params: [address, 'latest']
};
const r = await fetch(rpcUrl, {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify(body)
});
if (!r.ok) return null;
const j = await r.json();
const hex = j?.result;
if (typeof hex !== 'string') return null;
const wei = BigInt(hex);
return Number(wei) / 1e18;
}

async function evmNativeBalanceWithFallback(chain, address) {
const list = RPC[chain] || [];
for (const rpc of list) {
try {
const b = await evmNativeBalanceFromRpc(rpc, address);
if (Number.isFinite(b)) return { balance: b, rpc };
} catch {}
}
return null;
}

async function solNativeBalance(address) {
for (const rpc of RPC.SOL) {
try {
const body = {
jsonrpc: '2.0',
id: 1,
method: 'getBalance',
params: [address]
};
const r = await fetch(rpc, {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify(body)
});
if (!r.ok) continue;
const j = await r.json();
const lamports = Number(j?.result?.value);
if (!Number.isFinite(lamports)) continue;
return { balance: lamports / 1e9, rpc };
} catch {}
}
return null;
}

async function usdOfNative(symbol, amount) {
try {
const px = await getBestPrice(symbol);
const p = Number(px?.price);
if (!Number.isFinite(p)) return null;
return amount * p;
} catch {
return null;
}
}

function setStatus(chain, ok, reason) {
autoRuntime.gasStatus[chain] = { ok: !!ok, reason: reason || (ok ? 'ok' : 'not ready') };
}

function mapChainToPolicy(chainRaw) {
const c = String(chainRaw || '').toUpperCase();
if (c.includes('ETH')) return 'ETH';
if (c.includes('BASE')) return 'BASE';
if (c.includes('BSC') || c.includes('BNB')) return 'BNB';
if (c.includes('ARB')) return 'ARB';
if (c.includes('SOL')) return 'SOL';
if (c.includes('TRON')) return 'ETH';
return 'ETH';
}

async function makeReason(chain, bal, min, unit) {
const need = Math.max(0, min - bal);
const priceSym = chain === 'BNB' ? 'BNB' : chain === 'SOL' ? 'SOL' : 'ETH';
const balUsd = await usdOfNative(priceSym, bal);
const needUsd = await usdOfNative(priceSym, need);

const balUsdTxt = Number.isFinite(balUsd) ? ` (~$${balUsd.toFixed(2)})` : '';
const needTxt = need > 0
? ` | need ${need.toFixed(5)} ${unit}${Number.isFinite(needUsd) ? ` (~$${needUsd.toFixed(2)})` : ''}`
: '';

return `${bal.toFixed(5)} ${unit} (min ${min})${balUsdTxt}${needTxt}`;
}

async function refreshGasStatus() {
const evm = settings.wallets.evm;
const sol = settings.wallets.sol;

if (!isLikelyEvm(evm)) {
setStatus('ETH', false, 'EVM wallet missing');
setStatus('BASE', false, 'EVM wallet missing');
setStatus('BNB', false, 'EVM wallet missing');
setStatus('ARB', false, 'EVM wallet missing');
} else {
const [ethObj, baseObj, bnbObj, arbObj] = await Promise.all([
evmNativeBalanceWithFallback('ETH', evm),
evmNativeBalanceWithFallback('BASE', evm),
evmNativeBalanceWithFallback('BNB', evm),
evmNativeBalanceWithFallback('ARB', evm)
]);
const eMin = Number(autoPolicy.gasMin.ETH || 0);
const bMin = Number(autoPolicy.gasMin.BASE || 0);
const bnMin = Number(autoPolicy.gasMin.BNB || 0);
const aMin = Number(autoPolicy.gasMin.ARB || 0);

if (!ethObj) setStatus('ETH', false, 'RPC error (all providers)');
else setStatus('ETH', ethObj.balance >= eMin, await makeReason('ETH', ethObj.balance, eMin, 'ETH'));

if (!baseObj) setStatus('BASE', false, 'RPC error (all providers)');
else setStatus('BASE', baseObj.balance >= bMin, await makeReason('BASE', baseObj.balance, bMin, 'ETH'));

if (!bnbObj) setStatus('BNB', false, 'RPC error (all providers)');
else setStatus('BNB', bnbObj.balance >= bnMin, await makeReason('BNB', bnbObj.balance, bnMin, 'BNB'));

if (!arbObj) setStatus('ARB', false, 'RPC error (all providers)');
else setStatus('ARB', arbObj.balance >= aMin, await makeReason('ARB', arbObj.balance, aMin, 'ETH'));
}

if (!isLikelySol(sol)) {
setStatus('SOL', false, 'SOL wallet missing');
} else {
const solObj = await solNativeBalance(sol);
const sMin = Number(autoPolicy.gasMin.SOL || 0);
if (!solObj) setStatus('SOL', false, 'RPC error');
else setStatus('SOL', solObj.balance >= sMin, await makeReason('SOL', solObj.balance, sMin, 'SOL'));
}
}

function canAutoTrade(chainRaw) {
if (!autoPolicy.enabled) return { ok: false, reason: 'autocore disabled' };

const chain = mapChainToPolicy(chainRaw);

// Paper mode: ignore wallet/gas checks entirely
if (autoPolicy.mode === 'paper') {
if (!autoPolicy.chainsEnabled[chain]) return { ok: false, reason: `chain ${chain} disabled` };
if (autoRuntime.spentTodayUsd + autoPolicy.perTradeUsd > autoPolicy.dailyMaxUsd) {
return { ok: false, reason: 'daily budget cap reached' };
}
return { ok: true, chain, paperBypassGas: true };
}

// Live mode: enforce gas checks
if (!autoPolicy.chainsEnabled[chain]) return { ok: false, reason: `chain ${chain} disabled` };

const g = autoRuntime.gasStatus[chain];
if (!g?.ok) return { ok: false, reason: `gas not ready for ${chain}` };

if (autoRuntime.spentTodayUsd + autoPolicy.perTradeUsd > autoPolicy.dailyMaxUsd) {
return { ok: false, reason: 'daily budget cap reached' };
}

return { ok: true, chain };
}

function policyAmount(requested) {
if (!autoPolicy.enabled) return Number(requested || 0);
return Math.min(Number(requested || 0), Number(autoPolicy.perTradeUsd || 0));
}

function consumePolicyBudget(amount) {
if (!autoPolicy.enabled) return;
autoRuntime.spentTodayUsd += Number(amount || 0);
}

function rollbackPolicyBudget(amount) {
if (!autoPolicy.enabled) return;
autoRuntime.spentTodayUsd -= Number(amount || 0);
if (autoRuntime.spentTodayUsd < 0) autoRuntime.spentTodayUsd = 0;
}

module.exports = {
refreshGasStatus,
canAutoTrade,
policyAmount,
consumePolicyBudget,
rollbackPolicyBudget,
mapChainToPolicy
};
