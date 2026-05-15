/**
 * PeakSeek — User Onboarding Flow (Beta)
 * ─────────────────────────────────────────────────────────────────────────────
 * Super simple flow for beta testers:
 *   1. /start → Welcome message + wallet auto-created
 *   2. User deposits USDT → bot converts to SOL and starts trading
 *   3. Profits build up automatically
 */

'use strict';

const { reply, replyMd, replyClean, replyWithButtons } = require('../telegram');
const {
  getOrCreateWallet,
  getUserPublicKey,
  getUserWalletInfo,
  recordDepositOrder,
  recordWithdrawOrder,
  setBotEnabled,
} = require('../user_wallets');
const {
  getDepositRate,
  getDepositLimits,
  createDepositOrder,
  waitForOrder,
  CHANGENOW_CONFIG,
} = require('../changenow');

const MINI_APP_URL = process.env.PEAKSEEK_MINIAPP_URL || '';

// Track users mid-flow
const onboardingState = new Map();

// ─── /start ──────────────────────────────────────────────────────────────────

async function handleStart(chatId, userId, firstName) {
  const name = firstName || 'there';
  const { isNew } = getOrCreateWallet(userId);

  if (!isNew) {
    // Returning user
    const buttons = [];
    if (MINI_APP_URL) {
      buttons.push([{ text: '📊 Open Dashboard', web_app: { url: MINI_APP_URL } }]);
    }
    buttons.push([
      { text: '💰 Deposit', callback_data: 'deposit_start' },
      { text: '💸 Withdraw', callback_data: 'withdraw_start' },
    ]);

    await replyWithButtons(chatId,
      `👋 *Welcome back, ${name}!*\n\n` +
      `Your bot is running and trading automatically.\n` +
      `Use /balance to check your funds or /help for all commands.`,
      buttons
    );
    return;
  }

  // New user — welcome!
  await replyClean(chatId,
    `⛰️ *Welcome to PeakSeek, ${name}!*\n\n` +
    `PeakSeek is an automated crypto trading bot that works for you 24/7.\n\n` +
    `1️⃣ Deposit USDT (min $50 via TRC20)\n` +
    `2️⃣ Bot converts to SOL and starts trading automatically\n` +
    `3️⃣ 20% of every win is locked as reserved profit 🔒\n` +
    `4️⃣ Withdraw anytime\n\n` +
    `*No experience needed. Just deposit and let it run.*`
  );

  await new Promise(r => setTimeout(r, 1000));

  onboardingState.set(String(userId), { step: 'awaiting_deposit_amount' });

  const buttons = [
    [
      { text: '$50', callback_data: 'deposit_50' },
      { text: '$100', callback_data: 'deposit_100' },
      { text: '$200', callback_data: 'deposit_200' },
      { text: 'Custom', callback_data: 'deposit_custom' },
    ],
  ];
  if (MINI_APP_URL) {
    buttons.push([{ text: '📊 Open Dashboard', web_app: { url: MINI_APP_URL } }]);
  }

  await replyWithButtons(chatId,
    `✅ *Your account is ready!*\n\n💰 How much would you like to deposit? _(USDT · TRC20)_`,
    buttons
  );
}

// ─── DEPOSIT FLOW ─────────────────────────────────────────────────────────────

async function handleDeposit(chatId, userId, amount) {
  const solPublicKey = getUserPublicKey(userId);
  if (!solPublicKey) {
    await reply(chatId, '⚠️ Please use /start first to set up your account.');
    return;
  }

  // No API key yet — show holding message
  if (!CHANGENOW_CONFIG.apiKey) {
    const buttons = [];
    if (MINI_APP_URL) buttons.push([{ text: '📊 Open Dashboard', web_app: { url: MINI_APP_URL } }]);
    await replyWithButtons(chatId,
      `⏳ *Deposits opening very soon!*\n\n` +
      `We're finalising our payment processing.\n` +
      `You'll be notified the moment deposits go live! 🚀`,
      buttons
    );
    return;
  }

  // Get rates
  let rate, limits;
  try {
    [rate, limits] = await Promise.all([getDepositRate(amount), getDepositLimits()]);
  } catch (e) {
    console.error('[deposit] rate fetch error:', e.message);
    await replyClean(chatId, `⚠️ Couldn't fetch rate right now. Please try again in a moment.\n\nError: ${e.message}`);
    return;
  }

  const minDeposit = parseFloat(limits.minimumAmount);
  if (amount < minDeposit) {
    await replyClean(chatId, `⚠️ Minimum deposit is $${minDeposit} USDT.`);
    return;
  }

  await replyClean(chatId,
    `💱 *Exchange rate:*\n` +
    `${amount} USDT → ~${parseFloat(rate.receiveAmount).toFixed(4)} SOL\n` +
    `⏱ Processing: ~${rate.processingTime} min\n\n` +
    `Creating your deposit address...`
  );

  let order;
  try {
    order = await createDepositOrder(amount, solPublicKey, null);
  } catch (e) {
    await replyClean(chatId, `⚠️ Couldn't create deposit order: ${e.message}`);
    return;
  }

  recordDepositOrder(userId, order);

  await replyClean(chatId,
    `✅ *Your deposit address is ready!*\n\n` +
    `Send exactly:\n` +
    `💰 *${order.sendAmount} USDT TRC20*\n\n` +
    `To this address:\n` +
    `\`${order.sendAddress}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ *Important:*\n` +
    `• TRC20 network only\n` +
    `• Send the exact amount shown\n` +
    `• Address valid for 30 minutes\n\n` +
    `I'll notify you as soon as funds arrive and trading begins! 🚀`
  );

  pollDepositOrder(chatId, userId, order.orderId).catch(e =>
    console.error(`[onboarding] deposit poll error user ${userId}:`, e.message)
  );
}

async function pollDepositOrder(chatId, userId, orderId) {
  try {
    let lastStatus = null;
    const finalStatus = await waitForOrder(orderId, async (status) => {
      if (status.status === lastStatus) return;
      lastStatus = status.status;
      const msgs = {
        'Awaiting Deposit':   '⏳ Waiting for your USDT deposit...',
        'Confirming Deposit': '🔄 Deposit detected! Confirming on blockchain...',
        'Exchanging':         '💱 Converting USDT → SOL...',
        'Sending':            '📤 Sending SOL to your trading wallet...',
      };
      if (msgs[status.status]) await replyClean(chatId, msgs[status.status]).catch(() => {});
    });

    if (finalStatus.status === 'Complete') {
      setBotEnabled(userId, true);
      const buttons = [];
      if (MINI_APP_URL) buttons.push([{ text: '📊 Open Dashboard', web_app: { url: MINI_APP_URL } }]);
      await replyWithButtons(chatId,
        `🎉 *Deposit complete!*\n\n` +
        `✅ ${finalStatus.receiveAmount} SOL received\n` +
        `🤖 Your bot is now *live and trading!*\n\n` +
        `I'll send updates when trades open and close.\n` +
        `Check your balance anytime: /balance`,
        buttons
      );
    } else if (finalStatus.status === 'Refund') {
      await replyClean(chatId, `↩️ Deposit refunded. Rates moved during exchange. Please try again with /deposit`);
    } else {
      await replyClean(chatId, `⚠️ Deposit issue. Please contact support.`);
    }
  } catch (e) {
    console.error(`[onboarding] poll error:`, e.message);
    await replyClean(chatId, `⚠️ Deposit monitoring timed out. If you sent funds please contact support.`).catch(() => {});
  }
}

// ─── WITHDRAW FLOW ────────────────────────────────────────────────────────────

async function handleWithdraw(chatId, userId, parts) {
  if (!getUserPublicKey(userId)) {
    await replyClean(chatId, '⚠️ Please use /start first.');
    return;
  }

  if (parts.length < 2) {
    await replyWithButtons(chatId,
      `💸 *Withdraw Funds*\n\n` +
      `How much would you like to withdraw?\n\n` +
      `• Minimum: $5 USDT\n` +
      `• Processing: 5-30 minutes\n` +
      `• Arrives as USDT TRC20 to your wallet`,
      [
        [
          { text: 'Withdraw All', callback_data: 'withdraw_all' },
          { text: 'Custom Amount', callback_data: 'withdraw_custom' },
        ],
      ]
    );
    return;
  }

  const usdtAmount = parseFloat(parts[1]);
  if (isNaN(usdtAmount) || usdtAmount < 5) {
    await replyClean(chatId, '⚠️ Minimum withdrawal is $5 USDT.');
    return;
  }

  onboardingState.set(String(userId), { step: 'awaiting_withdraw_address', amount: usdtAmount });
  await replyClean(chatId,
    `💸 *Withdraw $${usdtAmount} USDT*\n\n` +
    `Please send me your TRC20 wallet address to receive the funds.\n\n` +
    `It starts with *T* and is about 34 characters long.`
  );
}

// ─── CALLBACK HANDLER ─────────────────────────────────────────────────────────

async function handleCallback(chatId, userId, data) {
  const uid = String(userId);

  if (data === 'deposit_start' || data === 'deposit_menu') {
    await replyWithButtons(chatId,
      `💰 *How much would you like to deposit?*\n\n_USDT via TRC20 network_`,
      [
        [
          { text: '$10', callback_data: 'deposit_10' },
          { text: '$50', callback_data: 'deposit_50' },
          { text: '$100', callback_data: 'deposit_100' },
          { text: 'Custom', callback_data: 'deposit_custom' },
        ],
      ]
    );
    return true;
  }

  if (data.startsWith('deposit_')) {
    const amountStr = data.replace('deposit_', '');
    if (amountStr === 'custom') {
      onboardingState.set(uid, { step: 'awaiting_custom_amount' });
      await replyClean(chatId, '✏️ How much USDT would you like to deposit? (minimum $10)\n\nJust type the amount:');
    } else {
      await handleDeposit(chatId, userId, parseFloat(amountStr));
    }
    return true;
  }

  if (data === 'withdraw_start') {
    await handleWithdraw(chatId, userId, []);
    return true;
  }

  if (data === 'withdraw_custom') {
    onboardingState.set(uid, { step: 'awaiting_withdraw_amount' });
    await replyClean(chatId, '💸 How much USDT would you like to withdraw? (minimum $10)\n\nJust type the amount:');
    return true;
  }

  if (data === 'withdraw_all') {
    // Withdraw all = just ask for address, ChangeNOW will convert whatever SOL we send
    // We use a sentinel amount of 999999 to signal "withdraw all SOL"
    onboardingState.set(uid, { step: 'awaiting_withdraw_address', amount: 'all' });
    await replyClean(chatId,
      `💸 *Withdraw All*\n\n` +
      `Please send me your TRC20 wallet address to receive USDT.\n\n` +
      `It starts with *T* and is about 34 characters long.`
    );
    return true;
  }

  if (data === 'cancel_withdraw') {
    await replyClean(chatId, '❌ Withdrawal cancelled.');
    return true;
  }

  if (data.startsWith('confirm_withdraw_')) {
    const payload = data.replace('confirm_withdraw_', '');
    // payload is either "all_<address>" or "<amount>_<address>"
    const firstUnderscore = payload.indexOf('_');
    const amountPart  = payload.slice(0, firstUnderscore);
    const trc20Address = payload.slice(firstUnderscore + 1);
    const usdtAmountOrAll = amountPart === 'all' ? 'all' : parseFloat(amountPart);
    await executeWithdraw(chatId, userId, usdtAmountOrAll, trc20Address);
    return true;
  }

  return false;
}

// ─── TEXT HANDLER ─────────────────────────────────────────────────────────────

async function handleText(chatId, userId, text) {
  const uid = String(userId);
  const state = onboardingState.get(uid);
  if (!state) return false;

  if (state.step === 'awaiting_custom_amount') {
    const amount = parseFloat(text.trim().replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount < 5) {
      await replyClean(chatId, '⚠️ Please enter a valid amount of at least $5 USDT.');
      return true;
    }
    onboardingState.delete(uid);
    await handleDeposit(chatId, userId, amount);
    return true;
  }

  if (state.step === 'awaiting_withdraw_amount') {
    const amount = parseFloat(text.trim().replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount < 5) {
      await replyClean(chatId, '⚠️ Please enter a valid amount of at least $5 USDT.');
      return true;
    }
    onboardingState.set(uid, { step: 'awaiting_withdraw_address', amount });
    await replyClean(chatId,
      `💸 *Withdraw $${amount} USDT*\n\n` +
      `Please send me your TRC20 wallet address.\n\n` +
      `It starts with *T* and is about 34 characters long.`
    );
    return true;
  }

  if (state.step === 'awaiting_withdraw_address') {
    const address = text.trim();
    if (!address.startsWith('T') || address.length < 30) {
      await replyClean(chatId, '⚠️ That doesn\'t look like a valid TRC20 address. It should start with T and be ~34 characters. Please try again.');
      return true;
    }
    onboardingState.delete(uid);
    await replyWithButtons(chatId,
      `💸 *Withdrawal Summary*\n\n` +
      `Amount: ${state.amount === 'all' ? 'All SOL → USDT' : `$${state.amount} USDT`}\n` +
      `To: \`${address}\`\n\n` +
      `Confirm?`,
      [
        [{ text: '✅ Confirm', callback_data: `confirm_withdraw_${state.amount}_${address}` }],
        [{ text: '❌ Cancel', callback_data: 'cancel_withdraw' }],
      ]
    );
    return true;
  }

  return false;
}

async function sendSolOnChain(userId, toAddress, solAmount) {
  const {
    Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL,
  } = require('@solana/web3.js');
  const { getUserKeypair } = require('../user_wallets');

  const keypair = getUserKeypair(userId);
  const RPCS = [
    'https://solana-rpc.publicnode.com',
    'https://rpc.ankr.com/solana',
    'https://api.mainnet-beta.solana.com',
  ];

  let lastErr;
  for (const rpc of RPCS) {
    try {
      const connection = new Connection(rpc, 'confirmed');
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey:   new PublicKey(toAddress),
          lamports,
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = keypair.publicKey;
      tx.sign(keypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, 'confirmed');
      console.log(`[withdraw] Sent ${solAmount} SOL to ${toAddress} | tx: ${sig}`);
      return sig;
    } catch (e) {
      lastErr = e;
      console.error(`[withdraw] RPC ${rpc} failed:`, e.message);
      continue;
    }
  }
  throw new Error(`Failed to send SOL: ${lastErr?.message}`);
}

async function executeWithdraw(chatId, userId, usdtAmountOrAll, trc20Address) {
  await replyClean(chatId, '⏳ Processing your withdrawal...');
  try {
    const { createWithdrawOrder, createWithdrawAllOrder } = require('../changenow');
    const solPublicKey = getUserPublicKey(userId);

    // Fetch live SOL balance
    const RPCS = [
      'https://solana-rpc.publicnode.com',
      'https://rpc.ankr.com/solana',
      'https://api.mainnet-beta.solana.com',
    ];
    let solBalance = 0;
    for (const rpc of RPCS) {
      try {
        const resp = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [solPublicKey] }),
          signal: AbortSignal.timeout(5000),
        });
        const json = await resp.json();
        if (json?.result?.value !== undefined) {
          solBalance = json.result.value / 1e9;
          break;
        }
      } catch { continue; }
    }

    if (solBalance < 0.002) {
      await replyClean(chatId, `⚠️ SOL balance too low to withdraw (${solBalance.toFixed(6)} SOL). Please deposit first.`);
      return;
    }

    // Create ChangeNOW order
    let order;
    if (String(usdtAmountOrAll) === 'all') {
      const solToSend = Math.max(0, solBalance - 0.002); // keep tiny buffer for fees
      order = await createWithdrawAllOrder(solToSend, trc20Address, solPublicKey);
    } else {
      order = await createWithdrawOrder(parseFloat(usdtAmountOrAll), trc20Address, solPublicKey);
    }

    recordWithdrawOrder(userId, order);
    await replyClean(chatId, `💱 Order created! Sending ${order.sendAmount} SOL on-chain...`);

    // Actually send the SOL to ChangeNOW's address
    const sig = await sendSolOnChain(userId, order.sendAddress, parseFloat(order.sendAmount));

    await replyClean(chatId,
      `✅ *Withdrawal initiated!*\n\n` +
      `Sent: ${order.sendAmount} SOL → ChangeNOW\n` +
      `You'll receive: ~${order.receiveAmount} USDT TRC20\n` +
      `To: \`${trc20Address}\`\n` +
      `ETA: 5-30 minutes\n\n` +
      `TX: \`${sig}\`\n\n` +
      `I'll notify you when USDT arrives! 🎉`
    );
  } catch (e) {
    await replyClean(chatId, `⚠️ Withdrawal failed: ${e.message}\nPlease try again or contact support.`);
  }
}

module.exports = {
  handleStart,
  handleDeposit,
  handleWithdraw,
  handleCallback,
  handleText,
};
