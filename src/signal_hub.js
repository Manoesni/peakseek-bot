/**
 * PeakSeek — Signal Hub v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Central conviction engine. Every signal stream votes on tokens.
 * Trades only fire when combined score crosses the threshold.
 *
 * Streams and their weights:
 *   wallet_follower  — 40pts per confirming wallet (max 120)
 *   whale_watcher    — 30pts (large on-chain buy detected)
 *   social_agent     — 20pts (social spike detected)
 *   spot_scanner     — 20pts (volume/momentum scanner)
 *   volume_spike     — 25pts (raw DexScreener volume surge)
 *
 * Thresholds:
 *   ≥ 60pts  = TRADE (minimum — wallet follower alone can hit this)
 *   ≥ 80pts  = HIGH CONVICTION (bigger position size)
 *   ≥ 100pts = MAX CONVICTION (maximum position size)
 *
 * This means:
 *   - 2 wallet confirmations (80pts) alone = trade
 *   - 1 wallet + whale (70pts) = trade
 *   - 1 wallet + social + volume (85pts) = high conviction
 *   - whale + social + volume (75pts) = trade
 *   - any single stream alone = no trade (noise filtered)
 */

'use strict';

// ─── SCORING WEIGHTS ─────────────────────────────────────────────────────────

const WEIGHTS = {
  wallet:   40,   // per confirming wallet (so 2 wallets = 80pts)
  whale:    30,   // large on-chain buy detected
  social:   20,   // social spike
  scanner:  20,   // volume/momentum scanner
  volume:   25,   // raw volume spike
};

const THRESHOLDS = {
  min:       60,   // minimum to trade
  high:      85,   // high conviction — 1.5x position size
  max:      110,   // max conviction — 2x position size
};

// Window within which signals must cluster to count together
const SIGNAL_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_TTL_MS     = 60 * 60 * 1000; // forget tokens after 1 hour

// ─── STATE ───────────────────────────────────────────────────────────────────

// Map<tokenKey, TokenEntry>
// TokenEntry: { symbol, chain, pairAddress, price, signals: Signal[], actedOn: bool, firstSeen: ts }
// Signal: { stream, weight, ts, meta }
const tokenStore = new Map();

// Callbacks registered by bot.js — fired when conviction threshold crossed
const tradeCallbacks = [];

// ─── GLOBAL ACTIVE TOKENS REGISTRY ──────────────────────────────────────────
// Shared cross-module deduplication — any module can register/check active tokens
// to prevent the same token being entered by both spot and wallet_follower simultaneously
const activeTokens = new Map(); // symbol/mint → { module, openedAt }

function registerActiveToken(key, moduleName) {
  activeTokens.set(key.toUpperCase(), { module: moduleName, openedAt: Date.now() });
}

function unregisterActiveToken(key) {
  activeTokens.delete(key.toUpperCase());
}

function isTokenActive(key) {
  return activeTokens.has(key.toUpperCase());
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * Log a signal from any stream.
 * @param {string} stream - one of: wallet, whale, social, scanner, volume
 * @param {object} token  - { symbol, chain, pairAddress, price, ...meta }
 * @param {object} meta   - extra info (walletCount, whaleSize, etc.)
 */
function logSignal(stream, token, meta = {}) {
  const key = token.pairAddress || `${token.chain}:${token.symbol}`;
  if (!key || key === 'undefined:undefined') return;

  const now = Date.now();
  const weight = computeWeight(stream, meta);

  if (!tokenStore.has(key)) {
    tokenStore.set(key, {
      key,
      symbol:      token.symbol || key.slice(0, 8),
      chain:       token.chain  || 'solana',
      pairAddress: token.pairAddress || null,
      tokenMint:   token.tokenMint   || null,
      price:       token.price || token.entryPrice || 0,
      signals:     [],
      actedOn:     false,
      firstSeen:   now,
    });
  }

  const entry = tokenStore.get(key);
  entry.price = token.price || token.entryPrice || entry.price;
  entry.signals.push({ stream, weight, ts: now, meta });

  const score = calcScore(entry);
  console.log(`[hub] ${entry.symbol} ← ${stream} +${weight}pts → total ${score}pts (${getSources(entry).join('+')})`);

  // Fire callbacks if threshold crossed for the first time
  if (!entry.actedOn && score >= THRESHOLDS.min) {
    entry.actedOn = true;
    const conviction = score >= THRESHOLDS.max ? 'MAX' : score >= THRESHOLDS.high ? 'HIGH' : 'STANDARD';
    const positionMult = score >= THRESHOLDS.max ? 2.0 : score >= THRESHOLDS.high ? 1.5 : 1.0;

    console.log(`\n[hub] 🔥 CONVICTION TRADE: ${entry.symbol} score=${score} (${conviction})`);
    console.log(`  Sources: ${getSources(entry).join(' + ')}`);
    console.log(`  Position multiplier: ${positionMult}x\n`);

    for (const cb of tradeCallbacks) {
      cb({ ...entry, score, conviction, positionMult }).catch(e =>
        console.error('[hub] callback error:', e.message)
      );
    }
  }
}

/**
 * Register a callback fired when a token crosses the conviction threshold.
 * Callback receives the full token entry + score/conviction info.
 */
function onConvictionTrade(callback) {
  tradeCallbacks.push(callback);
}

/**
 * Get all tokens currently above threshold (for status display).
 */
function getActiveSignals() {
  const now = Date.now();
  const out = [];
  for (const [key, entry] of tokenStore.entries()) {
    if (now - entry.firstSeen > TOKEN_TTL_MS) { tokenStore.delete(key); continue; }
    const score = calcScore(entry);
    if (score > 0) {
      out.push({
        symbol:     entry.symbol,
        chain:      entry.chain,
        score,
        sources:    getSources(entry),
        actedOn:    entry.actedOn,
        ageMin:     Math.round((now - entry.firstSeen) / 60000),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Get hub stats.
 */
function getStats() {
  const signals = getActiveSignals();
  return {
    tracked:   tokenStore.size,
    active:    signals.length,
    actedOn:   signals.filter(s => s.actedOn).length,
    topSignals: signals.slice(0, 5),
    thresholds: THRESHOLDS,
  };
}

// Legacy compatibility — old modules use logSignal(agent, token)
// Detect old-style call and remap
const _origLogSignal = logSignal;
module.exports.logSignal = function(agentOrStream, token, meta) {
  // Old style: logSignal('whale_watcher', { symbol, ... })
  // New style: logSignal('whale', { symbol, ... }, { size: ... })
  const streamMap = {
    whale_watcher: 'whale',
    social_agent:  'social',
    spot:          'scanner',
    scanner:       'scanner',
    wallet:        'wallet',
    wallet_follower: 'wallet',
  };
  const stream = streamMap[agentOrStream] || agentOrStream;
  return _origLogSignal(stream, token, meta || {});
};

// ─── INTERNAL ────────────────────────────────────────────────────────────────

function computeWeight(stream, meta) {
  const base = WEIGHTS[stream] || 10;

  // Wallet stream: scale by wallet count
  if (stream === 'wallet') {
    const count = meta.walletCount || 1;
    return base * count; // 40 per wallet
  }

  // Whale stream: scale by trade size
  if (stream === 'whale') {
    const size = meta.tradeSize || 10000;
    if (size >= 50000) return base + 15; // big whale bonus
    if (size >= 25000) return base + 8;
    return base;
  }

  return base;
}

function calcScore(entry) {
  const now = Date.now();
  // Only count signals within the window
  const recent = entry.signals.filter(s => now - s.ts < SIGNAL_WINDOW_MS);

  // Deduplicate by stream — each stream can only contribute once
  // (use highest weight signal per stream)
  const byStream = new Map();
  for (const sig of recent) {
    const existing = byStream.get(sig.stream);
    if (!existing || sig.weight > existing.weight) {
      byStream.set(sig.stream, sig);
    }
  }

  return Array.from(byStream.values()).reduce((sum, s) => sum + s.weight, 0);
}

function getSources(entry) {
  const now = Date.now();
  const recent = entry.signals.filter(s => now - s.ts < SIGNAL_WINDOW_MS);
  return [...new Set(recent.map(s => s.stream))];
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tokenStore.entries()) {
    if (now - entry.firstSeen > TOKEN_TTL_MS) tokenStore.delete(key);
  }
}, 10 * 60 * 1000);

// Legacy exports for old modules that use getConfirmed/markActedOn
module.exports.getConfirmed = function() {
  return getActiveSignals()
    .filter(s => !s.actedOn && s.score >= THRESHOLDS.min)
    .map(s => ({
      symbol:          s.symbol,
      chain:           s.chain,
      agents:          s.sources,
      agentCount:      s.sources.length,
      budgetMultiplier: s.score >= THRESHOLDS.max ? 2 : s.score >= THRESHOLDS.high ? 1.5 : 1,
    }));
};

module.exports.markActedOn = function(key) {
  const entry = tokenStore.get(key);
  if (entry) entry.actedOn = true;
};

module.exports.getStats    = getStats;
module.exports.getActiveSignals = getActiveSignals;
module.exports.onConvictionTrade = onConvictionTrade;

// Cross-module token deduplication
module.exports.registerActiveToken   = registerActiveToken;
module.exports.unregisterActiveToken = unregisterActiveToken;
module.exports.isTokenActive         = isTokenActive;
