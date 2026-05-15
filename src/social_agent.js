/**
 * PeakSeek — Agent 4: Social Spike Detector
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy: Detect tokens with sudden social media spikes BEFORE they show
 * on price charts. Social volume → price follows. Enter early, ride the wave.
 *
 * Data sources (no API key needed):
 *  1. DexScreener token profiles — tracks tokens with active socials/websites
 *  2. DexScreener boosted tokens — paid boosts = project has money + confidence
 *  3. GeckoTerminal trending — cross-reference social vs price momentum
 *  4. Token age + social activity ratio — new token with high social = launch
 *
 * The edge: most bots only look at price. We look at social activity first.
 * A token going from 0 social mentions to 500/hour is about to pump.
 *
 * Install: copy to /Users/macpro/Desktop/peakseek/src/social_agent.js
 * Wire into bot.js (see instructions at bottom)
 */

'use strict';
const { logSignal, getConfirmed, markActedOn } = require('./signal_hub');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const SOCIAL_CONFIG = {
  // Scan interval — slowed to reduce 429s
  scanIntervalMs: 6 * 60 * 1000, // every 6 minutes

  // Minimum liquidity — social hype on rugpulls = bad
  minLiquidityUsd: 50000,
  maxLiquidityUsd: 3000000, // not too big — social moves small caps more

  // Minimum score to enter
  minSocialScore: 65,       // raised from 60 — more selective

  // Position sizing
  socialBudgetUsd: 12,
  maxSocialPositions: 2,

  // Exit strategy — social pumps are fast and violent
  hardTakeProfitPct: 100,  // raised from 70 — let winners run more
  stopLossPct: 15,          // tightened from 20 — cut losses faster
  trailPct: 12,             // 12% trail from peak
  maxHoldHours: 3,          // 3h max — social hype dies fast

  // Boosted token bonus — projects paying for DexScreener boost = confident
  boostedBonus: 20,

  // Request timeout
  timeoutMs: 8000,

  // Chains to monitor for social activity (bsc disabled — too many 429s)
  chains: ['solana', 'ethereum', 'base'],
};

// ─── STATE ───────────────────────────────────────────────────────────────────

let socialPositions = [];
let socialScanHandle = null;
let seenTokens = new Set();
let socialClosedToday = [];
let boostedTokens = new Map(); // pairAddress → boost data

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOCIAL_CONFIG.timeoutMs);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json', ...(opts.headers || {}) }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SOURCE 1: DEXSCREENER BOOSTED TOKENS ────────────────────────────────────
// Projects paying for DexScreener boost are serious — they have funds,
// they believe in the project, and boost = incoming marketing push

async function fetchBoostedTokens() {
  try {
    const data = await fetchJson('https://api.dexscreener.com/token-boosts/top/v1');
    const tokens = Array.isArray(data) ? data : [];

    boostedTokens.clear();
    for (const t of tokens) {
      const key = String(t.tokenAddress || '').toLowerCase();
      if (key) {
        boostedTokens.set(key, {
          amount: Number(t.totalAmount || 0),
          chain: String(t.chainId || ''),
          boostRank: tokens.indexOf(t) + 1,
        });
      }
    }
    console.log(`[social] Loaded ${boostedTokens.size} boosted tokens`);
  } catch (e) {
    console.error('[social] boost fetch error:', e.message);
  }
}

// ─── SOURCE 2: DEXSCREENER TOKEN PROFILES ────────────────────────────────────
// Token profiles = projects that set up their DexScreener page with
// socials, website, description. Filtering for ones with high activity.

async function fetchProfileTokens() {
  const candidates = [];

  try {
    const data = await fetchJson('https://api.dexscreener.com/token-profiles/latest/v1');
    const tokens = Array.isArray(data) ? data : [];

    console.log(`[social] Checking ${tokens.length} token profiles...`);

    for (const t of tokens.slice(0, 40)) {
      const addr = String(t.tokenAddress || '').toLowerCase();
      const chainId = String(t.chainId || '');

      if (!addr || !chainId) continue;
      if (seenTokens.has(addr)) continue;

      // Check links — more links = more social presence
      const links = t.links || [];
      const hasTwitter = links.some(l => String(l.url || '').includes('twitter') || String(l.url || '').includes('x.com'));
      const hasTelegram = links.some(l => String(l.url || '').includes('t.me') || String(l.url || '').includes('telegram'));
      const hasWebsite = links.some(l => l.type === 'website');
      const socialScore = (hasTwitter ? 2 : 0) + (hasTelegram ? 2 : 0) + (hasWebsite ? 1 : 0);

      if (socialScore < 2) continue; // needs at least 2 social signals

      // Check if boosted
      const isBoosted = boostedTokens.has(addr);
      const boostData = boostedTokens.get(addr);

      // Get pair data
      try {
        await sleep(200);
        const pairData = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
        const pairs = pairData?.pairs || [];
        if (!pairs.length) continue;

        // Best pair by liquidity
        const best = pairs
          .filter(p => SOCIAL_CONFIG.chains.includes(String(p.chainId || '')))
          .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];

        if (!best) continue;

        const liq = Number(best.liquidity?.usd || 0);
        if (liq < SOCIAL_CONFIG.minLiquidityUsd) continue;
        if (liq > SOCIAL_CONFIG.maxLiquidityUsd) continue;

        const chg24h = Number(best.priceChange?.h24 || 0);
        const chgH1  = Number(best.priceChange?.h1 || 0);
        const chgM5  = Number(best.priceChange?.m5 || 0);
        const vol24h = Number(best.volume?.h24 || 0);
        const volH1  = Number(best.volume?.h1 || 0);
        const buysH1 = Number(best.txns?.h1?.buys || 0);
        const sellsH1 = Number(best.txns?.h1?.sells || 0);

        // Volume acceleration: h1 vol vs expected from 24h
        const expectedH1Vol = vol24h / 24;
        const volAccel = expectedH1Vol > 0 ? volH1 / expectedH1Vol : 1;

        // Skip already pumped
        if (chg24h > 200) continue;

        const symbol = String(best.baseToken?.symbol || '').toUpperCase();

        const score = scoreSocialSignal({
          socialScore,
          isBoosted,
          boostAmount: boostData?.amount || 0,
          volAccel,
          chgM5,
          chgH1,
          chg24h,
          liq,
          buysH1,
          sellsH1,
        });

        if (score >= SOCIAL_CONFIG.minSocialScore) {
          candidates.push({
            symbol,
            chain: best.chainId,
            pairAddress: best.pairAddress,
            tokenAddress: addr,
            liq,
            chgM5,
            chgH1,
            chg24h,
            volAccel,
            isBoosted,
            boostAmount: boostData?.amount || 0,
            socialScore,
            hasTwitter,
            hasTelegram,
            price: Number(best.priceUsd || 0),
            score,
            source: isBoosted ? 'social_boosted' : 'social_profile',
          });

          console.log(`[social] 📢 ${symbol} score=${score} boost=${isBoosted} volAccel=${volAccel.toFixed(1)}x social=${socialScore}/5 chgM5=${chgM5.toFixed(1)}%`);
        }
      } catch {}
    }
  } catch (e) {
    console.error('[social] profile scan error:', e.message);
  }

  return candidates;
}

// ─── SOURCE 3: CROSS-REFERENCE WITH GECKO TRENDING ───────────────────────────
// A token appearing in BOTH DexScreener social AND GeckoTerminal trending
// is a very high confidence signal — two independent systems agree

let _lastGeckoCallTs = 0;
const GECKO_COOLDOWN_MS = 10 * 60 * 1000; // call at most once per 10 minutes

async function fetchGeckoSocialCrossRef() {
  const candidates = [];

  // Rate limit guard — GeckoTerminal free tier is very strict
  const now = Date.now();
  if (now - _lastGeckoCallTs < GECKO_COOLDOWN_MS) {
    return candidates; // skip silently
  }
  _lastGeckoCallTs = now;

  try {
    // Get Solana new pools — most social activity happens on new Solana tokens
    const data = await fetchJson(
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
      { headers: { 'Accept': 'application/json;version=20230302' } }
    );

    const pools = data?.data || [];
    const nowMs = Date.now();

    for (const pool of pools) {
      const attr = pool.attributes || {};
      const createdAt = attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : 0;
      const ageHours = (nowMs - createdAt) / 3600000;

      // Sweet spot: 1-8 hours old — past the initial dump risk but still early
      if (ageHours < 1 || ageHours > 8) continue;

      const liq = Number(attr.reserve_in_usd || 0);
      const vol24h = Number(attr.volume_usd?.h24 || 0);
      const chgH1 = Number(attr.price_change_percentage?.h1 || 0);
      const chgM5 = Number(attr.price_change_percentage?.m5 || 0);
      const chg24h = Number(attr.price_change_percentage?.h24 || 0);
      const symbol = String(attr.name || '').split('/')[0].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const pairAddress = pool.id?.replace('solana_', '') || '';

      if (!symbol || !pairAddress) continue;
      if (liq < SOCIAL_CONFIG.minLiquidityUsd) continue;
      if (chgM5 <= 0 && chgH1 <= 0) continue; // needs upward momentum

      // Volume/age ratio — high vol for age = strong community interest
      const volPerHour = vol24h / Math.max(ageHours, 1);
      if (volPerHour < 5000) continue; // needs $5k+/hour volume

      const score = scoreSocialSignal({
        socialScore: 2, // moderate — no direct social data
        isBoosted: false,
        boostAmount: 0,
        volAccel: volPerHour / 5000,
        chgM5,
        chgH1,
        chg24h,
        liq,
        buysH1: 0,
        sellsH1: 0,
        isNewToken: true,
        ageHours,
      });

      if (score >= SOCIAL_CONFIG.minSocialScore) {
        candidates.push({
          symbol,
          chain: 'solana',
          pairAddress,
          tokenAddress: null,
          liq,
          chgM5,
          chgH1,
          chg24h,
          volAccel: volPerHour / 5000,
          isBoosted: false,
          ageHours,
          volPerHour,
          price: Number(attr.base_token_price_usd || 0),
          score,
          source: 'social_new_vol',
        });

        console.log(`[social] 🆕 ${symbol} age=${ageHours.toFixed(1)}h vol/hr=$${Math.round(volPerHour).toLocaleString()} score=${score}`);
      }
    }
  } catch (e) {
    console.error('[social] gecko cross-ref error:', e.message);
  }

  return candidates;
}

// ─── SCORING ─────────────────────────────────────────────────────────────────

function scoreSocialSignal({ socialScore, isBoosted, boostAmount, volAccel, chgM5, chgH1, chg24h, liq, buysH1, sellsH1, isNewToken, ageHours }) {
  let score = 0;

  // Social presence (0-20)
  score += socialScore * 4;

  // Boost bonus (0-20) — paid boost = project has conviction
  if (isBoosted) {
    score += SOCIAL_CONFIG.boostedBonus;
    score += Math.min(10, boostAmount / 1000); // bigger boost = more points
  }

  // Volume acceleration (0-20) — social hype drives volume before price
  score += Math.min(20, volAccel * 5);

  // Price momentum confirmation (0-15)
  if (chgM5 > 0) score += Math.min(8, chgM5 * 1.5);
  if (chgH1 > 0) score += Math.min(7, chgH1 * 0.7);

  // New token bonus (0-10) — new + social = launch pump incoming
  if (isNewToken && ageHours < 6) score += 10;

  // Buy dominance (0-10)
  const ratio = sellsH1 > 0 ? buysH1 / sellsH1 : 1;
  if (ratio > 1.5) score += Math.min(10, (ratio - 1) * 5);

  // Penalties
  if (chg24h > 100) score -= 20; // already pumped
  if (chg24h > 50)  score -= 10;
  if (liq < 100000) score -= 10; // low liq risk

  return Math.round(Math.max(0, Math.min(99, score)));
}

// ─── POSITION MANAGEMENT ─────────────────────────────────────────────────────

const socialCooldowns = new Map();
const SOCIAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

async function openSocialPosition(chatId, signal) {
  const { portfolio, trial } = require('./state');
  const { persistNow } = require('./state');
  const { reply } = require('./telegram');

  if (socialPositions.filter(p => p.status === 'open').length >= SOCIAL_CONFIG.maxSocialPositions) return false;
  if (socialPositions.some(p => p.pairAddress === signal.pairAddress && p.status === 'open')) return false;
  if (seenTokens.has(signal.tokenAddress || signal.pairAddress)) return false;

  const budget = SOCIAL_CONFIG.socialBudgetUsd;
  if (portfolio.balance < budget) return false;

  const entryPrice = signal.price;
  if (!entryPrice || entryPrice <= 0) return false;

  seenTokens.add(signal.tokenAddress || signal.pairAddress);

  const position = {
    symbol: signal.symbol,
    chain: signal.chain,
    pairAddress: signal.pairAddress,
    entryPrice,
    currentPrice: entryPrice,
    peakPrice: entryPrice,
    budget,
    status: 'open',
    openedAt: Date.now(),
    chatId,
    isBoosted: signal.isBoosted,
    volAccel: signal.volAccel,
    score: signal.score,
    source: signal.source,
    hardTP: entryPrice * (1 + SOCIAL_CONFIG.hardTakeProfitPct / 100),
    hardSL: entryPrice * (1 - SOCIAL_CONFIG.stopLossPct / 100),
    trailStop: entryPrice * (1 - SOCIAL_CONFIG.trailPct / 100),
  };

  socialPositions.push(position);
  portfolio.balance -= budget;
  persistNow();

  const sourceLabel = signal.isBoosted ? '🚀 Boosted' : signal.source === 'social_new_vol' ? '🆕 New launch' : '📢 Social spike';

  await reply(chatId,
    `📢 SOCIAL ENTRY — ${signal.symbol}\n` +
    `Source: ${sourceLabel}\n` +
    `Chain: ${signal.chain}\n` +
    `Entry: $${entryPrice.toExponential(4)}\n` +
    `Vol acceleration: ${signal.volAccel?.toFixed(1)}x normal\n` +
    `${signal.isBoosted ? `Boost: $${Math.round(signal.boostAmount).toLocaleString()}\n` : ''}` +
    `Score: ${signal.score}/100\n` +
    `Plan: Trail -${SOCIAL_CONFIG.trailPct}% | Hard TP +${SOCIAL_CONFIG.hardTakeProfitPct}% | SL -${SOCIAL_CONFIG.stopLossPct}%`
  );

  console.log(`[social] Opened ${signal.symbol} at $${entryPrice} — ${signal.source} score=${signal.score}`);
  return true;
}

async function monitorSocialPositions(chatId) {
  const { portfolio, trial } = require('./state');
  const { persistNow } = require('./state');
  const { reply } = require('./telegram');

  for (let i = socialPositions.length - 1; i >= 0; i--) {
    const pos = socialPositions[i];
    if (pos.status !== 'open') continue;

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

    // Sanity check — reject prices more than 5x entry (likely bad data)
    if (currentPrice > pos.entryPrice * 5 && pos.entryPrice > 0) {
      console.log(`[exit:sanity] ${pos.symbol} price ${currentPrice} looks wrong vs entry ${pos.entryPrice} — skipping`);
      continue;
    }

    // Update peak
    if (currentPrice > pos.peakPrice) pos.peakPrice = currentPrice;

    // Trail activates only after +20% peak, tightens to 8% after +60%
    if (peakPct >= 20) {
      const trailPct = peakPct >= 60 ? 8 : SOCIAL_CONFIG.trailPct;
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
      console.log(`[social:exit] ${pos.symbol} PARTIAL EXIT 50% at +${pnlPct.toFixed(1)}%`);
      await reply(pos.chatId, `🟡 SOCIAL PARTIAL EXIT ${pos.symbol}\nSold 50% at +${pnlPct.toFixed(1)}% ($${halfPnl.toFixed(2)})\nRemainder running with trail`);
    }

    let exitReason = null;
    if (currentPrice >= pos.hardTP) exitReason = 'HARD_TP';
    else if (currentPrice <= pos.hardSL) exitReason = 'HARD_SL';
    else if (peakPct >= 20 && currentPrice <= pos.trailStop && currentPrice < pos.peakPrice * 0.95) exitReason = 'TRAIL_TP';
    else if (holdHours >= SOCIAL_CONFIG.maxHoldHours) exitReason = 'TIME_EXIT';

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
          socialCooldowns.set(pos.symbol, Date.now() + SOCIAL_COOLDOWN_MS);
          console.log(`[social:cooldown] ${pos.symbol} blocked 2h`);
        }
        trial.totalPnl = (trial.grossWin || 0) - (trial.grossLossAbs || 0);
        if (!trial.history) trial.history = [];
        trial.history.push({
          ts: Date.now(), symbol: pos.symbol, type: 'SOCIAL',
          pnlUsd: Number(pnlUsd.toFixed(2)),
          pnlPct: Number(pnlPct.toFixed(2)),
          exitReason,
        });
      }

      socialClosedToday.push({ symbol: pos.symbol, pnlUsd, exitReason });
      persistNow();

      const emoji = pnlUsd >= 0 ? '🟢' : '🔴';
      await reply(chatId || pos.chatId,
        `${emoji} SOCIAL EXIT — ${pos.symbol} [${exitReason}]\n` +
        `PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)})\n` +
        `Held: ${(holdHours * 60).toFixed(0)} min\n` +
        `Balance: $${portfolio.balance.toFixed(2)}`
      );

      console.log(`[social] Closed ${pos.symbol} ${exitReason} pnl=${pnlPct.toFixed(2)}%`);
    }
  }
}

// ─── MAIN CYCLE ───────────────────────────────────────────────────────────────

async function runSocialCycle(chatId) {
  console.log('[social] 📢 Starting social scan...');

  await monitorSocialPositions(chatId);

  const openCount = socialPositions.filter(p => p.status === 'open').length;
  if (openCount >= SOCIAL_CONFIG.maxSocialPositions) {
    console.log(`[social] Max positions (${SOCIAL_CONFIG.maxSocialPositions}) reached`);
    return;
  }

  // Refresh boosted tokens list
  await fetchBoostedTokens();
  await sleep(1000);

  // Run sources sequentially to reduce 429s (DexScreener first, then Gecko)
  const profileCandidates = await fetchProfileTokens();
  await sleep(3000);
  const geckoCandidates = await fetchGeckoSocialCrossRef();

  const all = [...profileCandidates, ...geckoCandidates];

  // De-duplicate
  const seen = new Map();
  for (const c of all) {
    const key = c.pairAddress || `${c.symbol}_${c.chain}`;
    if (!seen.has(key) || seen.get(key).score < c.score) seen.set(key, c);
  }

  const candidates = [...seen.values()].sort((a, b) => b.score - a.score);
  console.log(`[social] Found ${candidates.length} social signals`);

  if (candidates.length > 0) {
    console.log('[social] Top signals:');
    candidates.slice(0, 3).forEach((c, i) => {
      console.log(`  ${i+1}. ${c.symbol} score=${c.score} boost=${c.isBoosted} volAccel=${c.volAccel?.toFixed(1)}x src=${c.source}`);
    });
  }

  for (const candidate of candidates) {
    if (socialPositions.filter(p => p.status === 'open').length >= SOCIAL_CONFIG.maxSocialPositions) break;
    logSignal('social', candidate);
    logSignal('social', candidate);
    await openSocialPosition(chatId, candidate);
    await sleep(1000);
  }
}

// ─── START/STOP ───────────────────────────────────────────────────────────────


let socialFastExitHandle = null;

async function startSocialAgent(chatId) {
  if (socialScanHandle) {
    console.log('[social] Already running');
    return;
  }
  console.log('[social] 📢 Social Agent started — scanning every 4 minutes');
  // Fast exit monitor — inlined to avoid scope issues
  if (!socialFastExitHandle) {
    socialFastExitHandle = setInterval(function() {
      var open = socialPositions.filter(function(p){return p.status==="open";});
      if (!open.length) return;
      monitorSocialPositions(chatId).catch(function(e){console.error("[social:fast-exit]",e.message);});
    }, 30000);
    console.log("[social] Fast exit monitor 30s");
  }

  // Stagger: futures=0min, spot=1min, whale=3min, social=4.5min
  setTimeout(() => {
    runSocialCycle(chatId).catch(e => console.error('[social] cycle error:', e.message));
    socialScanHandle = setInterval(() => {
      runSocialCycle(chatId).catch(e => console.error('[social] cycle error:', e.message));
    }, SOCIAL_CONFIG.scanIntervalMs);
  }, 4.5 * 60 * 1000);
}

function stopSocialAgent() {
  if (socialScanHandle) {
    clearInterval(socialScanHandle);
    socialScanHandle = null;
    console.log('[social] Stopped');
  }
}

function getSocialStatus() {
  return {
    running: !!socialScanHandle,
    openPositions: socialPositions.filter(p => p.status === 'open').length,
    maxPositions: SOCIAL_CONFIG.maxSocialPositions,
    positions: socialPositions.filter(p => p.status === 'open'),
    closedToday: socialClosedToday,
    boostedCount: boostedTokens.size,
    config: SOCIAL_CONFIG,
  };
}

module.exports = { startSocialAgent, stopSocialAgent, getSocialStatus, runSocialCycle, SOCIAL_CONFIG };

// ─── BOT.JS INTEGRATION ───────────────────────────────────────────────────────
//
// In bot.js scheduler block, after whale watcher setTimeout:
//
//    // Social Agent — starts 4.5 min after boot
//    setTimeout(() => {
//      try {
//        const socialPath = '/Users/macpro/Desktop/peakseek/src/social_agent';
//        delete require.cache[require.resolve(socialPath)];
//        const { startSocialAgent: _ss } = require(socialPath);
//        const sp = _ss(0);
//        if (sp && sp.catch) sp.catch(e => console.error('[social] start error:', e.message));
//      } catch(e) { console.error('[social] load error:', e.message); }
//    }, 4.5 * 60 * 1000);
//
// Add /social command:
//
//    else if (cmd === '/social') {
//      try {
//        const { getSocialStatus } = require('./src/social_agent');
//        const s = getSocialStatus();
//        const lines = [
//          `📢 Social Agent`,
//          `Status: ${s.running ? '🟢 Running' : '🔴 Stopped'}`,
//          `Open: ${s.openPositions}/${s.maxPositions}`,
//          `Boosted tokens tracked: ${s.boostedCount}`,
//        ];
//        if (s.positions.length > 0) {
//          lines.push('');
//          s.positions.forEach(p => {
//            const pct = p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) : '0.0';
//            lines.push(`• ${p.symbol} ${pct >= 0 ? '+' : ''}${pct}% [${p.source}]`);
//          });
//        } else lines.push('No open social positions');
//        reply(chatId, lines.join('\n'));
//      } catch(e) { reply(chatId, '📢 Social error: ' + e.message); }
//    }
