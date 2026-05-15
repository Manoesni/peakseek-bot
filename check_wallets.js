/**
 * Wallet validator — checks which wallets are actually doing token swaps
 * Run: node check_wallets.js
 */

const HELIUS_KEY = '6fdc7454-7307-4f3f-9805-a2ee19b2917d';

const wallets = [
  // Current tracked wallets
  '4CH1wgHqyirN8KR3o9L8oYNpDtRmDccCtiRJjnjLtnYp',
  'GaG7v3rLYxFxAHV2BBt6bequNBirBwL6qKATwJXntisY',
  '6S8GezkxYUfZy9JPtYnanbcZTMB87Wjt1qx3c6ELajKC',
  '3nG9zBc6fTne3j9kkS1CB5quyt25CS29GEjvMGNKmDSz',
  '4xM5t84MsqMwPCA2goEzaaMywQZi6hAbMu8n7LZApppi',
  'HEq5VR1iu2cMC899q76BCQnFTTJrtay7NZPzmhCAWtrQ',
  '3JD7zrZVXfGozgaSrnn3GzAcGsHCM5ATazX8EqwJqZWY',
  'DZAa55HwXgv5hStwaTEJGXZz1DhHejvpb7Yr762urXam',
  'Hw5UKBU5k3YudnGwaykj5E8cYUidNMPuEewRRar5Xoc7',
  '9Vk7pkBZ9KFJmzaPzNYjGedyz8qoKMQtnYyYi2AehNMT',
  '5d3jQcuUvsuHyZkhdp78FFqc7WogrzZpTtec1X9VNkuE',
  'teddyYXw7aiNpDuQCeLb2YiBJhqthBid4C54BuWcPxm',
  'suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK',
  '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9',
  '2gSzFCwozvNBHH3sDNHAJxwqbAXvL93brVapmSWTExU3',
  'GFrra49Go4bN7zKB5AjwrWXmwL6aFz5aena6KAEHNiej',
  'CY88tFMoUXiUab1pBhaa2FoqjSeWezwnehdy7LysAans',
  'bTiNAiDWsAzuDvqf1vGcv3GuvgLxVvaj76KABoqkJa6',
  // New candidates from gmgn.ai page 2
  '9ThkXgRpJ9twXELT2TfvbdaAuJJsbpyHFVVHtocDkWxh',
  '21vaYvUUE4ND1bVt1tcGiXUXHe41w53unQd5DmCDeLZ1',
  'nrzLzxvq1EENDEi5cYp2H8ZscyLKa79yfQ9XWm3zbxt',
  'DxM1hfY8FQ8dNGrucuJzhJcF8KRbjk8WBwrgKvQ9spPv',
  'HmBmSYwYEgEZuBUYuDs9xofyqBAkw4ywugB1d7R7sTGh',
  '78N177fzNJpp8pG49xDv1efYcTMSzo9tPTKEA9mAVkh2',
  '4qBgLA3vXnjkAAAzBB5wLN9AS9ckivNKppemB2P5ixCu',
  'EoxtfjMw48FxC158esdyvbejj2t6tQw1VTxgHwcHkb72',
  '65kmABTfVidnwPzs5bfeyptpM2ewkkNewnJK6QwUSKXE',
  'isoQDhiRHcHPcVUjiyXh11ZppmdPLehhCzZN8cLuzBG',
];

const WSOL = 'So11111111111111111111111111111111111111112';

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function checkWallet(wallet) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [wallet, { limit: 20 }] }),
  });

  const sigs = (res?.result || []).map(s => s.signature);
  if (!sigs.length) return { wallet, swaps: 0, unknowns: 0, total: 0 };

  // Parse transactions
  const txRes = await fetchJson(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: sigs.slice(0, 10) }),
  });

  const txs = txRes || [];
  const swaps = txs.filter(t => t.type === 'SWAP').length;
  const unknowns = txs.filter(t => t.type === 'UNKNOWN' && (t.tokenTransfers||[]).length > 0).length;
  const transfers = txs.filter(t => t.type === 'TRANSFER').length;

  // Count real token buys via tokenTransfers (Jupiter shows here, not events.swap)
  const tokenSwaps = txs.filter(t => {
    if (t.type !== 'SWAP') return false;
    const transfers = t.tokenTransfers || [];
    // Find a transfer TO this wallet that isn't WSOL
    const received = transfers.find(tr =>
      tr.toUserAccount === wallet &&
      tr.mint !== WSOL
    );
    return !!received;
  }).length;

  // Also check what tokens are being received
  const tokensReceived = [];
  txs.forEach(t => {
    if (t.type !== 'SWAP') return;
    (t.tokenTransfers || []).forEach(tr => {
      if (tr.toUserAccount === wallet && tr.mint !== WSOL) {
        tokensReceived.push(tr.symbol || tr.mint.slice(0,8));
      }
    });
  });

  return { wallet: wallet.slice(0,8), swaps, tokenSwaps, unknowns, transfers, total: txs.length, tokens: tokensReceived.slice(0,3) };
}

async function main() {
  console.log('Checking wallets...\n');
  const results = [];

  for (const w of wallets) {
    try {
      const r = await checkWallet(w);
      results.push(r);
      console.log(`${r.wallet}... swaps=${r.swaps} tokenBuys=${r.tokenSwaps} tokens=[${r.tokens.join(',')}]`);
      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      console.log(`${w.slice(0,8)}... ERROR: ${e.message}`);
    }
  }

  console.log('\n=== BEST WALLETS (most token swaps) ===');
  results.sort((a,b) => (b.tokenSwaps + b.unknowns) - (a.tokenSwaps + a.unknowns));
  results.forEach(r => {
    const score = r.tokenSwaps + r.unknowns;
    console.log(`${score >= 3 ? '✅' : '❌'} ${r.wallet}... score=${score}`);
  });
}

main().catch(console.error);
