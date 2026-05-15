/**
 * PeakSeek — User Wallet Manager
 * ─────────────────────────────────────────────────────────────────────────────
 * Each user gets their own Solana keypair generated automatically on /start.
 * Simple and seamless for beta users — no key management needed.
 *
 * Security model (beta):
 *   - Private keys stored in data/wallets.json on the server
 *   - Users only interact with USDT — bot handles everything else
 *   - Upgrade path: Privy.io MPC wallets when scaling beyond beta
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { Keypair } = require('@solana/web3.js');

const WALLETS_FILE = '/Users/macpro/Desktop/peakseek/data/wallets.json';

// ─── STORAGE ─────────────────────────────────────────────────────────────────

function loadWallets() {
  try {
    if (fs.existsSync(WALLETS_FILE)) {
      return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveWallets(wallets) {
  const dir = path.dirname(WALLETS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

// ─── WALLET OPERATIONS ────────────────────────────────────────────────────────

/**
 * Get or create a Solana wallet for a Telegram user.
 * Completely automatic — user never sees or touches the key.
 */
function getOrCreateWallet(telegramUserId) {
  const wallets = loadWallets();
  const uid = String(telegramUserId);

  if (wallets[uid]) {
    return { publicKey: wallets[uid].publicKey, isNew: false };
  }

  // Generate fresh Solana keypair
  const keypair    = Keypair.generate();
  const publicKey  = keypair.publicKey.toBase58();
  const privateKey = Buffer.from(keypair.secretKey).toString('base64');

  wallets[uid] = {
    telegramUserId: uid,
    publicKey,
    privateKey,
    botEnabled:    false,
    createdAt:     Date.now(),
    depositOrders: [],
    withdrawOrders: [],
  };

  saveWallets(wallets);
  console.log(`[wallets] New wallet created for user ${uid}: ${publicKey}`);

  return { publicKey, isNew: true };
}

function getUserKeypair(telegramUserId) {
  const wallets = loadWallets();
  const uid = String(telegramUserId);
  const user = wallets[uid];
  if (!user) throw new Error(`No wallet found for user ${uid}`);
  return Keypair.fromSecretKey(Buffer.from(user.privateKey, 'base64'));
}

function getUserPublicKey(telegramUserId) {
  const wallets = loadWallets();
  return wallets[String(telegramUserId)]?.publicKey || null;
}

function hasWallet(telegramUserId) {
  const wallets = loadWallets();
  return !!wallets[String(telegramUserId)];
}

function getUserWalletInfo(telegramUserId) {
  const wallets = loadWallets();
  const uid = String(telegramUserId);
  const user = wallets[uid];
  if (!user) return null;
  const { privateKey, ...safe } = user;
  return safe;
}

// ─── BOT STATE ────────────────────────────────────────────────────────────────

function setBotEnabled(telegramUserId, enabled) {
  const wallets = loadWallets();
  const uid = String(telegramUserId);
  if (!wallets[uid]) return;
  wallets[uid].botEnabled = enabled;
  wallets[uid].botToggleAt = Date.now();
  saveWallets(wallets);
}

function isBotEnabled(telegramUserId) {
  const wallets = loadWallets();
  return !!(wallets[String(telegramUserId)]?.botEnabled);
}

// ─── ORDER TRACKING ───────────────────────────────────────────────────────────

function recordDepositOrder(telegramUserId, order) {
  const wallets = loadWallets();
  const uid = String(telegramUserId);
  if (!wallets[uid]) return;
  if (!wallets[uid].depositOrders) wallets[uid].depositOrders = [];
  wallets[uid].depositOrders.push({ ...order, recordedAt: Date.now() });
  saveWallets(wallets);
}

function recordWithdrawOrder(telegramUserId, order) {
  const wallets = loadWallets();
  const uid = String(telegramUserId);
  if (!wallets[uid]) return;
  if (!wallets[uid].withdrawOrders) wallets[uid].withdrawOrders = [];
  wallets[uid].withdrawOrders.push({ ...order, recordedAt: Date.now() });
  saveWallets(wallets);
}

function getAllUserIds() {
  return Object.keys(loadWallets());
}

// Backwards compatibility stubs
function getTrc20Address() { return null; }
function getTrc20PrivateKey() { return null; }

module.exports = {
  getOrCreateWallet,
  getUserKeypair,
  getUserPublicKey,
  hasWallet,
  getUserWalletInfo,
  setBotEnabled,
  isBotEnabled,
  recordDepositOrder,
  recordWithdrawOrder,
  getAllUserIds,
  getTrc20Address,
  getTrc20PrivateKey,
};
