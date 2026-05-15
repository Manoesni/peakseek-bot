/**
 * PeakSeek — Agent 3: Whale Watcher
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy: Monitor large buy transactions (≥$10k) on trending pools.
 * When a whale buys into a small/mid cap token, follow them in immediately.
 * Whales do the research — we copy the trade.
 *
 * Data sources (no API key needed):
 *  1. GeckoTerminal /trades endpoint — large trades on specific pools
 *  2. DexScreener buy/sell ratio spikes — sudden buy dominance = whale entering
 *  3. Solana public RPC — on-chain large transfer detection
 *
 * Install: copy to /Users/macpro/Desktop/peakseek/src/whale_watcher.js
 * Wire into bot.js (see instructions at bottom)
 */

'use strict';
const { logSignal, getConfirmed, markActedOn } = require('./signal_hub');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const WHALE_CONFIG = {
  // Minimum single trade size to flag as whale
  minTradeSizeUsd: 10000,

  // Minimum pool liquidity — ignore tiny pools (easy to manipulate)
  minPoolLiquidityUsd: 100000,

  // Maximum pool liquidity — whales in huge pools don't move price much
  maxPoolLiquidityUsd: 5000000,

  // Minimum buy/sell ratio in last 1h to confirm whale accumulation
  // 3.0 = 3x more buys than sells = strong accumulation
  minBuySellRatio: 2.5,

  // How many pools to monitor per scan
  poolsToMonitor: 20,

  // Scan interval
  scanIntervalMs: 8 * 60 * 1000, // every 8 minutes (staggered from main scanner)

  // Chains to watch
  chains: ['solana'], // eth+base+bsc disabled — too many 429s

  // Trade recency — only flag trades from last N minutes
  maxTradeAgeMinutes: 15,

  // Minimum score to act on a whale signal
  minWhaleScore: 60,

  // Request timeout
  timeoutMs: 8000,

  // Position sizing for whale trades (larger than spot — more confident)
  whaleBudgetUsd: 15,
  maxWhalePositions: 2,
};

// ─── STATE ───────────────────────────────────────────────────────────────────

let whalePositions = [];
let whaleScanHandle = null;
let seenTrades = new Set(); // prevent acting on same trade twice
let whaleClosedToday = [];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WHALE_CONFIG.timeoutMs);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json;version=20230302', ...(opts.headers || {}) }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SOURCE 1: GECKOTERMINAL LARGE TRADES ────────────────────────────────────
// Fetches recent large trades (≥$10k) on trending pools
// Returns whale signals with pool info

async function scanGeckoWhales(chain) {
  const signals = [];

  try {
    // Get trending pools for this chain
    const data = await fetchJson(
      `https://api.geckoterminal.com/api/v2/networks/${chain}/trending_pools?page=1`
    );
    const pools = data?.data?.slice(0, WHALE_CONFIG.poolsToMonitor) || [];

    for (const pool of pools) {
      const attr = pool.attributes || {};
      const liq = Number(attr.reserve_in_usd || 0);
      const symbol = String(attr.name || '').split('/')[0].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const pairAddress = pool.id?.replace(`${chain}_`, '') || '';

      if (!pairAddress || !symbol) continue;
      if (liq < WHALE_CONFIG.minPoolLiquidityUsd) continue;
      if (liq > WHALE_CONFIG.maxPoolLiquidityUsd) continue;

      // Fetch large trades for this pool
      try {
        await sleep(500); // gentle rate limiting
        const tradesData = await fetchJson(
          `https://api.geckoterminal.com/api/v2/networks/${chain}/pools/${pairAddress}/trades?limit=20&trade_volume_in_usd_greater_than=${WHALE_CONFIG.minTradeSizeUsd}`
        );

        const trades = tradesData?.data || [];
        const nowMs = Date.now();
        const maxAgeMs = WHALE_CONFIG.maxTradeAgeMinutes * 60 * 1000;

        // Find recent large BUYS
        const recentWhaleBuys = trades.filter(t => {
          const a = t.attributes;
          const tradeTime = new Date(a.block_timestamp).getTime();
          const ageMs = nowMs - tradeTime;
          const volUsd = Number(a.volume_in_usd || 0);
          const isBuy = a.kind === 'buy';
          const tradeId = t.id;

          return isBuy
            && ageMs <= maxAgeMs
            && volUsd >= WHALE_CONFIG.minTradeSizeUsd
            && !seenTrades.has(tradeId);
        });

        if (recentWhaleBuys.length === 0) continue;

        // Mark trades as seen
        recentWhaleBuys.forEach(t => seenTrades.add(t.id));

        // Calculate total whale buy volume in last 15 min
        const totalWhaleVol = recentWhaleBuys.reduce((s, t) => s + Number(t.attributes.volume_in_usd || 0), 0);
        const largestTrade = Math.max(...recentWhaleBuys.map(t => Number(t.attributes.volume_in_usd || 0)));

        // Buy/sell ratio from pool attributes
        const buys1h = Number(attr.transactions?.h1?.buys || 0);
        const sells1h = Number(attr.transactions?.h1?.sells || 0);
        const buySellRatio = sells1h > 0 ? buys1h / sells1h : buys1h > 0 ? 10 : 1;

        // Price momentum
        const chgM5 = Number(attr.price_change_percentage?.m5 || 0);
        const chgH1 = Number(attr.price_change_percentage?.h1 || 0);
        const chg24h = Number(attr.price_change_percentage?.h24 || 0);

        // Skip if already massively pumped
        if (chg24h > 150) continue;

        // Score the whale signal
        const score = scoreWhaleSignal({
          totalWhaleVol,
          largestTrade,
          buySellRatio,
          liq,
          chgM5,
          chgH1,
          chg24h,
          whaleCount: recentWhaleBuys.length,
        });

        if (score >= WHALE_CONFIG.minWhaleScore) {
          signals.push({
            symbol,
            chain: chain === 'eth' ? 'ethereum' : chain,
            pairAddress,
            liq,
            chgM5,
            chgH1,
            chg24h,
            buySellRatio,
            totalWhaleVol,
            largestTrade,
            whaleCount: recentWhaleBuys.length,
            price: Number(attr.base_token_price_usd || 0),
            score,
            source: 'gecko_whale',
          });

          console.log(`[whale] 🐋 ${symbol} (${chain}) — $${Math.round(totalWhaleVol).toLocaleString()} whale buy | score=${score} | ratio=${buySellRatio.toFixed(1)}x`);
        }
      } catch (e) {
        if (!e.message.includes('429')) {
          console.error(`[whale] trade fetch error ${symbol}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error(`[whale] gecko scan error ${chain}:`, e.message);
  }

  return signals;
}

// ─── SOURCE 2: DEXSCREENER BUY SURGE DETECTION ───────────────────────────────
// Detects sudden buy dominance — more sensitive than large single trades
// Catches whales spreading buys across multiple smaller transactions

async function scanDexScreenerSurge() {
  const signals = [];

  try {
    // Get latest token profiles — find tokens with sudden buy surge
    const data = await fetchJson('https://api.dexscreener.com/token-profiles/latest/v1');
    const tokens = Array.isArray(data) ? data.slice(0, 30) : [];

    for (const t of tokens) {
      const addr = String(t.tokenAddress || '');
      const chainId = String(t.chainId || '');
      if (!addr || !chainId) continue;

      try {
        await sleep(300);
        const pairData = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
        const pairs = pairData?.pairs || [];
        if (!pairs.length) continue;

        const best = pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
        const liq = Number(best.liquidity?.usd || 0);
        if (liq < WHALE_CONFIG.minPoolLiquidityUsd) continue;
        if (liq > WHALE_CONFIG.maxPoolLiquidityUsd) continue;

        const buysH1 = Number(best.txns?.h1?.buys || 0);
        const sellsH1 = Number(best.txns?.h1?.sells || 0);
        const buysM5 = Number(best.txns?.m5?.buys || 0);
        const sellsM5 = Number(best.txns?.m5?.sells || 0);

        // Surge: m5 buys much higher than h1 average rate
        const h1BuyRate = buysH1 / 12; // expected buys per 5min
        const surgeFactor = h1BuyRate > 0 ? buysM5 / h1BuyRate : 0;

        const buySellRatio = sellsH1 > 0 ? buysH1 / sellsH1 : buysH1 > 0 ? 10 : 1;
        const chg24h = Number(best.priceChange?.h24 || 0);
        const chgH1 = Number(best.priceChange?.h1 || 0);
        const chgM5 = Number(best.priceChange?.m5 || 0);
        const vol1h = Number(best.volume?.h1 || 0);

        // Need strong buy surge + decent buy/sell ratio + some price movement
        if (surgeFactor < 2.5) continue;
        if (buySellRatio < WHALE_CONFIG.minBuySellRatio) continue;
        if (chg24h > 150) continue;

        const symbol = String(best.baseToken?.symbol || '').toUpperCase();

        const score = scoreWhaleSignal({
          totalWhaleVol: vol1h * 0.3, // estimate
          largestTrade: vol1h / Math.max(buysH1, 1),
          buySellRatio,
          liq,
          chgM5,
          chgH1,
          chg24h,
          whaleCount: Math.round(surgeFactor),
          surgeFactor,
        });

        if (score >= WHALE_CONFIG.minWhaleScore) {
          signals.push({
            symbol,
            chain: chainId,
            pairAddress: best.pairAddress,
            liq,
            chgM5,
            chgH1,
            chg24h,
            buySellRatio,
            totalWhaleVol: vol1h * 0.3,
            surgeFactor,
            price: Number(best.priceUsd || 0),
            score,
            source: 'dex_surge',
          });

          console.log(`[whale] 📈 ${symbol} surge — ${surgeFactor.toFixed(1)}x buy rate | ratio=${buySellRatio.toFixed(1)}x | score=${score}`);
        }
      } catch {}
    }
  } catch (e) {
    console.error('[whale] dex surge error:', e.message);
  }

  return signals;
}

// ─── SCORING ─────────────────────────────────────────────────────────────────

function scoreWhaleSignal({ totalWhaleVol, largestTrade, buySellRatio, liq, chgM5, chgH1, chg24h, whaleCount, surgeFactor }) {
  let score = 0;

  // Whale volume score (0-30): bigger the buy, stronger the signal
  score += Math.min(30, totalWhaleVol / 2000);

  // Buy/sell ratio score (0-25): strong accumulation
  score += Math.min(25, (buySellRatio - 1) * 5);

  // Price momentum confirmation (0-20): whale buy + price moving = real
  if (chgM5 > 0) score += Math.min(10, chgM5 * 2);
  if (chgH1 > 0) score += Math.min(10, chgH1 * 1);

  // Multiple whales = stronger signal (0-15)
  score += Math.min(15, (whaleCount || 1) * 5);

  // Surge factor bonus (0-10)
  if (surgeFactor) score += Math.min(10, surgeFactor * 2);

  // Penalties
  if (chg24h > 100) score -= 20; // already pumped
  if (chg24h > 50)  score -= 10; // somewhat pumped
  if (liq < 200000) score -= 10; // low liquidity risk

  return Math.round(Math.max(0, Math.min(99, score)));
}

// ─── POSITION MANAGEMENT ─────────────────────────────────────────────────────

const whaleCooldowns = new Map();
const WHALE_COOLDOWN_MS = 2 * 60 * 60 * 1000;

async function openWhalePosition(chatId, signal) {
  const { portfolio, trial } = require('./state');
  const { persistNow } = require('./state');
  const { reply } = require('./telegram');

  if (whalePositions.filter(p => p.status === 'open').length >= WHALE_CONFIG.maxWhalePositions) {
    console.log('[whale] Max whale positions reached');
    return false;
  }

  if (whalePositions.some(p => p.pairAddress === signal.pairAddress && p.status === 'open')) {
    console.log(`[whale] Already in ${signal.symbol}`);
    return false;
  }

  const budget = WHALE_CONFIG.whaleBudgetUsd;
  if (portfolio.balance < budget) return false;

  const entryPrice = signal.price;
  if (!entryPrice) return false;

  const position = {
    symbol: signal.symbol,
    chain: signal.chain,
    pairAddress: signal.pairAddress,
    source: signal.source,
    entryPrice,
    currentPrice: entryPrice,
    peakPrice: entryPrice,
    budget,
    status: 'open',
    openedAt: Date.now(),
    chatId,
    whaleVol: signal.totalWhaleVol,
    buySellRatio: signal.buySellRatio,
    score: signal.score,
    // Exit levels — tighter than spot since whale trades can reverse fast
    hardTP: entryPrice * 1.60,   // 60% hard TP
    hardSL: entryPrice * 0.80,   // 20% hard SL (tighter — whale trades can fail)
    trailStop: entryPrice * 0.88, // 12% trail from peak
  };

  whalePositions.push(position);
  portfolio.balance -= budget;
  persistNow();

  await reply(chatId,
    `🐋 WHALE FOLLOW — ${signal.symbol}\n` +
    `Chain: ${signal.chain}\n` +
    `Entry: $${entryPrice.toExponential(4)}\n` +
    `Whale bought: $${Math.round(signal.totalWhaleVol).toLocaleString()}\n` +
    `Buy/sell ratio: ${signal.buySellRatio?.toFixed(1)}x\n` +
    `Signal score: ${signal.score}/100\n` +
    `Plan: Trail -12% from peak | Hard TP +60% | Hard SL -20%`
  );

  console.log(`[whale] Opened ${signal.symbol} at $${entryPrice} — whale vol $${Math.round(signal.totalWhaleVol).toLocaleString()}`);
  return true;
}

async function monitorWhalePositions(chatId) {
  const { portfolio, trial } = require('./state');
  const { persistNow } = require('./state');
  const { reply } = require('./telegram');

  for (let i = whalePositions.length - 1; i >= 0; i--) {
    const pos = whalePositions[i];
    if (pos.status !== 'open') continue;

    // Fetch current price
    let currentPrice = pos.currentPrice;
    try {
      const data = await fetchJson(
        `https://api.dexscreener.com/latest/dex/pairs/${pos.chain}/${pos.pairAddress}`
      );
      const p = Number(data?.pairs?.[0]?.priceUsd || 0);
      if (p > 0) currentPrice = p;
    } catch {}

    pos.currentPrice = currentPrice;

    const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const peakPct = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const holdHours = (Date.now() - pos.openedAt) / 3600000;

    // Update peak
    if (currentPrice > pos.peakPrice) pos.peakPrice = currentPrice;

    // Trail activates only after +20% peak, tightens to 8% after +60%
    if (peakPct >= 20) {
      const trailPct = peakPct >= 60 ? 8 : 12;
      pos.trailStop = pos.peakPrice * (1 - trailPct / 100);
    }

    // Partial exit: sell 50% at +35%
    if (!pos.partialExitDone && pnlPct >= 35) {
      pos.partialExitDone = true;
      const halfBudget = pos.budget / 2;
      const halfPnl = halfBudget * (pnlPct / 100);
      portfolio.balance += halfBudget + halfPnl;
      pos.budget = halfBudget;
      if (trial?.active) {
        trial.wins = (trial.wins || 0) + 1;
        trial.trades = (trial.trades || 0) + 1;
        trial.grossWin = (trial.grossWin || 0) + halfPnl;
        trial.totalPnl = (trial.grossWin || 0) - (trial.grossLossAbs || 0);
      }
      persistNow();
      console.log(`[whale:exit] ${pos.symbol} PARTIAL EXIT 50% at +${pnlPct.toFixed(1)}%`);
      await reply(pos.chatId, `🟡 WHALE PARTIAL EXIT ${pos.symbol}\nSold 50% at +${pnlPct.toFixed(1)}% ($${halfPnl.toFixed(2)})\nRemainder running with trail`);
    }

    let exitReason = null;
    if (currentPrice >= pos.hardTP)  exitReason = 'HARD_TP';
    else if (currentPrice <= pos.hardSL) exitReason = 'HARD_SL';
    else if (peakPct >= 20 && currentPrice <= pos.trailStop && currentPrice < pos.peakPrice * 0.95) exitReason = 'TRAIL_TP';
    else if (holdHours >= 2) exitReason = 'TIME_EXIT';

    if (exitReason) {
      const pnlUsd = pos.budget * (pnlPct / 100);
      pos.status = 'closed';
      portfolio.balance += pos.budget + pnlUsd;

      if (trial?.active) {
        trial.trades = (trial.trades || 0) + 1;
        trial.realizedPnl = (trial.realizedPnl || 0) + pnlUsd;
        if (pnlUsd >= 0) {
          trial.wins = (trial.wins || 0) + 1;
          trial.grossWin = (trial.grossWin || 0) + Math.min(pnlUsd, 10000);
        } else {
          trial.losses = (trial.losses || 0) + 1;
          trial.grossLossAbs = (trial.grossLossAbs || 0) + Math.abs(pnlUsd);
          whaleCooldowns.set(pos.symbol, Date.now() + WHALE_COOLDOWN_MS);
          console.log(`[whale:cooldown] ${pos.symbol} blocked 2h`);
        }
        trial.totalPnl = (trial.grossWin || 0) - (trial.grossLossAbs || 0);
        if (!trial.history) trial.history = [];
        trial.history.push({
          ts: Date.now(), symbol: pos.symbol, type: 'WHALE',
          pnlUsd: Number(pnlUsd.toFixed(2)),
          pnlPct: Number(pnlPct.toFixed(2)),
          exitReason,
        });
      }

      whaleClosedToday.push({ symbol: pos.symbol, pnlUsd, exitReason });
      persistNow();

      const emoji = pnlUsd >= 0 ? '🟢' : '🔴';
      await reply(chatId || pos.chatId,
        `${emoji} WHALE EXIT — ${pos.symbol} [${exitReason}]\n` +
        `PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)})\n` +
        `Held: ${(holdHours * 60).toFixed(0)} min\n` +
        `Balance: $${portfolio.balance.toFixed(2)}`
      );

      console.log(`[whale] Closed ${pos.symbol} ${exitReason} pnl=${pnlPct.toFixed(2)}%`);
    }
  }
}

// ─── MAIN SCAN ────────────────────────────────────────────────────────────────

async function runWhaleCycle(chatId) {
  console.log('[whale] Starting whale scan...');

  // Monitor existing positions first
  await monitorWhalePositions(chatId);

  // Check capacity
  const openCount = whalePositions.filter(p => p.status === 'open').length;
  if (openCount >= WHALE_CONFIG.maxWhalePositions) {
    console.log(`[whale] Max positions (${WHALE_CONFIG.maxWhalePositions}) reached`);
    return;
  }

  // Scan all sources
  const allSignals = [];

  // GeckoTerminal whale trades — staggered to avoid 429
  for (const chain of WHALE_CONFIG.chains) {
    const signals = await scanGeckoWhales(chain);
    allSignals.push(...signals);
    await sleep(3000); // 3s between chains
  }

  // DexScreener surge detection
  const surgeSignals = await scanDexScreenerSurge();
  allSignals.push(...surgeSignals);

  // De-duplicate by pairAddress
  const seen = new Map();
  for (const s of allSignals) {
    const key = s.pairAddress || `${s.symbol}_${s.chain}`;
    if (!seen.has(key) || seen.get(key).score < s.score) seen.set(key, s);
  }

  const candidates = [...seen.values()].sort((a, b) => b.score - a.score);

  console.log(`[whale] Found ${candidates.length} whale signals`);

  if (candidates.length > 0) {
    console.log('[whale] Top signals:');
    candidates.slice(0, 3).forEach((s, i) => {
      console.log(`  ${i+1}. ${s.symbol} (${s.chain}) score=${s.score} whaleBuy=$${Math.round(s.totalWhaleVol || 0).toLocaleString()} ratio=${(s.buySellRatio||0).toFixed(1)}x`);
    });
  }

  // Enter best signal
  for (const signal of candidates) {
    if (openCount + whalePositions.filter(p => p.status === 'open').length >= WHALE_CONFIG.maxWhalePositions) break;
    logSignal('whale', signal);
    await openWhalePosition(chatId, signal);
    await sleep(1000);
  }
}

// ─── START/STOP ───────────────────────────────────────────────────────────────


let whaleFastExitHandle = null;

async function startWhaleWatcher(chatId) {
  if (whaleScanHandle) {
    console.log('[whale] Already running');
    return;
  }
  console.log('[whale] 🐋 Whale Watcher started — scanning every 8 minutes');
  // Fast exit monitor — inlined to avoid scope issues
  if (!whaleFastExitHandle) {
    whaleFastExitHandle = setInterval(function() {
      var open = whalePositions.filter(function(p){return p.status==="open";});
      if (!open.length) return;
      monitorWhalePositions(chatId).catch(function(e){console.error("[whale:fast-exit]",e.message);});
    }, 30000);
    console.log("[whale] Fast exit monitor 30s");
  }

  // Stagger start by 2 min after spot loop to avoid API collisions
  setTimeout(() => {
    runWhaleCycle(chatId).catch(e => console.error('[whale] cycle error:', e.message));
    whaleScanHandle = setInterval(() => {
      runWhaleCycle(chatId).catch(e => console.error('[whale] cycle error:', e.message));
    }, WHALE_CONFIG.scanIntervalMs);
  }, 2 * 60 * 1000);
}

function stopWhaleWatcher() {
  if (whaleScanHandle) {
    clearInterval(whaleScanHandle);
    whaleScanHandle = null;
    console.log('[whale] Stopped');
  }
}

function getWhaleStatus() {
  return {
    running: !!whaleScanHandle,
    openPositions: whalePositions.filter(p => p.status === 'open').length,
    maxPositions: WHALE_CONFIG.maxWhalePositions,
    positions: whalePositions.filter(p => p.status === 'open'),
    closedToday: whaleClosedToday,
    config: WHALE_CONFIG,
  };
}

module.exports = { startWhaleWatcher, stopWhaleWatcher, getWhaleStatus, runWhaleCycle, WHALE_CONFIG };

// ─── BOT.JS INTEGRATION ───────────────────────────────────────────────────────
//
// 1. In the bot.js scheduler setTimeout block, after startSpotLoop:
//
//    setTimeout(() => {
//      const { startWhaleWatcher } = require('./src/whale_watcher');
//      startWhaleWatcher(0).catch(e => console.error('[whale] start error:', e.message));
//    }, 3 * 60 * 1000); // starts 3 min after boot (spot starts at 1min, whale at 3min)
//
// 2. Add /whale command handler:
//
//    else if (cmd === '/whale') {
//      try {
//        const { getWhaleStatus } = require('./src/whale_watcher');
//        const s = getWhaleStatus();
//        const lines = [
//          `🐋 Whale Watcher`,
//          `Status: ${s.running ? '🟢 Running' : '🔴 Stopped'}`,
//          `Open: ${s.openPositions}/${s.maxPositions}`,
//        ];
//        if (s.positions.length > 0) {
//          lines.push('');
//          s.positions.forEach(p => {
//            const pct = ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1);
//            lines.push(`• ${p.symbol} ${pct >= 0 ? '+' : ''}${pct}% [${p.chain}]`);
//          });
//        } else lines.push('No open whale positions');
//        reply(chatId, lines.join('\n'));
//      } catch(e) { reply(chatId, '🐋 Whale error: ' + e.message); }
//    }
