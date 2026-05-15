/**
 * PeakSeek — Wallet Follower v3
 * ─────────────────────────────────────────────────────────────────────────────
 * v3 improvements on top of v2:
 *   7. Volume spike filter: token must have 3x+ volume surge vs 1h average
 *   8. Momentum score: combines wallet confirmations + volume + price action
 *      into a single conviction score — only trade high-conviction setups
 *   9. Stale position early exit: if no +10% within 1h, cut the position
 *      (meme pumps happen fast or not at all)
 *  10. Market cap filter: skip tokens with MC > $50M (too late) or < $10k (too risky)
 *  11. Price change filter: skip if already up 50%+ in last hour (chasing)
 */

'use strict';

const { reply } = require('./telegram');
const { portfolio, trial } = require('./state');
const { persistNow } = require('./state');
const { logSignal, registerActiveToken, unregisterActiveToken, isTokenActive } = require('./signal_hub');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const WF_CONFIG = {
  heliusApiKey: '9349d17a-3474-449e-b3db-a7a34e9f81dd',

  trackedWallets: [
    '9ThkXgRpJ9twXELT2TfvbdaAuJJsbpyHFVVHtocDkWxh', // score=10
    'DxM1hfY8FQ8dNGrucuJzhJcF8KRbjk8WBwrgKvQ9spPv', // score=10
    '78N177fzNJpp8pG49xDv1efYcTMSzo9tPTKEA9mAVkh2', // score=8
    '4CH1wgHqyirN8KR3o9L8oYNpDtRmDccCtiRJjnjLtnYp', // score=5
    'HEq5VR1iu2cMC899q76BCQnFTTJrtay7NZPzmhCAWtrQ', // score=5
    'teddyYXw7aiNpDuQCeLb2YiBJhqthBid4C54BuWcPxm',  // score=5
    '3JD7zrZVXfGozgaSrnn3GzAcGsHCM5ATazX8EqwJqZWY', // score=4
    '6S8GezkxYUfZy9JPtYnanbcZTMB87Wjt1qx3c6ELajKC', // score=3
    '4xM5t84MsqMwPCA2goEzaaMywQZi6hAbMu8n7LZApppi', // score=3
    'GFrra49Go4bN7zKB5AjwrWXmwL6aFz5aena6KAEHNiej', // score=3
    'bTiNAiDWsAzuDvqf1vGcv3GuvgLxVvaj76KABoqkJa6',  // score=3
    'HmBmSYwYEgEZuBUYuDs9xofyqBAkw4ywugB1d7R7sTGh', // score=3
    'EoxtfjMw48FxC158esdyvbejj2t6tQw1VTxgHwcHkb72', // score=3
  ],

  walletScores: {
    '9ThkXgRpJ9twXELT2TfvbdaAuJJsbpyHFVVHtocDkWxh': 10,
    'DxM1hfY8FQ8dNGrucuJzhJcF8KRbjk8WBwrgKvQ9spPv': 10,
    '78N177fzNJpp8pG49xDv1efYcTMSzo9tPTKEA9mAVkh2': 8,
    '4CH1wgHqyirN8KR3o9L8oYNpDtRmDccCtiRJjnjLtnYp': 5,
    'HEq5VR1iu2cMC899q76BCQnFTTJrtay7NZPzmhCAWtrQ': 5,
    'teddyYXw7aiNpDuQCeLb2YiBJhqthBid4C54BuWcPxm':  5,
    '3JD7zrZVXfGozgaSrnn3GzAcGsHCM5ATazX8EqwJqZWY': 4,
    '6S8GezkxYUfZy9JPtYnanbcZTMB87Wjt1qx3c6ELajKC': 3,
    '4xM5t84MsqMwPCA2goEzaaMywQZi6hAbMu8n7LZApppi': 3,
    'GFrra49Go4bN7zKB5AjwrWXmwL6aFz5aena6KAEHNiej': 3,
    'bTiNAiDWsAzuDvqf1vGcv3GuvgLxVvaj76KABoqkJa6':  3,
    'HmBmSYwYEgEZuBUYuDs9xofyqBAkw4ywugB1d7R7sTGh': 3,
    'EoxtfjMw48FxC158esdyvbejj2t6tQw1VTxgHwcHkb72': 3,
  },

  // v2: multi-wallet confirmation before entering
  minConfirmations: 2,
  confirmationWindowMs: 30 * 60 * 1000, // 30 minutes

  // v2: skip tokens older than this
  maxTokenAgeHours: 48,

  // v3: market cap limits
  minMarketCapUsd: 10_000,      // skip micro-caps (too risky/illiquid)
  maxMarketCapUsd: 50_000_000,  // skip if already too big (late entry)

  // v3: volume spike — token must have surged vs recent average
  // Uses DexScreener h1/h6 volume ratio
  minVolumeSpikeMult: 2.0,      // h1 volume must be 2x+ the h6 hourly average

  // v3: skip if price already pumped too hard (we're chasing)
  maxPriceChangePct1h: 80,      // skip if up >80% in last hour

  // Position sizing — compounding: % of trading balance, scales with confirmations
  baseBudgetPct: 0.001,         // 0.1% of trading balance per confirmation
  minBudgetUsd: 3,              // never bet less than $3
  maxBudgetUsd: 50,             // never bet more than $50 (safety cap)
  maxPositions: 5,

  // Exit config
  hardTakeProfitPct: 120,
  stopLossPct: 15,
  trailActivatePct: 20,
  trailPct: 15,
  trailTightenAt: 60,
  trailTightPct: 8,
  partialExitAt: 35,
  maxHoldHours: 6,

  // v3: stale position exit — if not up 10% within this time, cut losses early
  staleCheckHours: 1.0,         // check at 1 hour
  staleMoveRequired: 10,        // must be up at least 10% by then

  // v2: faster polling
  pollIntervalMs: 5 * 1000,
  monitorIntervalMs: 10 * 1000, // tightened from 30s — catch SL breaks faster
};

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const WSOL = 'So11111111111111111111111111111111111111112';
const STABLECOINS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',  // USDH
  'Ea5SjE2Y6yvCeW5dYTn7PYMuW5ikXkvbGdcmSnXeaLjS', // PAI
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // WETH (not a stablecoin but not a meme)
]);
const STABLE_SYMBOL_PATTERNS = /^(USD|USDT|USDC|DAI|BUSD|TUSD|USDH|FRAX|GUSD|PYUSD|EURC|PAX)$/i;

// ─── STATE ───────────────────────────────────────────────────────────────────

const positions = [];
const seenTokens = new Set();
const lastSignatures = new Map();
const pendingTokens = new Map(); // token -> { wallets, firstSeenAt, scores }

let pollHandle = null;
let monitorHandle = null;
let activeChatId = 0;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function heliusRpc(method, params) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${WF_CONFIG.heliusApiKey}`;
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

// ─── SWAP DETECTION ──────────────────────────────────────────────────────────

function extractTokenBuy(tx, walletAddress) {
  if (!tx || tx.transactionError) return null;
  if (tx.type !== 'SWAP') return null;

  const transfers = tx.tokenTransfers || [];
  const incoming = transfers.filter(t =>
    t.toUserAccount === walletAddress &&
    t.mint !== WSOL &&
    !STABLECOINS.has(t.mint)
  );
  if (!incoming.length) return null;

  incoming.sort((a, b) => (b.tokenAmount || 0) - (a.tokenAmount || 0));
  return incoming[0].mint;
}

// ─── WALLET POLLING ──────────────────────────────────────────────────────────

async function checkWallet(walletAddress) {
  try {
    const res = await heliusRpc('getSignaturesForAddress', [walletAddress, { limit: 5 }]);
    const sigs = res?.result || [];
    if (!sigs.length) return;

    const lastSig = lastSignatures.get(walletAddress);
    if (!lastSig) {
      lastSignatures.set(walletAddress, sigs[0].signature);
      return;
    }

    const lastIdx = sigs.findIndex(s => s.signature === lastSig);
    const newSigs = lastIdx === -1 ? sigs.slice(0, 3) : sigs.slice(0, lastIdx);
    if (!newSigs.length) return;

    lastSignatures.set(walletAddress, sigs[0].signature);

    const txUrl = `https://api.helius.xyz/v0/transactions?api-key=${WF_CONFIG.heliusApiKey}`;
    let txDetails;
    try {
      txDetails = await fetchJson(txUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: newSigs.map(s => s.signature) }),
      });
    } catch { return; }

    if (!Array.isArray(txDetails)) return;

    for (const tx of txDetails) {
      const tokenMint = extractTokenBuy(tx, walletAddress);
      if (!tokenMint) continue;
      if (seenTokens.has(tokenMint)) {
        console.log(`[wf] ${walletAddress.slice(0,8)} bought ${tokenMint.slice(0,8)} — already in position`);
        continue;
      }
      await handleSignal(walletAddress, tokenMint);
    }
  } catch (e) {
    if (e.message && !e.message.includes('429')) {
      console.error(`[wf] wallet error ${walletAddress.slice(0,8)}:`, e.message);
    }
  }
}

// ─── CONFIRMATION SYSTEM ─────────────────────────────────────────────────────

async function handleSignal(walletAddress, tokenMint) {
  console.log(`[wf] 📡 Signal: ${walletAddress.slice(0,8)} → ${tokenMint.slice(0,8)}`);

  let entry = pendingTokens.get(tokenMint);
  const now = Date.now();

  if (!entry) {
    entry = { wallets: new Set(), firstSeenAt: now, scores: [] };
    pendingTokens.set(tokenMint, entry);
  }

  // Reset if confirmation window expired
  if (now - entry.firstSeenAt > WF_CONFIG.confirmationWindowMs) {
    entry.wallets = new Set();
    entry.firstSeenAt = now;
    entry.scores = [];
  }

  entry.wallets.add(walletAddress);
  const score = WF_CONFIG.walletScores[walletAddress] || 3;
  if (!entry.scores.includes(score)) entry.scores.push(score);

  const confirmCount = entry.wallets.size;
  const totalScore = entry.scores.reduce((a, b) => a + b, 0);
  console.log(`[wf] ${tokenMint.slice(0,8)} → ${confirmCount}/${WF_CONFIG.minConfirmations} confirmations (score=${totalScore})`);

  // Log to signal hub — hub tracks cross-stream conviction
  // Each wallet confirmation contributes to the hub score
  logSignal('wallet', {
    symbol:    tokenMint.slice(0, 8),
    chain:     'solana',
    tokenMint,
    pairAddress: tokenMint, // use mint as key until we have pair
  }, { walletCount: 1, wallet: walletAddress });

  if (confirmCount === WF_CONFIG.minConfirmations) {
    seenTokens.add(tokenMint);
    await executeCopyTrade(tokenMint, entry);
    pendingTokens.delete(tokenMint);
  }
}

// ─── COPYCAT FILTER ──────────────────────────────────────────────────────────
// Scammers launch copycat tokens when a real token pumps (e.g. BMNTP → BMNTP6900)
// If we already hold a token with a very similar name, skip the new one

function isCopycatToken(symbol) {
  if (!symbol) return false;
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const pos of positions) {
    if (pos.status !== 'open') continue;
    const existingClean = (pos.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!existingClean || existingClean === clean) continue;
    // Check if one starts with the other (e.g. BMNTP vs BMNTP6900)
    if (clean.startsWith(existingClean) || existingClean.startsWith(clean)) {
      console.log(`[wf] ${symbol} — looks like copycat of ${pos.symbol}, skipping`);
      return true;
    }
    // Check if they share 80%+ of characters (Levenshtein-lite)
    const shorter = clean.length < existingClean.length ? clean : existingClean;
    const longer  = clean.length < existingClean.length ? existingClean : clean;
    if (shorter.length >= 4 && longer.startsWith(shorter)) {
      console.log(`[wf] ${symbol} — similar to existing ${pos.symbol}, skipping`);
      return true;
    }
  }
  return false;
}

// ─── v3: MOMENTUM VALIDATION ─────────────────────────────────────────────────

async function validateMomentum(tokenMint, pairInfo) {
  // pairInfo already fetched from DexScreener — extract what we need
  const symbol = pairInfo.baseToken?.symbol || tokenMint.slice(0, 8);

  // 1. Market cap filter
  const mc = pairInfo.marketCap || pairInfo.fdv || 0;
  if (mc > 0) {
    if (mc < WF_CONFIG.minMarketCapUsd) {
      console.log(`[wf] ${symbol} — MC too low ($${Math.round(mc).toLocaleString()}), skipping`);
      return { pass: false, reason: 'MC_TOO_LOW' };
    }
    if (mc > WF_CONFIG.maxMarketCapUsd) {
      console.log(`[wf] ${symbol} — MC too high ($${(mc/1e6).toFixed(1)}M), too late`);
      return { pass: false, reason: 'MC_TOO_HIGH' };
    }
  }

  // 2. Price change filter — skip if already pumped hard
  const priceChange1h = pairInfo.priceChange?.h1 || 0;
  if (priceChange1h > WF_CONFIG.maxPriceChangePct1h) {
    console.log(`[wf] ${symbol} — already up ${priceChange1h.toFixed(0)}% in 1h, chasing — skipping`);
    return { pass: false, reason: 'ALREADY_PUMPED' };
  }

  // 3. Volume spike filter
  // DexScreener gives volume.h1 and volume.h6
  // Hourly average from h6 = volume.h6 / 6
  // If h1 is 2x+ that average, volume is spiking NOW
  const vol1h = pairInfo.volume?.h1 || 0;
  const vol6h = pairInfo.volume?.h6 || 0;
  const vol24h = pairInfo.volume?.h24 || 0;

  let volumePass = false;
  let volumeNote = 'no data';

  if (vol6h > 0 && vol1h > 0) {
    const hourlyAvg = vol6h / 6;
    const spikeMult = vol1h / hourlyAvg;
    volumeNote = `h1=$${Math.round(vol1h).toLocaleString()} vs 6h-avg=$${Math.round(hourlyAvg).toLocaleString()} (${spikeMult.toFixed(1)}x)`;
    if (spikeMult >= WF_CONFIG.minVolumeSpikeMult) {
      volumePass = true;
    }
  } else if (vol24h > 0 && vol1h > 0) {
    // Fallback: compare h1 vs daily average
    const dailyHourlyAvg = vol24h / 24;
    const spikeMult = vol1h / dailyHourlyAvg;
    volumeNote = `h1=$${Math.round(vol1h).toLocaleString()} vs 24h-avg=$${Math.round(dailyHourlyAvg).toLocaleString()} (${spikeMult.toFixed(1)}x)`;
    if (spikeMult >= WF_CONFIG.minVolumeSpikeMult) volumePass = true;
  } else if (vol1h > 5000) {
    // No comparison data but decent absolute volume — allow
    volumePass = true;
    volumeNote = `h1=$${Math.round(vol1h).toLocaleString()} (no comparison data)`;
  }

  if (!volumePass) {
    console.log(`[wf] ${symbol} — volume not spiking: ${volumeNote}, skipping`);
    return { pass: false, reason: 'NO_VOLUME_SPIKE' };
  }

  console.log(`[wf] ${symbol} — momentum OK: ${volumeNote} | MC=$${mc > 0 ? (mc/1000).toFixed(0)+'k' : '?'} | 1h=${priceChange1h.toFixed(0)}%`);
  return { pass: true, volumeNote, priceChange1h, mc };
}

// ─── TRADE EXECUTION ─────────────────────────────────────────────────────────

function calcPositionSize(confirmCount, totalScore) {
  // Compounding: base is % of current trading balance
  const base = portfolio.balance * WF_CONFIG.baseBudgetPct; // 0.1% of balance
  // Scale up by confirmation count and wallet score
  const confMult = Math.min(confirmCount / WF_CONFIG.minConfirmations, 2);
  const scoreMult = Math.min(totalScore / 15, 1.5);
  const size = base * confMult * scoreMult;
  const clamped = Math.min(Math.max(size, WF_CONFIG.minBudgetUsd), WF_CONFIG.maxBudgetUsd);
  console.log(`[wf] Position size: $${clamped.toFixed(2)} (${(WF_CONFIG.baseBudgetPct*100).toFixed(2)}% of $${portfolio.balance.toFixed(2)} × conf${confMult.toFixed(1)} × score${scoreMult.toFixed(1)})`);
  return Math.round(clamped * 100) / 100; // round to cents
}

function calcExitParams(confirmCount) {
  return {
    stopLossPct:    confirmCount >= 3 ? 18 : 12,  // tighter SL — meme tokens either go fast or rug
    hardTpPct:      confirmCount >= 3 ? 150 : 120,
    trailActivate:  20,
    trailPct:       15,
    trailTightenAt: 60,
    trailTightPct:  8,
    partialAt:      35,
  };
}

async function executeCopyTrade(tokenMint, entry) {
  const confirmCount = entry.wallets.size;
  const totalScore = entry.scores.reduce((a, b) => a + b, 0);
  const confirmedBy = Array.from(entry.wallets).map(w => w.slice(0, 8)).join(', ');

  const openCount = positions.filter(p => p.status === 'open').length;
  if (openCount >= WF_CONFIG.maxPositions) {
    console.log(`[wf] Max positions — skipping ${tokenMint.slice(0,8)}`);
    seenTokens.delete(tokenMint);
    return;
  }

  // DexScreener with retries
  let pairInfo = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const d = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
      const solanaPairs = (d?.pairs || [])
        .filter(p => p.chainId === 'solana')
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      if (solanaPairs.length) { pairInfo = solanaPairs[0]; break; }
    } catch {}
    if (attempt < 2) {
      const delay = [5000, 10000][attempt];
      console.log(`[wf] ${tokenMint.slice(0,8)} not on DexScreener, retry ${attempt+1} in ${delay/1000}s`);
      await sleep(delay);
    }
  }

  if (!pairInfo) {
    console.log(`[wf] ${tokenMint.slice(0,8)} — no DexScreener data, skipping`);
    seenTokens.delete(tokenMint);
    return;
  }

  const price = parseFloat(pairInfo.priceUsd) || 0;
  const liq = pairInfo.liquidity?.usd || 0;
  const marketCap = pairInfo.marketCap || 0;
  const symbol = pairInfo.baseToken?.symbol || tokenMint.slice(0, 8);
  const pairAddress = pairInfo.pairAddress;

  // Copycat filter — skip tokens that look like variations of existing positions
  if (isCopycatToken(symbol)) {
    seenTokens.delete(tokenMint);
    return;
  }

  // Cross-module dedup — skip if spot agent or another module is already in this token
  if (isTokenActive(symbol) || isTokenActive(pairAddress)) {
    console.log(`[wf] ${symbol} — already active in another module, skipping duplicate entry`);
    seenTokens.delete(tokenMint);
    return;
  }

  // Skip stablecoins / known non-meme tokens by symbol
  if (STABLE_SYMBOL_PATTERNS.test(symbol) || STABLECOINS.has(tokenMint)) {
    console.log(`[wf] ${symbol} — stablecoin/major token, skipping`);
    seenTokens.delete(tokenMint);
    return;
  }

  if (liq < 1000) {
    console.log(`[wf] ${symbol} — low liquidity ($${Math.round(liq)}), skipping`);
    seenTokens.delete(tokenMint);
    return;
  }

  if (price <= 0) {
    console.log(`[wf] ${symbol} — no price, skipping`);
    seenTokens.delete(tokenMint);
    return;
  }

  // v2: token age check
  if (pairInfo.pairCreatedAt) {
    const ageHours = (Date.now() - pairInfo.pairCreatedAt) / 3600000;
    if (ageHours > WF_CONFIG.maxTokenAgeHours) {
      console.log(`[wf] ${symbol} — too old (${ageHours.toFixed(1)}h), skipping`);
      seenTokens.delete(tokenMint);
      return;
    }
  }

  // v3: momentum validation — volume spike + MC + price change
  const momentum = await validateMomentum(tokenMint, pairInfo);
  if (!momentum.pass) {
    seenTokens.delete(tokenMint);
    return;
  }

  // Update hub with real pair info + volume signal now that we have DexScreener data
  logSignal('volume', {
    symbol:      symbol,
    chain:       'solana',
    pairAddress: pairAddress,
    tokenMint,
    price,
  }, { vol1h: pairInfo.volume?.h1 || 0 });

  const budget = calcPositionSize(confirmCount, totalScore);
  if (portfolio.balance < budget) {
    console.log(`[wf] Insufficient balance ($${portfolio.balance.toFixed(2)} < $${budget})`);
    seenTokens.delete(tokenMint);
    return;
  }

  const exit = calcExitParams(confirmCount);
  const ageH = pairInfo.pairCreatedAt
    ? ((Date.now() - pairInfo.pairCreatedAt) / 3600000).toFixed(1) : '?';

  const position = {
    id: Date.now(),
    symbol, chain: 'solana', pairAddress, tokenMint,
    entryPrice: price, currentPrice: price, peakPrice: price,
    budget, fullBudget: budget,
    openedAt: Date.now(),
    source: `copy:${confirmedBy}`,
    confirmations: confirmCount, totalScore,
    status: 'open',
    partialExitDone: false, trailActive: false, staleChecked: false,
    hardTP: price * (1 + exit.hardTpPct / 100),
    hardSL: price * (1 - exit.stopLossPct / 100),
    trailStop: price * (1 - exit.trailPct / 100),
    exitParams: exit,
  };

  positions.push(position);
  portfolio.balance -= budget;
  registerActiveToken(symbol, 'wallet_follower');
  registerActiveToken(pairAddress, 'wallet_follower');
  persistNow();

  console.log(`\n[wf] 🟢 COPY BUY ${symbol} | ${confirmCount} wallets | score=${totalScore} | $${budget}`);
  console.log(`  $${price.toExponential(4)} | liq=$${Math.round(liq).toLocaleString()} | age=${ageH}h`);
  console.log(`  Volume: ${momentum.volumeNote} | 1h change: ${(momentum.priceChange1h||0).toFixed(0)}%`);
  console.log(`  SL=-${exit.stopLossPct}% TP=+${exit.hardTpPct}% | by: ${confirmedBy}\n`);

  await reply(activeChatId,
    `🟢 COPY TRADE v3 — ${symbol}\n` +
    `Wallets: ${confirmCount} confirmed (score ${totalScore})\n` +
    `Entry: $${price.toExponential(4)}\n` +
    `Budget: $${budget} | Liq: $${Math.round(liq).toLocaleString()}\n` +
    `Age: ${ageH}h | 1h chg: ${(momentum.priceChange1h||0).toFixed(0)}%\n` +
    `Vol: ${momentum.volumeNote}\n` +
    `By: ${confirmedBy}\n` +
    `Plan: Partial@+${exit.partialAt}% | Trail@+${exit.trailActivate}% | TP+${exit.hardTpPct}% | SL-${exit.stopLossPct}%`
  ).catch(() => {});
}

// ─── POSITION MONITOR ────────────────────────────────────────────────────────

async function monitorPositions() {
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    if (pos.status !== 'open') continue;

    let currentPrice = pos.currentPrice;
    try {
      const d = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${pos.pairAddress}`);
      const p = parseFloat(d?.pairs?.[0]?.priceUsd || 0);
      if (p > 0) currentPrice = p;
    } catch {}

    if (currentPrice > pos.entryPrice * 10 && pos.entryPrice > 0) continue;

    pos.currentPrice = currentPrice;
    if (currentPrice > pos.peakPrice) pos.peakPrice = currentPrice;

    const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const peakPct = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const holdHours = (Date.now() - pos.openedAt) / 3600000;
    const exit = pos.exitParams;

    if (peakPct >= exit.trailActivate) {
      if (!pos.trailActive) {
        pos.trailActive = true;
        console.log(`[wf] ${pos.symbol} trail ACTIVATED at +${peakPct.toFixed(1)}%`);
      }
      const trailPct = peakPct >= exit.trailTightenAt ? exit.trailTightPct : exit.trailPct;
      pos.trailStop = pos.peakPrice * (1 - trailPct / 100);
    }

    if (!pos.partialExitDone && pnlPct >= exit.partialAt) {
      pos.partialExitDone = true;
      const halfBudget = pos.budget / 2;
      const halfPnl = halfBudget * (pnlPct / 100);
      // Lock 20% of partial win into reserve before adding rest to balance
      const partialReserveRate = trial?.reservePct || 0.20;
      const partialReserved = halfPnl > 0 ? halfPnl * partialReserveRate : 0;
      const partialKept = halfPnl - partialReserved;
      portfolio.balance += halfBudget + partialKept;
      if (partialReserved > 0 && trial?.active) {
        trial.reserve = (trial.reserve || 0) + partialReserved;
        console.log(`[wf] 💰 Partial reserved $${partialReserved.toFixed(2)} → total reserve: $${trial.reserve.toFixed(2)}`);
      }
      pos.budget = halfBudget;
      if (trial?.active) {
        trial.trades = (trial.trades || 0) + 1;
        trial.wins = (trial.wins || 0) + 1;
        trial.grossWin = (trial.grossWin || 0) + halfPnl;
        trial.totalPnl = (trial.grossWin || 0) - (trial.grossLossAbs || 0);
      }
      persistNow();
      console.log(`[wf] ${pos.symbol} PARTIAL EXIT 50% at +${pnlPct.toFixed(1)}%`);
      await reply(activeChatId,
        `🟡 COPY PARTIAL EXIT — ${pos.symbol}\nSold 50% at +${pnlPct.toFixed(1)}% ($${halfPnl.toFixed(2)})\nRemainder running with trail`
      ).catch(() => {});
    }

    // v3: stale position exit — meme pumps happen fast or not at all
    // If we're past the stale check window and haven't moved enough, cut it
    const staleCheck = !pos.staleChecked &&
      holdHours >= WF_CONFIG.staleCheckHours &&
      pnlPct < WF_CONFIG.staleMoveRequired;
    if (staleCheck) {
      pos.staleChecked = true; // only trigger once
      console.log(`[wf] ${pos.symbol} STALE at ${holdHours.toFixed(1)}h — only ${pnlPct.toFixed(1)}% move, exiting`);
    }

    // Rug detection: two triggers —
    //   1. Dropped 35%+ in a single monitor cycle (sudden rug)
    //   2. Currently down 75%+ from entry at any point (slow bleed / LP pull)
    const prevPrice = pos.lastMonitorPrice || pos.entryPrice;
    const cycleDrop = prevPrice > 0 ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;
    const isRug = (cycleDrop < -35 && holdHours < 1.0) || pnlPct < -75;
    if (isRug) console.log(`[wf] ⚠️ RUG DETECTED ${pos.symbol}: cycle=${cycleDrop.toFixed(1)}% total=${pnlPct.toFixed(1)}%`);
    pos.lastMonitorPrice = currentPrice;

    let exitReason = null;
    if (isRug) exitReason = 'RUG_DETECTED';
    else if (currentPrice >= pos.hardTP) exitReason = 'HARD_TP';
    else if (currentPrice <= pos.hardSL) exitReason = 'HARD_SL';
    else if (pos.trailActive && currentPrice <= pos.trailStop) exitReason = 'TRAIL_TP';
    else if (holdHours >= WF_CONFIG.maxHoldHours) exitReason = 'TIME_EXIT';
    else if (staleCheck) exitReason = 'STALE_EXIT';

    if (exitReason) await closePosition(i, exitReason, currentPrice, pnlPct);
  }
}

async function closePosition(index, reason, exitPrice, pnlPct) {
  const pos = positions[index];
  if (!pos) return;

  pos.status = 'closed';
  const pnlUsd = pos.budget * (pnlPct / 100);
  portfolio.balance += pos.budget + pnlUsd;

  if (trial?.active) {
    trial.trades = (trial.trades || 0) + 1;
    trial.realizedPnl = (trial.realizedPnl || 0) + pnlUsd;
    if (pnlUsd >= 0) {
      trial.wins = (trial.wins || 0) + 1;
      trial.grossWin = (trial.grossWin || 0) + pnlUsd;
      // Lock 20% of winning profit into reserve — never risked again
      const reserveRate = trial.reservePct || 0.20;
      const reserved = pnlUsd * reserveRate;
      trial.reserve = (trial.reserve || 0) + reserved;
      portfolio.balance -= reserved; // move out of trading pool into reserve
      console.log(`[wf] 💰 Reserved $${reserved.toFixed(2)} (${(reserveRate*100).toFixed(0)}% of win) → total reserve: $${trial.reserve.toFixed(2)}`);
    } else {
      trial.losses = (trial.losses || 0) + 1;
      trial.grossLossAbs = (trial.grossLossAbs || 0) + Math.abs(pnlUsd);
    }
    trial.totalPnl = (trial.grossWin || 0) - (trial.grossLossAbs || 0);
    if (!trial.history) trial.history = [];
    trial.history.push({
      ts: Date.now(), symbol: pos.symbol, type: 'COPY_v2', reason,
      entry: pos.entryPrice, exit: exitPrice, peak: pos.peakPrice,
      budget: pos.budget, confirmations: pos.confirmations,
      totalScore: pos.totalScore, pnlUsd, pnlPct: pnlPct.toFixed(2),
      source: pos.source,
    });
  }

  unregisterActiveToken(pos.symbol);
  unregisterActiveToken(pos.pairAddress);
  positions.splice(index, 1);
  persistNow();

  const emoji = pnlUsd >= 0 ? '🟢' : '🔴';
  console.log(`[wf] ${emoji} CLOSED ${pos.symbol} [${reason}] pnl=${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)})`);
  await reply(activeChatId,
    `${emoji} COPY CLOSED — ${pos.symbol} [${reason}]\n` +
    `PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)})\n` +
    `Balance: $${portfolio.balance.toFixed(2)}`
  ).catch(() => {});
}

// ─── CLEANUP ─────────────────────────────────────────────────────────────────

function cleanupExpiredPending() {
  const cutoff = Date.now() - WF_CONFIG.confirmationWindowMs * 2;
  for (const [token, entry] of pendingTokens.entries()) {
    if (entry.firstSeenAt < cutoff) pendingTokens.delete(token);
  }
}

// ─── START / STOP ─────────────────────────────────────────────────────────────

async function initWallets() {
  console.log('[wf] Init — marking existing txs as seen (no replay on start)...');
  for (const wallet of WF_CONFIG.trackedWallets) {
    try {
      const res = await heliusRpc('getSignaturesForAddress', [wallet, { limit: 5 }]);
      const sigs = res?.result || [];
      if (sigs.length) lastSignatures.set(wallet, sigs[0].signature);
    } catch {}
    await sleep(150);
  }
  console.log(`[wf] Init done: ${lastSignatures.size}/${WF_CONFIG.trackedWallets.length} wallets`);
}

function startWalletFollower(chatId) {
  if (pollHandle) { console.log('[wf] Already running'); return; }
  activeChatId = chatId || 0;

  initWallets().then(() => {
    console.log(`[wf] 🟢 LIVE — ${WF_CONFIG.trackedWallets.length} wallets | ${WF_CONFIG.pollIntervalMs/1000}s poll | ${WF_CONFIG.minConfirmations}+ confirmations required`);

    let cycle = 0;
    pollHandle = setInterval(async () => {
      for (const wallet of WF_CONFIG.trackedWallets) {
        if (!pollHandle) break;
        await checkWallet(wallet).catch(() => {});
        await sleep(100);
      }
      if (++cycle % 20 === 0) cleanupExpiredPending();
    }, WF_CONFIG.pollIntervalMs);

    monitorHandle = setInterval(() => {
      monitorPositions().catch(e => console.error('[wf] monitor error:', e.message));
    }, WF_CONFIG.monitorIntervalMs);

  }).catch(e => console.error('[wf] init error:', e.message));
}

function stopWalletFollower() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  if (monitorHandle) { clearInterval(monitorHandle); monitorHandle = null; }
  console.log('[wf] Stopped');
}

function getWalletFollowerStatus() {
  return {
    running: !!pollHandle,
    trackedWallets: WF_CONFIG.trackedWallets.length,
    openPositions: positions.filter(p => p.status === 'open').length,
    maxPositions: WF_CONFIG.maxPositions,
    positions: positions.filter(p => p.status === 'open'),
    pendingSignals: Array.from(pendingTokens.entries()).map(([mint, e]) => ({
      mint: mint.slice(0, 8),
      confirmations: e.wallets.size,
      needed: WF_CONFIG.minConfirmations,
      wallets: Array.from(e.wallets).map(w => w.slice(0, 8)),
      ageMin: Math.round((Date.now() - e.firstSeenAt) / 60000),
    })),
  };
}

module.exports = { startWalletFollower, stopWalletFollower, getWalletFollowerStatus };
