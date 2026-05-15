/**
 * PeakSeek — /balance command
 * Shows the user's live SOL balance, USD value, and reserved profits.
 */

'use strict';

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { replyMd } = require('../telegram');
const { getUserPublicKey, getUserWalletInfo } = require('../user_wallets');
const { trial } = require('../state');

const RPCS = [
  'https://solana-rpc.publicnode.com',
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
];

async function getSolPrice() {
  try {
    // Try Jupiter price API v2
    const r = await fetch('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112');
    const json = await r.json();
    const price = json?.data?.['So11111111111111111111111111111111111111112']?.price;
    if (price) return parseFloat(price);

    // Fallback: CoinGecko
    const r2 = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const json2 = await r2.json();
    return json2?.solana?.usd ? parseFloat(json2.solana.usd) : null;
  } catch {
    return null;
  }
}

async function getSolBalance(publicKeyStr) {
  for (const rpc of RPCS) {
    try {
      const connection = new Connection(rpc, 'confirmed');
      const pubkey = new PublicKey(publicKeyStr);
      const lamports = await connection.getBalance(pubkey);
      return lamports / LAMPORTS_PER_SOL;
    } catch { continue; }
  }
  return null;
}

async function handleBalance(chatId, userId) {
  const publicKey = getUserPublicKey(userId);
  if (!publicKey) {
    await replyMd(chatId, '⚠️ No trading wallet found. Please use /start to set up your account.');
    return;
  }

  await replyMd(chatId, '⏳ Fetching your balance...');

  const [solBalance, solPrice] = await Promise.all([
    getSolBalance(publicKey),
    getSolPrice(),
  ]);

  if (solBalance === null) {
    await replyMd(chatId, '⚠️ Could not fetch balance right now. Please try again in a moment.');
    return;
  }

  const usdValue = solPrice ? solBalance * solPrice : null;
  const reserve = trial?.reserve || 0;
  const totalUsd = usdValue !== null ? usdValue + reserve : null;

  const lines = [
    `💼 *Your Trading Balance*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
  ];

  if (solBalance === 0) {
    lines.push(`💎 SOL: \`0.0000 SOL\``);
    lines.push(`💵 Value: $0.00 USD`);
    lines.push(``);
    lines.push(`No funds yet — tap /deposit to get started! 🚀`);
  } else {
    lines.push(`💎 SOL: \`${solBalance.toFixed(4)} SOL\``);
    if (usdValue !== null) {
      lines.push(`💵 Value: ~$${usdValue.toFixed(2)} USD`);
    }
    if (reserve > 0) {
      lines.push(``);
      lines.push(`🏦 Reserved profit: $${reserve.toFixed(2)} USDT`);
      if (totalUsd !== null) {
        lines.push(`📊 Total value: ~$${totalUsd.toFixed(2)} USD`);
      }
    }
  }

  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`💰 /deposit — Add funds`);
  lines.push(`💸 /withdraw — Withdraw funds`);
  lines.push(`📈 /trial — View performance`);

  await replyMd(chatId, lines.join('\n'));
}

module.exports = { handleBalance };
