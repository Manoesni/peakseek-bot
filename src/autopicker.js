'use strict';
const { runScan } = require('./scanner');
const { autoPolicy, autoRuntime, portfolio, smartAi, lossCooldown } = require('./state');
const { canAutoTrade } = require('./autocore');
const { handleDexpick } = require('./commands/dexpick');

let lastPickAt = 0;
const PICK_COOLDOWN_MS = 45000;
const SYMBOL_COOLDOWN_MS = 20 * 60 * 1000;
const symbolLastPickAt = new Map();

const PRICE_BANDS = {
  BTC: [10000, 200000],
  ETH: [500, 20000],
  BNB: [50, 5000],
  SOL: [5, 1000],
  ARB: [0.1, 10],
  LINK: [1, 200],
  TRX: [0.01, 5],
  DOGE: [0.01, 2],
  PEPE: [0.00000001, 0.1],
  FLOKI: [0.00000001, 0.1]
};

function isPriceSane(symbol, price) {
  const b = PRICE_BANDS[String(symbol || '').toUpperCase()];
  if (!b) return true;
  return price >= b[0] && price <= b[1];
}

function chainToPolicy(chainRaw = '') {
  const c = String(chainRaw).toUpperCase();
  if (c.includes('ETH')) return 'ETH';
  if (c.includes('BASE')) return 'BASE';
  if (c.includes('BSC') || c.includes('BNB')) return 'BNB';
  if (c.includes('ARB')) return 'ARB';
  if (c.includes('SOL')) return 'SOL';
  return null;
}

function isValidSymbolChain(symbolRaw = '', chainRaw = '') {
  const s = String(symbolRaw).toUpperCase();
  const c = String(chainRaw).toLowerCase();
  const isEth = c.includes('ethereum');
  const isBsc = c.includes('bsc') || c.includes('binance');
  const isBase = c.includes('base');
  const isArb = c.includes('arbitrum');
  const isSol = c.includes('solana');

  if (s === 'BNB' && !isBsc) return false;
  if (s === 'SOL' && !isSol) return false;
  if (s === 'ARB' && !isArb) return false;
  if (s === 'ETH' && !(isEth || isBsc || isBase || isArb)) return false;

  return true;
}

function canOpenMore() {
return (portfolio.positions || []).length < Number(autoPolicy.maxOpen || 2);
}
function alreadyOpenPair(pairAddress) {
  return (portfolio.positions || []).some(p => p.pairAddress && p.pairAddress === pairAddress);
}
function alreadyOpenSymbol(sym) {
  return (portfolio.positions || []).some(p => String(p.symbol || '').toUpperCase() === String(sym || '').toUpperCase());
}

async function runAutoPickOnce(chatIdForLogs = null, force = false) {
  if (!autoPolicy.enabled) return { ok: false, message: 'AutoCore disabled.' };
  if (!canOpenMore()) return { ok: false, message: `AutoCore maxOpen reached (${autoPolicy.maxOpen}).` };

  const now = Date.now();
  if (!force && now - lastPickAt < PICK_COOLDOWN_MS) return { ok: false, message: 'Auto picker cooldown active.' };

  const rows = await runScan({
    minScore: Number(smartAi?.minScoreToTrade || 55),
    maxResults: 30,
    includeSolana: false,
    includeEvm: true,
    includeNewListings: true,
    includeHyperliquid: false // Hyperliquid signals only, no direct trading there yet
  });
  if (!rows.length) return { ok: false, message: 'No candidates from scanner.' };

  for (const r of rows) {
    const policyChain = chainToPolicy(r.chain || '');
    if (!policyChain) continue;

    const sym = String(r.symbol || r.token || '').toUpperCase();
    const lastTs = Number(symbolLastPickAt.get(sym) || 0);
    const nowTs = Date.now();
    const symLock = Number(lossCooldown?.bySymbol?.[sym] || 0);
    const pairLock = Number(lossCooldown?.byPair?.[String(r.pairAddress)] || 0);

    if (alreadyOpenPair(r.pairAddress) || alreadyOpenSymbol(sym) || (Date.now() - lastTs < SYMBOL_COOLDOWN_MS) || nowTs < symLock || nowTs < pairLock) continue;

    const gate = canAutoTrade(policyChain);
    if (!gate.ok) continue;

    const beforeCount = (portfolio.positions || []).length;
    const beforeSpent = Number(autoRuntime.spentTodayUsd || 0);

    await handleDexpick(chatIdForLogs || 0, [
      '/dexpick', sym, String(autoPolicy.perTradeUsd), r.chain, r.pairAddress, String(r.priceUsd), String(r.chg24h || r.chg || 0)
    ]);

    const afterCount = (portfolio.positions || []).length;
    if (afterCount > beforeCount) {
      lastPickAt = Date.now();
      symbolLastPickAt.set(sym, Date.now());
      return { ok: true, message: `🤖 Auto pick opened: ${r.symbol || r.token} (${r.chain}) score ${r.score}` };
    }

    if (Number(autoRuntime.spentTodayUsd || 0) > beforeSpent) autoRuntime.spentTodayUsd = beforeSpent;
  }

  return { ok: false, message: 'No eligible candidates after policy filters.' };
}

module.exports = { runAutoPickOnce };
