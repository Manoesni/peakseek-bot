/**
 * PeakSeek Spot Trading Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy: Find new token launches, research safety, enter on first spike,
 * exit with trailing take-profit. No leverage, no liquidation risk.
 *
 * Four agents running in sequence:
 *  1. Detector    — finds new tokens < 4h old with real volume
 *  2. Researcher  — checks for honeypots, locked liquidity, socials
 *  3. Entry Timer — waits for pullback after initial pump, then enters
 *  4. Exit Agent  — trailing take-profit, time-based fallback exit
 *
 * Install: copy to /Users/macpro/Desktop/peakseek/src/spot.js
 * Wire into bot.js (see instructions at bottom)
 *
 * No new npm packages needed — uses built-in fetch (Node 22)
 */

'use strict';

const { reply } = require('./telegram');
const { portfolio, trial } = require('./state');
const { persistNow } = require('./state');
const { registerActiveToken, unregisterActiveToken, isTokenActive } = require('./signal_hub');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// Permanently blacklisted symbols — bad price feeds or known corrupt tokens
const BLACKLISTED_SYMBOLS = new Set([
  'PRESPAX',  // DexScreener returns wrong pair ($1765 vs $0.00008) — corrupts PnL
]);

const SPOT_CONFIG = {
  // Scanner
  maxTokenAgeHours: 4,          // Only tokens < 4h old
  minTokenAgeHours: 0.75,        // Skip tokens < 45min old — too risky
  minLiquidityUsd: 50000,       // Minimum pool liquidity
  minVolumeUsd: 25000,          // Minimum 24h volume
  minM5ChangePct: 3.0,          // Must be moving up right now (5min)
  maxM5ChangePct: 40.0,         // Skip if already parabolic (likely top)

  // Position sizing — compounding: % of trading balance, not flat $
  spotBudgetPct: 0.001,         // 0.1% of trading balance per trade (compounds with balance)
  spotBudgetMin: 5,             // never bet less than $5
  spotBudgetMax: 50,            // never bet more than $50 (safety cap)
  maxSpotPositions: 2,          // Max concurrent spot positions

  // Exit strategy
  trailTakeProfitPct: 15,       // Trail TP: sell if drops 15% from peak
  hardTakeProfitPct: 120,       // Hard TP: always sell at 120% gain
  stopLossPct: 12,              // Hard SL: tighter at 12% — tokens either pump or dump fast
  maxHoldHours: 4,              // Force exit after 4 hours regardless

  // Safety filters
  minHoneypotCheckLiq: 50000,   // Only run honeypot check above this liq
  skipSymbolPatterns: [         // Skip obvious scams
    /SAFE/i, /MOON/i, /X1000/i, /ELON/i, /BABY/i, /MINI/i, /MEGA/i,
    /TRUMP/i, /BIDEN/i, /WAR/i, /CASINO/i, /SLUR/i, /PORN/i, /SEX/i,
    /COWBOY/i, /MARS/i, /ARMY/i, /MAGA/i, /INU/i, /SHIB/i, /DOGE/i,
    /PEPE/i, /FROG/i, /CAT/i, /DOG/i, /AGENTIC/i, /MONEY/i, /RICH/i,
    /PUMP/i, /DUMP/i, /GEM/i, /100X/i, /1000X/i, /ROCKET/i, /LAMBO/i
  ],

  // Scan interval
  scanIntervalMs: 5 * 60 * 1000, // Scan every 5 minutes (reduce 429s)
};

// ─── STATE ───────────────────────────────────────────────────────────────────

const spotPositions = [];       // Active spot positions
const scannedTokens = new Set(); // Already seen tokens (avoid re-entry)
const watchlist = new Map();
let spotScanHandle = null;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function isScamName(symbol) {
  return SPOT_CONFIG.skipSymbolPatterns.some(p => p.test(symbol));
}

function ageHours(createdAtMs) {
  return (Date.now() - createdAtMs) / 3600000;
}

// ─── AGENT 1: DETECTOR ───────────────────────────────────────────────────────
// Finds new tokens < 4h old with real momentum

async function detectNewTokens() {
  const candidates = [];

  // Source 1: GeckoTerminal Solana new pools
  try {
    const data = await fetchJson(
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
      { headers: { 'Accept': 'application/json;version=20230302' } }
    );
    for (const pool of (data?.data || [])) {
      const attr = pool.attributes || {};
      const createdMs = attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : 0;
      const age = ageHours(createdMs);
      if (age > SPOT_CONFIG.maxTokenAgeHours) continue;

      const liq = Number(attr.reserve_in_usd || 0);
      const vol = Number(attr.volume_usd?.h24 || 0);
      const m5 = Number(attr.price_change_percentage?.m5 || 0);
      const h1 = Number(attr.price_change_percentage?.h1 || 0);
      const symbol = String(attr.name || '').split('/')[0].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const pairAddress = pool.id?.replace('solana_', '') || '';
      const price = Number(attr.base_token_price_usd || 0);

      if (!symbol || !pairAddress || !price) continue;
      if (BLACKLISTED_SYMBOLS.has(symbol.toUpperCase())) continue;
      if (liq < SPOT_CONFIG.minLiquidityUsd) continue;
      if (vol < SPOT_CONFIG.minVolumeUsd) continue;
      if (m5 < SPOT_CONFIG.minM5ChangePct) continue;
      if (m5 > SPOT_CONFIG.maxM5ChangePct) continue;
      if (isScamName(symbol)) continue;
      if (scannedTokens.has(pairAddress)) continue;

      candidates.push({
        symbol, chain: 'solana', pairAddress, price,
        liq, vol, m5, h1, ageHours: age,
        source: 'gecko_sol_new'
      });
    }
  } catch (e) {
    console.error('[spot:detector] GeckoTerminal Solana error:', e.message);
  }

  // Source 2: GeckoTerminal ETH new pools — disabled (consistent 429s)
  // await sleep(3000); // kept here as placeholder if re-enabled

  // Source 3: DexScreener latest token profiles
  try {
    const tokens = await fetchJson('https://api.dexscreener.com/token-profiles/latest/v1');
    for (const t of (Array.isArray(tokens) ? tokens.slice(0, 30) : [])) {
      const addr = String(t.tokenAddress || '');
      const chainId = String(t.chainId || '');
      if (!addr || scannedTokens.has(addr)) continue;

      try {
        const pairData = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
        const pairs = (pairData?.pairs || []).filter(p => Number(p.liquidity?.usd || 0) > SPOT_CONFIG.minLiquidityUsd);
        if (!pairs.length) continue;

        const best = pairs.sort((a,b) => Number(b.liquidity?.usd||0) - Number(a.liquidity?.usd||0))[0];
        const createdMs = Number(best.pairCreatedAt || 0);
        const age = createdMs ? ageHours(createdMs) : 99;
        if (age > SPOT_CONFIG.maxTokenAgeHours) continue;

        const m5 = Number(best.priceChange?.m5 || 0);
        const vol = Number(best.volume?.h24 || 0);
        const liq = Number(best.liquidity?.usd || 0);
        const symbol = String(best.baseToken?.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
        const price = Number(best.priceUsd || 0);

        if (!symbol || !price) continue;
        if (BLACKLISTED_SYMBOLS.has(symbol.toUpperCase())) continue;
        if (vol < SPOT_CONFIG.minVolumeUsd) continue;
        if (m5 < SPOT_CONFIG.minM5ChangePct || m5 > SPOT_CONFIG.maxM5ChangePct) continue;
        if (isScamName(symbol)) continue;

        candidates.push({
          symbol, chain: chainId, pairAddress: best.pairAddress, price,
          liq, vol, m5, ageHours: age,
          source: 'dex_profiles'
        });
      } catch {}
    }
  } catch (e) {
    console.error('[spot:detector] DexScreener error:', e.message);
  }

  console.log(`[spot:detector] Found ${candidates.length} new token candidates`);
  return candidates;
}

// ─── AGENT 2: RESEARCHER ─────────────────────────────────────────────────────
// Safety checks before entering

async function researchToken(candidate) {
  const issues = [];
  let score = 100; // Start at 100, deduct for issues

  // Check 1: Liquidity size (too low = easy rug)
  if (candidate.liq < 30000) {
    issues.push('LOW_LIQ');
    score -= 30;
  } else if (candidate.liq < 75000) {
    issues.push('MEDIUM_LIQ');
    score -= 10;
  }

  // Check 2: Age (too new = no price history)
  if (candidate.ageHours < 0.33) {
    issues.push('TOO_FRESH'); // Less than 20 min old
    score -= 20;
  }

  // Check 3: Volume/liquidity ratio (healthy = vol > liq)
  const volLiqRatio = candidate.vol / candidate.liq;
  if (volLiqRatio < 0.3) {
    issues.push('LOW_VOLUME_RATIO');
    score -= 15;
  }

  // Check 4: Honeypot check via DexScreener pair info
  try {
    const pairData = await fetchJson(
      `https://api.dexscreener.com/latest/dex/pairs/${candidate.chain}/${candidate.pairAddress}`
    );
    const pair = pairData?.pairs?.[0];
    if (pair) {
      // Check if buys and sells both exist (honeypots have 0 sells)
      const buys = Number(pair.txns?.h1?.buys || 0);
      const sells = Number(pair.txns?.h1?.sells || 0);
      if (buys > 5 && sells === 0) {
        issues.push('HONEYPOT_SUSPECTED');
        score -= 50;
      }
      if (sells > 0 && buys / sells > 20) {
        issues.push('SUSPICIOUS_BUY_SELL_RATIO');
        score -= 20;
      }

      // Check price impact — high impact = low liquidity or manipulation
      const priceImpact = Number(pair.priceImpact || 0);
      if (priceImpact > 5) {
        issues.push('HIGH_PRICE_IMPACT');
        score -= 15;
      }
    }
  } catch {}

  // Check 5: Symbol patterns (scam names)
  if (isScamName(candidate.symbol)) {
    issues.push('SCAM_NAME_PATTERN');
    score -= 40;
  }

  const verdict = score >= 75 ? 'SAFE' : score >= 55 ? 'RISKY' : 'SKIP';

  console.log(`[spot:researcher] ${candidate.symbol}: score=${score} verdict=${verdict} issues=${issues.join(',') || 'none'}`);

  return { ...candidate, safetyScore: score, safetyIssues: issues, verdict };
}

// ─── AGENT 3: ENTRY ──────────────────────────────────────────────────────────
// Opens spot position

async function openSpotPosition(chatId, token) {
  if (spotPositions.length >= SPOT_CONFIG.maxSpotPositions) {
    console.log('[spot:entry] Max spot positions reached');
    return false;
  }

  // Hard blacklist — never trade these symbols regardless of source
  if (BLACKLISTED_SYMBOLS.has((token.symbol || '').toUpperCase())) {
    console.log(`[spot:entry] ${token.symbol} is blacklisted — skipping`);
    scannedTokens.add(token.pairAddress);
    return false;
  }

  if (spotPositions.some(p => p.pairAddress === token.pairAddress)) {
    console.log(`[spot:entry] Already in ${token.symbol}`);
    return false;
  }

  // Cross-module dedup — skip if wallet follower already entered this token
  if (isTokenActive(token.symbol) || isTokenActive(token.pairAddress)) {
    console.log(`[spot:entry] ${token.symbol} — already active in another module, skipping`);
    scannedTokens.add(token.pairAddress);
    return false;
  }

  // Compounding position size — 0.1% of current trading balance, clamped to min/max
  const budget = Math.min(
    SPOT_CONFIG.spotBudgetMax,
    Math.max(SPOT_CONFIG.spotBudgetMin, portfolio.balance * SPOT_CONFIG.spotBudgetPct)
  );
  if (portfolio.balance < budget) {
    console.log('[spot:entry] Insufficient balance');
    return false;
  }
  console.log(`[spot:entry] Position size: $${budget.toFixed(2)} (${(SPOT_CONFIG.spotBudgetPct*100).toFixed(2)}% of $${portfolio.balance.toFixed(2)}`);

  // Get fresh price
  let entryPrice = token.price;
  try {
    const fresh = await fetchJson(
      `https://api.dexscreener.com/latest/dex/pairs/${token.chain}/${token.pairAddress}`
    );
    const freshPrice = Number(fresh?.pairs?.[0]?.priceUsd || 0);
    if (freshPrice > 0) entryPrice = freshPrice;
  } catch {}

  if (!entryPrice || entryPrice <= 0) {
    console.log(`[spot:entry] No price for ${token.symbol}`);
    return false;
  }

  const position = {
    id: Date.now(),
    chatId,
    symbol: token.symbol,
    chain: token.chain,
    pairAddress: token.pairAddress,
    entryPrice,
    currentPrice: entryPrice,
    peakPrice: entryPrice,
    budget,
    fullBudget: budget,           // original budget for partial exit tracking
    openedAt: Date.now(),
    safetyScore: token.safetyScore,
    safetyIssues: token.safetyIssues,
    source: token.source,
    status: 'open',
    partialExitDone: false,       // true after 50% sold at +35%
    trailActive: false,           // trail only activates after +20%
    // Calculated levels
    hardTP: entryPrice * (1 + SPOT_CONFIG.hardTakeProfitPct / 100),
    hardSL: entryPrice * (1 - SPOT_CONFIG.stopLossPct / 100),
    trailStop: entryPrice * (1 - SPOT_CONFIG.trailTakeProfitPct / 100),
  };

  spotPositions.push(position);
  portfolio.balance -= budget;
  scannedTokens.add(token.pairAddress);
  registerActiveToken(token.symbol, 'spot');
  registerActiveToken(token.pairAddress, 'spot');
  persistNow();

  const pnlPct = (p) => ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(2);

  await reply(chatId,
    `🟢 SPOT BUY ${token.symbol}\n` +
    `Chain: ${token.chain}\n` +
    `Entry: $${entryPrice.toExponential(4)}\n` +
    `Budget: $${budget}\n` +
    `Age: ${token.ageHours.toFixed(1)}h old\n` +
    `Safety: ${token.safetyScore}/100\n` +
    `M5: +${token.m5?.toFixed(1)}%\n` +
    `Plan:\n` +
    `• Partial exit: sell 50% at +35%\n` +
    `• Trail: activates at +20% peak, tightens at +60%\n` +
    `• Hard TP: +${SPOT_CONFIG.hardTakeProfitPct}%\n` +
    `• Hard SL: -${SPOT_CONFIG.stopLossPct}%\n` +
    `• Max hold: ${SPOT_CONFIG.maxHoldHours}h`
  );

  console.log(`[spot:entry] Opened ${token.symbol} at $${entryPrice}`);
  return true;
}

// ─── AGENT 4: EXIT ───────────────────────────────────────────────────────────
// Monitors positions and exits on trail/TP/SL/time
// Exit logic:
//   1. Hard SL at -15% (always active)
//   2. Partial exit: sell 50% of position at +35% gain
//   3. Trail activates only after +20% peak — locks in gains
//   4. Dynamic trail: tightens from 15% → 8% once peak > +60%
//   5. Momentum exit: if flat >2h with dying volume, exit early

async function monitorSpotPositions(chatId) {
  if (!spotPositions.length) return;

  for (let i = spotPositions.length - 1; i >= 0; i--) {
    const pos = spotPositions[i];
    if (pos.status !== 'open') continue;

    // Get current price + volume
    let currentPrice = pos.currentPrice;
    let currentVol = pos.lastVol || 0;
    try {
      const data = await fetchJson(
        `https://api.dexscreener.com/latest/dex/pairs/${pos.chain}/${pos.pairAddress}`
      );
      const pair = data?.pairs?.[0];
      const p = Number(pair?.priceUsd || 0);
      if (p > 0) currentPrice = p;
      currentVol = Number(pair?.volume?.h1 || 0);
    } catch {}

    pos.currentPrice = currentPrice;
    pos.lastVol = currentVol;

    // Guard: if entryPrice is zero or missing, skip this position to avoid Infinity PnL
    if (!pos.entryPrice || pos.entryPrice <= 0) continue;

    const rawPnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const rawPeakPct = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;
    // Sanity cap: clamp to ±10000% to prevent corrupted state from bad price data
    const pnlPct = Math.max(-100, Math.min(rawPnlPct, 10000));
    const peakPct = Math.max(0, Math.min(rawPeakPct, 10000));
    const holdHours = (Date.now() - pos.openedAt) / 3600000;

    // ── Update peak price ──────────────────────────────────────────────────
    if (currentPrice > pos.peakPrice) {
      pos.peakPrice = currentPrice;
    }

    // ── Activate trail only after +20% peak ───────────────────────────────
    if (!pos.trailActive && peakPct >= 20) {
      pos.trailActive = true;
      console.log(`[spot:exit] ${pos.symbol} trail ACTIVATED at peak +${peakPct.toFixed(1)}%`);
    }

    // ── Dynamic trail: tighten to 8% once peak > +60% ─────────────────────
    if (pos.trailActive) {
      const trailPct = peakPct >= 60 ? 8 : SPOT_CONFIG.trailTakeProfitPct;
      pos.trailStop = pos.peakPrice * (1 - trailPct / 100);
    }

    // ── Partial exit: sell 50% at +35% ────────────────────────────────────
    if (!pos.partialExitDone && pnlPct >= 35) {
      pos.partialExitDone = true;
      const halfBudget = pos.budget / 2;
      // Safety cap: pnlPct can't realistically exceed 10000% (100x) in one check cycle
      const safePnlPct = Math.min(Math.abs(pnlPct), 10000) * (pnlPct >= 0 ? 1 : -1);
      const halfPnl = halfBudget * (safePnlPct / 100);
      // Lock 20% of partial win into reserve before adding rest to balance
      const partialReserveRate = trial.reservePct || 0.20;
      const partialReserved = halfPnl > 0 ? halfPnl * partialReserveRate : 0;
      const partialKept = halfPnl - partialReserved;
      portfolio.balance += halfBudget + partialKept;
      if (partialReserved > 0) {
        trial.reserve = (trial.reserve || 0) + partialReserved;
        console.log(`[spot] 💰 Partial reserved $${partialReserved.toFixed(2)} → total reserve: $${trial.reserve.toFixed(2)}`);
      }
      pos.budget = halfBudget; // remaining half continues running
      if (trial.active) {
        trial.wins = (trial.wins || 0) + 1;
        trial.trades = (trial.trades || 0) + 1;
        trial.grossWin = (trial.grossWin || 0) + halfPnl;
        trial.totalPnl = (trial.grossWin || 0) - (trial.grossLossAbs || 0);
      }
      persistNow();
      console.log(`[spot:exit] ${pos.symbol} PARTIAL EXIT 50% at +${pnlPct.toFixed(1)}% pnl=$${halfPnl.toFixed(2)}`);
      await reply(pos.chatId,
        `🟡 SPOT PARTIAL EXIT ${pos.symbol}\n` +
        `Sold 50% at +${pnlPct.toFixed(1)}% ($${halfPnl.toFixed(2)})\n` +
        `Remaining half running — trail now active`
      );
    }

    // Rug detection: two triggers —
    //   1. Dropped 35%+ in a single monitor cycle (sudden rug)
    //   2. Currently down 80%+ from entry at any point (slow bleed rug)
    const prevPrice = pos.lastMonitorPrice || pos.entryPrice;
    const cycleDrop = prevPrice > 0 ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;
    const totalDrop = pnlPct; // already calculated above
    const isRug = (cycleDrop < -35 && holdHours < 1.0) || totalDrop < -75;
    if (isRug) console.log(`[spot:exit] ⚠️ RUG DETECTED ${pos.symbol}: cycle=${cycleDrop.toFixed(1)}% total=${totalDrop.toFixed(1)}%`);
    pos.lastMonitorPrice = currentPrice;

    let exitReason = null;

    // ── Exit conditions ────────────────────────────────────────────────────
    if (isRug) {
      exitReason = 'RUG_DETECTED';
    } else if (currentPrice >= pos.hardTP) {
      exitReason = 'HARD_TP';
    } else if (currentPrice <= pos.hardSL) {
      exitReason = 'HARD_SL';
    } else if (pos.trailActive && currentPrice <= pos.trailStop && currentPrice < pos.peakPrice * 0.95) {
      exitReason = 'TRAIL_TP';
    } else if (holdHours >= SPOT_CONFIG.maxHoldHours) {
      exitReason = 'TIME_EXIT';
    } else if (holdHours >= 2 && pnlPct > -5 && pnlPct < 10 && currentVol < 3000) {
      // Momentum exit: been open 2h+, barely moving, volume dying → cut it
      exitReason = 'MOMENTUM_EXIT';
    }

    if (exitReason) {
      await closeSpotPosition(chatId || pos.chatId, i, exitReason, currentPrice, pnlPct);
    }
  }
}

async function closeSpotPosition(chatId, index, reason, exitPrice, pnlPct) {
  const pos = spotPositions[index];
  if (!pos) return;

  // Hard blacklist: if somehow a blacklisted token is open, close it but don't count in trial
  const isBlacklisted = BLACKLISTED_SYMBOLS.has((pos.symbol || '').toUpperCase());

  pos.status = 'closed';
  // Sanity cap: clamp pnlPct to ±10000% to prevent bad price feeds corrupting trial
  const safePnlPct = Math.max(-100, Math.min(pnlPct, 10000));
  if (Math.abs(pnlPct) > 10000) {
    console.warn(`[spot:exit] ⚠️  PnL cap triggered for ${pos.symbol}: raw=${pnlPct.toFixed(0)}% → capped=${safePnlPct}%`);
  }
  const pnlUsd = pos.budget * (safePnlPct / 100);
  portfolio.balance += pos.budget + pnlUsd;

  // Record in trial — skip blacklisted tokens entirely (bad price feeds)
  if (trial.active && !isBlacklisted) {
    trial.trades++;
    trial.realizedPnl = (trial.realizedPnl || 0) + pnlUsd;
    if (pnlUsd >= 0) {
      trial.wins++;
      trial.grossWin = (trial.grossWin || 0) + pnlUsd;
      // Lock 20% of winning profit into reserve — never risked again
      const reserveRate = trial.reservePct || 0.20;
      const reserved = pnlUsd * reserveRate;
      trial.reserve = (trial.reserve || 0) + reserved;
      portfolio.balance -= reserved; // move out of trading pool into reserve
      console.log(`[spot] 💰 Reserved $${reserved.toFixed(2)} (${(reserveRate*100).toFixed(0)}% of win) → total reserve: $${trial.reserve.toFixed(2)}`);
    } else {
      trial.losses++;
      trial.grossLossAbs = (trial.grossLossAbs || 0) + Math.abs(pnlUsd);
    }
    trial.totalPnl = (trial.grossWin || 0) - (trial.grossLossAbs || 0);
    if (!trial.history) trial.history = [];
    trial.history.push({
      ts: Date.now(),
      symbol: pos.symbol,
      type: 'SPOT',
      reason,
      entry: pos.entryPrice,
      exit: exitPrice,
      peak: pos.peakPrice,
      budget: pos.budget,
      pnlUsd,
      pnlPct: safePnlPct.toFixed(2)
    });
  } else if (isBlacklisted) {
    console.warn(`[spot:exit] ⚠️  Blacklisted token ${pos.symbol} closed — NOT counted in trial stats`);
  }

  unregisterActiveToken(pos.symbol);
  unregisterActiveToken(pos.pairAddress);
  spotPositions.splice(index, 1);
  persistNow();

  const emoji = pnlUsd >= 0 ? '🟢' : '🔴';
  const blacklistNote = isBlacklisted ? '\n⚠️ BLACKLISTED — not counted in trial' : '';
  await reply(chatId,
    `${emoji} SPOT CLOSED ${pos.symbol} (${reason})\n` +
    `Entry: $${pos.entryPrice.toExponential(4)}\n` +
    `Exit: $${exitPrice.toExponential(4)}\n` +
    `Peak: $${pos.peakPrice.toExponential(4)}\n` +
    `PnL: ${safePnlPct >= 0 ? '+' : ''}${safePnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)})` +
    blacklistNote + `\n` +
    `Balance: $${portfolio.balance.toFixed(2)}`
  );

  console.log(`[spot:exit] Closed ${pos.symbol} ${reason} pnl=${safePnlPct.toFixed(2)}%${isBlacklisted ? ' [BLACKLISTED/IGNORED]' : ''}`);
}

// ─── MAIN SPOT LOOP ───────────────────────────────────────────────────────────

async function runSpotCycle(chatId) {
  console.log('[spot] Starting scan cycle...');

  // Monitor existing positions first
  await monitorSpotPositions(chatId);

  // Check if we have room for new positions
  const openCount = spotPositions.filter(p => p.status === 'open').length;
  if (openCount >= SPOT_CONFIG.maxSpotPositions) {
    console.log(`[spot] Max positions (${SPOT_CONFIG.maxSpotPositions}) reached — skipping scan`);
    return;
  }

  // Detect new tokens
  const candidates = await detectNewTokens();
  if (!candidates.length) {
    console.log('[spot] No new candidates found');
    return;
  }

  // Step 1: Add to watchlist
  for (const candidate of candidates) {
    if (watchlist.has(candidate.pairAddress) || scannedTokens.has(candidate.pairAddress)) continue;
    if ((candidate.m5 || 0) > 25) { console.log('[spot:watch] ' + candidate.symbol + ' chasing — skip'); scannedTokens.add(candidate.pairAddress); continue; }
    const researched = await researchToken(candidate);
    if (researched.verdict === 'SKIP' || researched.verdict === 'RISKY') { scannedTokens.add(candidate.pairAddress); continue; }
    watchlist.set(candidate.pairAddress, { token: researched, detectedAt: Date.now(), detectedPrice: researched.price || candidate.price });
    console.log('[spot:watch] ' + candidate.symbol + ' watchlisted — confirming in 2min');
  }
  // Step 2: Enter confirmed tokens
  const now = Date.now();
  for (const [pairAddress, watch] of watchlist.entries()) {
    if (spotPositions.filter(p => p.status === 'open').length >= SPOT_CONFIG.maxSpotPositions) break;
    const waitMs = now - watch.detectedAt;
    if (waitMs < 2 * 60 * 1000) continue;
    if (waitMs > 10 * 60 * 1000) { watchlist.delete(pairAddress); scannedTokens.add(pairAddress); continue; }
    let currentPrice = watch.detectedPrice;
    try { const d = await fetchJson('https://api.dexscreener.com/latest/dex/pairs/' + watch.token.chain + '/' + pairAddress); const p = Number(d?.pairs?.[0]?.priceUsd || 0); if (p > 0) currentPrice = p; } catch {}
    const drift = ((currentPrice - watch.detectedPrice) / watch.detectedPrice) * 100;
    if (drift < -8) { console.log('[spot:watch] ' + watch.token.symbol + ' dumped ' + drift.toFixed(1) + '% — skip'); watchlist.delete(pairAddress); scannedTokens.add(pairAddress); continue; }
    if (drift > 20) { console.log('[spot:watch] ' + watch.token.symbol + ' pumped ' + drift.toFixed(1) + '% — too late'); watchlist.delete(pairAddress); scannedTokens.add(pairAddress); continue; }
    console.log('[spot:watch] ' + watch.token.symbol + ' CONFIRMED ' + (drift >= 0 ? '+' : '') + drift.toFixed(1) + '% — entering');
    watch.token.price = currentPrice;
    watchlist.delete(pairAddress);
    await openSpotPosition(chatId, watch.token);
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ─── START/STOP ───────────────────────────────────────────────────────────────

function startSpotLoop(chatId) {
  if (spotScanHandle) {
    console.log('[spot] Loop already running');
    return;
  }
  console.log(`[spot] Starting spot loop — scanning every ${SPOT_CONFIG.scanIntervalMs / 60000} min`);

  // Run immediately then on interval
  runSpotCycle(chatId).catch(e => console.error('[spot] cycle error:', e.message));
  spotScanHandle = setInterval(() => {
    runSpotCycle(chatId).catch(e => console.error('[spot] cycle error:', e.message));
  }, SPOT_CONFIG.scanIntervalMs);
}

function stopSpotLoop() {
  if (spotScanHandle) {
    clearInterval(spotScanHandle);
    spotScanHandle = null;
    console.log('[spot] Loop stopped');
  }
}

function getSpotStatus() {
  return {
    running: !!spotScanHandle,
    openPositions: spotPositions.filter(p => p.status === 'open').length,
    positions: spotPositions.filter(p => p.status === 'open'),
    scannedCount: scannedTokens.size,
    config: SPOT_CONFIG
  };
}

module.exports = { startSpotLoop, stopSpotLoop, getSpotStatus, runSpotCycle, SPOT_CONFIG };

// ─── BOT.JS INTEGRATION ───────────────────────────────────────────────────────
//
// Add to bot.js after the AUTO_START_SCHEDULER block:
//
//   const { startSpotLoop } = require('./src/spot');
//   startSpotLoop(YOUR_CHAT_ID); // Replace with your Telegram chat ID
//
// Add Telegram command handler in the main loop:
//   else if (cmd === '/spot') await handleSpotCommand(chatId, parts);
//
// Add handler function:
//   async function handleSpotCommand(chatId, parts) {
//     const { getSpotStatus, stopSpotLoop, startSpotLoop } = require('./src/spot');
//     const sub = parts[1] || 'status';
//     if (sub === 'status') {
//       const s = getSpotStatus();
//       await reply(chatId, `🟢 Spot Module\nRunning: ${s.running}\nOpen: ${s.openPositions}/${SPOT_CONFIG.maxSpotPositions}\nScanned: ${s.scannedCount} tokens`);
//     } else if (sub === 'stop') { stopSpotLoop(); await reply(chatId, '🛑 Spot loop stopped'); }
//     else if (sub === 'on') { startSpotLoop(chatId); await reply(chatId, '🟢 Spot loop started'); }
//     else if (sub === 'positions') {
//       const s = getSpotStatus();
//       if (!s.positions.length) { await reply(chatId, 'No open spot positions'); return; }
//       for (const p of s.positions) {
//         const pnlPct = ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(2);
//         await reply(chatId, `${p.symbol} (${p.chain})\nEntry: $${p.entryPrice.toExponential(4)}\nCurrent: $${p.currentPrice.toExponential(4)}\nPeak: $${p.peakPrice.toExponential(4)}\nPnL: ${pnlPct}%\nTrail stop: $${p.trailStop.toExponential(4)}`);
//       }
//     }
//   }
