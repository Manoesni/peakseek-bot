/**
 * PeakSeek Multi-Source Scanner
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the single DexScreener scanner with 4 data sources:
 *
 *  1. GeckoTerminal  — Solana trending pools + new pools (best for Solana)
 *  2. GeckoTerminal  — ETH/BASE/BNB/ARB trending pools
 *  3. DexScreener    — New listings scanner (catch tokens in first hour)
 *  4. Hyperliquid    — Top movers + funding rate extremes (CEX momentum signal)
 *
 * Each source produces a list of candidates with a score 0–100.
 * The best candidates are merged, de-duped, and returned sorted by score.
 *
 * Installation:
 *   Copy this file to /Users/macpro/Desktop/peakseek/src/scanner.js
 *   Then update autopicker.js to use it (see instructions at bottom of file)
 *
 * Drop-in replacement — no new npm packages needed (uses built-in fetch, Node 22)
 */

'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const SCANNER_CONFIG = {
  // Minimum liquidity in USD to consider a pool
  minLiquidityUsd: 50000,

  // Minimum 5-min price change % to consider momentum real
  minM5ChangePct: 0.5,

  // Minimum 1h price change % (filters noise)
  minH1ChangePct: 0.0,

  // Maximum age of a new pool to be considered "new listing" (hours)
  newListingMaxAgeHours: 6,

  // Minimum 24h volume for new listings
  newListingMinVolume: 10000,

  // Hyperliquid: minimum 24h price change % to flag as mover
  hlMinChangePct: 2.0,

  // Request timeout ms
  timeoutMs: 8000,
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function safe(fn) {
  return async (...args) => {
    try { return await fn(...args); } catch (e) {
      console.error(`[scanner] ${fn.name} error:`, e.message);
      return [];
    }
  };
}

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCANNER_CONFIG.timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function scoreCandidate({ liq, chg24h, chgM5, chgH1, volume24h, isNew }) {
  // Liquidity score (0–30): sweet spot is $50k–$500k
  const liqScore = Math.min(30, (liq / 20000));

  // Momentum score (0–25): based on 24h change, capped at 25% move
  // Above 25% = already pumped, reward drops off fast
  const clampedChg = Math.min(Math.abs(chg24h), 25);
  const momScore = Math.min(25, clampedChg * 1.0);

  // Short-term momentum bonus (0–20): m5 and h1 confirming direction
  const stScore = (chgM5 > 0 && chgH1 > 0) ? Math.min(20, chgM5 * 4 + chgH1 * 2) : 0;

  // New listing bonus (0–15): fresh tokens have explosive potential
  const newBonus = isNew ? 15 : 0;

  // Direction penalty: if 24h negative, reduce score
  const dirPenalty = chg24h < 0 ? 10 : 0;

  // Already-exploded penalty: 24h > 100% means we're almost certainly late
  const explodedPenalty = chg24h > 100 ? 20 : chg24h > 50 ? 10 : 0;

  return Math.round(Math.max(0, Math.min(99,
    liqScore + momScore + stScore + newBonus - dirPenalty - explodedPenalty
  )));
}

// ─── SOURCE 1: GECKOTERMINAL SOLANA TRENDING ─────────────────────────────────

const fetchSolanaTrending = safe(async function fetchSolanaTrending() {
  const data = await fetchJson(
    'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1',
    { headers: { 'Accept': 'application/json;version=20230302' } }
  );

  const pools = data?.data || [];
  const results = [];

  for (const pool of pools) {
    const attr = pool.attributes || {};
    const liq = Number(attr.reserve_in_usd || 0);
    const vol24h = Number(attr.volume_usd?.h24 || 0);
    const chg24h = Number(attr.price_change_percentage?.h24 || 0);
    const chgH1 = Number(attr.price_change_percentage?.h1 || 0);
    const chgM5 = Number(attr.price_change_percentage?.m5 || 0);
    const symbol = String(attr.name || '').split('/')[0].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pairAddress = pool.id?.replace('solana_', '') || '';

    if (!symbol || !pairAddress) continue;
    if (liq < SCANNER_CONFIG.minLiquidityUsd) continue;
    if (chgM5 < SCANNER_CONFIG.minM5ChangePct) continue;

    results.push({
      symbol,
      chain: 'solana',
      pairAddress,
      priceUsd: Number(attr.base_token_price_usd || 0),
      chg24h,
      chgH1,
      chgM5,
      liq,
      vol24h,
      isNew: false,
      source: 'gecko_sol_trending',
      score: scoreCandidate({ liq, chg24h, chgM5, chgH1, volume24h: vol24h, isNew: false })
    });
  }

  console.log(`[scanner] GeckoTerminal Solana trending: ${results.length} candidates`);
  return results;
});

// ─── SOURCE 2: GECKOTERMINAL SOLANA NEW POOLS ─────────────────────────────────

const fetchSolanaNewPools = safe(async function fetchSolanaNewPools() {
  const data = await fetchJson(
    'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
    { headers: { 'Accept': 'application/json;version=20230302' } }
  );

  const pools = data?.data || [];
  const results = [];
  const nowMs = Date.now();
  const maxAgeMs = SCANNER_CONFIG.newListingMaxAgeHours * 3600 * 1000;

  for (const pool of pools) {
    const attr = pool.attributes || {};
    const createdAt = attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : 0;
    const ageMs = nowMs - createdAt;
    if (ageMs > maxAgeMs) continue;

    const liq = Number(attr.reserve_in_usd || 0);
    const vol24h = Number(attr.volume_usd?.h24 || 0);
    const chg24h = Number(attr.price_change_percentage?.h24 || 0);
    const chgH1 = Number(attr.price_change_percentage?.h1 || 0);
    const chgM5 = Number(attr.price_change_percentage?.m5 || 0);
    const symbol = String(attr.name || '').split('/')[0].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pairAddress = pool.id?.replace('solana_', '') || '';

    if (!symbol || !pairAddress) continue;
    if (liq < SCANNER_CONFIG.minLiquidityUsd) continue;
    if (vol24h < SCANNER_CONFIG.newListingMinVolume) continue;
    if (chgM5 <= 0) continue;

    const ageHours = ageMs / 3600000;
    console.log(`[scanner] New pool: ${symbol} (${ageHours.toFixed(1)}h old, liq $${liq.toFixed(0)})`);

    results.push({
      symbol,
      chain: 'solana',
      pairAddress,
      priceUsd: Number(attr.base_token_price_usd || 0),
      chg24h,
      chgH1,
      chgM5,
      liq,
      vol24h,
      isNew: true,
      ageHours,
      source: 'gecko_sol_new',
      score: scoreCandidate({ liq, chg24h, chgM5, chgH1, volume24h: vol24h, isNew: true })
    });
  }

  console.log(`[scanner] GeckoTerminal Solana new pools: ${results.length} candidates`);
  return results;
});

// ─── SOURCE 3: GECKOTERMINAL MULTI-CHAIN TRENDING ────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const fetchMultiChainTrending = safe(async function fetchMultiChainTrending() {
  const chains = ['eth']; // base+bsc+arbitrum disabled — consistent 429s
  const chainMap = { eth: 'ethereum', base: 'base' };
  const results = [];

  for (const chain of chains) {
    try {
      const data = await fetchJson(
        `https://api.geckoterminal.com/api/v2/networks/${chain}/trending_pools?page=1`,
        { headers: { 'Accept': 'application/json;version=20230302' } }
      );

      const pools = data?.data || [];
      for (const pool of pools) {
        const attr = pool.attributes || {};
        const liq = Number(attr.reserve_in_usd || 0);
        const vol24h = Number(attr.volume_usd?.h24 || 0);
        const chg24h = Number(attr.price_change_percentage?.h24 || 0);
        const chgH1 = Number(attr.price_change_percentage?.h1 || 0);
        const chgM5 = Number(attr.price_change_percentage?.m5 || 0);
        const symbol = String(attr.name || '').split('/')[0].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pairAddress = pool.id?.replace(`${chain}_`, '') || '';

        if (!symbol || !pairAddress) continue;
        if (liq < SCANNER_CONFIG.minLiquidityUsd) continue;
        if (chgM5 < SCANNER_CONFIG.minM5ChangePct) continue;

        results.push({
          symbol,
          chain: chainMap[chain],
          pairAddress,
          priceUsd: Number(attr.base_token_price_usd || 0),
          chg24h,
          chgH1,
          chgM5,
          liq,
          vol24h,
          isNew: false,
          source: `gecko_${chain}_trending`,
          score: scoreCandidate({ liq, chg24h, chgM5, chgH1, volume24h: vol24h, isNew: false })
        });
      }
    } catch (e) {
      console.error(`[scanner] GeckoTerminal ${chain} error:`, e.message);
    }

    // Stagger requests — GeckoTerminal free tier rate-limits parallel calls
    if (chain !== chains[chains.length - 1]) await sleep(5000);
  }

  console.log(`[scanner] GeckoTerminal multi-chain trending: ${results.length} candidates`);
  return results;
});

// ─── SOURCE 4: DEXSCREENER NEW LISTINGS ──────────────────────────────────────

const fetchDexScreenerNew = safe(async function fetchDexScreenerNew() {
  // DexScreener latest tokens endpoint — catches brand new listings
  const data = await fetchJson('https://api.dexscreener.com/token-profiles/latest/v1');
  const tokens = Array.isArray(data) ? data : [];
  const results = [];

  for (const t of tokens.slice(0, 50)) {
    const chainId = String(t.chainId || '');
    const addr = String(t.tokenAddress || '');
    if (!addr || !chainId) continue;

    // Fetch pair data for this token
    try {
      const pairData = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
      const pairs = pairData?.pairs || [];
      if (!pairs.length) continue;

      // Pick the pair with highest liquidity
      const best = pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
      const liq = Number(best.liquidity?.usd || 0);
      const vol24h = Number(best.volume?.h24 || 0);
      const chg24h = Number(best.priceChange?.h24 || 0);
      const chgH1 = Number(best.priceChange?.h1 || 0);
      const chgM5 = Number(best.priceChange?.m5 || 0);
      const symbol = String(best.baseToken?.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (!symbol) continue;
      if (liq < SCANNER_CONFIG.minLiquidityUsd) continue;
      if (vol24h < SCANNER_CONFIG.newListingMinVolume) continue;
      if (chgM5 <= 0) continue;

      results.push({
        symbol,
        chain: chainId,
        pairAddress: best.pairAddress,
        priceUsd: Number(best.priceUsd || 0),
        chg24h,
        chgH1,
        chgM5,
        liq,
        vol24h,
        isNew: true,
        source: 'dex_new_listing',
        score: scoreCandidate({ liq, chg24h, chgM5, chgH1, volume24h: vol24h, isNew: true })
      });
    } catch {}
  }

  console.log(`[scanner] DexScreener new listings: ${results.length} candidates`);
  return results;
});

// ─── SOURCE 5: HYPERLIQUID TOP MOVERS ────────────────────────────────────────

const fetchHyperliquidMovers = safe(async function fetchHyperliquidMovers() {
  const data = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' })
  });

  if (!Array.isArray(data) || data.length < 2) return [];

  const assets = data[0]?.universe || [];
  const ctxs = data[1] || [];
  const results = [];

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const ctx = ctxs[i];
    if (!asset || !ctx) continue;

    const symbol = String(asset.name || '').toUpperCase();
    const markPx = Number(ctx.markPx || 0);
    const prevDayPx = Number(ctx.prevDayPx || 0);
    const openInterest = Number(ctx.openInterest || 0);
    const funding = Number(ctx.funding || 0);

    if (!markPx || !prevDayPx) continue;

    const chg24h = ((markPx - prevDayPx) / prevDayPx) * 100;

    // Only take strong movers
    if (Math.abs(chg24h) < SCANNER_CONFIG.hlMinChangePct) continue;
    // Only longs for now — positive momentum
    if (chg24h <= 0) continue;

    // Funding rate signal: negative funding = shorts paying longs = bullish squeeze potential
    const fundingSignal = funding < 0 ? 10 : 0;

    const score = Math.round(Math.min(99, Math.abs(chg24h) * 2 + fundingSignal + 20));

    results.push({
      symbol,
      chain: 'hyperliquid',
      pairAddress: null,
      priceUsd: markPx,
      chg24h,
      chgH1: 0,
      chgM5: 0,
      liq: openInterest * markPx,
      vol24h: 0,
      isNew: false,
      funding,
      source: 'hyperliquid_mover',
      score
    });
  }

  // Sort by change magnitude
  results.sort((a, b) => Math.abs(b.chg24h) - Math.abs(a.chg24h));
  console.log(`[scanner] Hyperliquid movers: ${results.length} candidates`);
  return results.slice(0, 10);
});

// ─── MAIN SCAN FUNCTION ───────────────────────────────────────────────────────

async function runScan(options = {}) {
  const {
    minScore = 55,
    maxResults = 20,
    includeSolana = true,
    includeEvm = true,
    includeNewListings = true,
    includeHyperliquid = true,
  } = options;

  console.log('[scanner] Starting multi-source scan...');
  const startMs = Date.now();

  // Solana + Hyperliquid run in parallel (different APIs, no rate conflict)
  const [solanaTrending, solanNew, hlMovers] = await Promise.all([
    includeSolana      ? fetchSolanaTrending()   : [],
    includeSolana      ? fetchSolanaNewPools()   : [],
    includeHyperliquid ? fetchHyperliquidMovers() : [],
  ]);

  // EVM chains run sequentially (2.5s apart) to avoid GeckoTerminal 429
  const multiChain = includeEvm ? await fetchMultiChainTrending() : [];

  // DexScreener uses a different API — runs after EVM to spread load
  await sleep(1000);
  const newListings = includeNewListings ? await fetchDexScreenerNew() : [];

  // Merge all candidates
  const all = [
    ...solanaTrending,
    ...solanNew,
    ...multiChain,
    ...newListings,
    ...hlMovers,
  ];

  // De-duplicate by pairAddress (keep highest score)
  const seen = new Map();
  for (const c of all) {
    const key = c.pairAddress || `${c.symbol}_${c.chain}`;
    if (!seen.has(key) || seen.get(key).score < c.score) {
      seen.set(key, c);
    }
  }

  // Filter by minimum score and sort
  const filtered = [...seen.values()]
    .filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  const elapsed = Date.now() - startMs;
  console.log(`[scanner] Scan complete in ${elapsed}ms — ${filtered.length} candidates above score ${minScore}`);

  if (filtered.length > 0) {
    console.log('[scanner] Top 5:');
    filtered.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i+1}. ${c.symbol} (${c.chain}) score=${c.score} chg24h=${c.chg24h.toFixed(2)}% liq=$${Math.round(c.liq).toLocaleString()} src=${c.source}`);
    });
  }

  return filtered;
}

module.exports = { runScan, SCANNER_CONFIG };

// ─── AUTOPICKER INTEGRATION INSTRUCTIONS ─────────────────────────────────────
//
// In /Users/macpro/Desktop/peakseek/src/autopicker.js:
//
// 1. Add at the top:
//    const { runScan } = require('./scanner');
//
// 2. Replace the fetchRows() function call inside runAutoPickOnce with:
//    const rows = await runScan({ minScore: 55, maxResults: 30 });
//
// 3. Update the loop to use scanner output format:
//    for (const r of rows) {
//      const sym = String(r.symbol).toUpperCase();
//      const chainRaw = r.chain;
//      ... (rest stays the same)
//    }
//
// The scanner output format matches what autopicker expects:
//   { token/symbol, chain, pairAddress, priceUsd, chg24h/chg, score }
