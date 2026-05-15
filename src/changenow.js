/**
 * PeakSeek — ChangeNOW Integration
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles USDT TRC20 → SOL deposits and SOL → USDT TRC20 withdrawals
 * via the ChangeNOW v2 API.
 *
 * Docs: https://documenter.getpostman.com/view/8180765/SVz6WapB
 *
 * Flow:
 *   DEPOSIT:  User sends USDT (TRC20) → ChangeNOW address → SOL lands in bot wallet
 *   WITHDRAW: Bot sends SOL → ChangeNOW converts → USDT TRC20 to user's wallet
 */

'use strict';

const BASE_URL = 'https://api.changenow.io/v2';

const CHANGENOW_CONFIG = {
  apiKey:          process.env.CHANGENOW_API_KEY || '',
  fromCurrency:    'usdt',  // USDT
  fromNetwork:     'trx',   // TRC20 network
  toCurrency:      'sol',
  toNetwork:       'sol',
  flow:            'standard',
  statusPollIntervalMs: 30 * 1000,
  statusPollTimeoutMs:  60 * 60 * 1000, // 1 hour timeout
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function fetchJson(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const url = `${BASE_URL}${path}`;
    const headers = {
      'x-changenow-api-key': CHANGENOW_CONFIG.apiKey,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };
    const r = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    const json = await r.json();
    if (!r.ok) {
      throw new Error(`ChangeNOW error: ${json.message || json.error || r.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return fetchJson(`${path}${qs ? '?' + qs : ''}`);
}

function post(path, body = {}) {
  return fetchJson(path, { method: 'POST', body: JSON.stringify(body) });
}

// ─── RATES & LIMITS ──────────────────────────────────────────────────────────

/**
 * Get minimum deposit amount in USDT TRC20
 */
async function getDepositLimits() {
  const data = await get('/exchange/min-amount', {
    fromCurrency: CHANGENOW_CONFIG.fromCurrency,
    toCurrency:   CHANGENOW_CONFIG.toCurrency,
    fromNetwork:  CHANGENOW_CONFIG.fromNetwork,
    toNetwork:    CHANGENOW_CONFIG.toNetwork,
    flow:         CHANGENOW_CONFIG.flow,
  });
  return {
    minimumAmount: data.minAmount || data.minAmountFrom || 10,
    maximumAmount: data.maxAmount || data.maxAmountFrom || null,
  };
}

/**
 * Estimate how much SOL the user will receive for a given USDT amount
 */
async function getDepositRate(usdtAmount) {
  const data = await get('/exchange/estimated-amount', {
    fromCurrency: CHANGENOW_CONFIG.fromCurrency,
    toCurrency:   CHANGENOW_CONFIG.toCurrency,
    fromNetwork:  CHANGENOW_CONFIG.fromNetwork,
    toNetwork:    CHANGENOW_CONFIG.toNetwork,
    fromAmount:   usdtAmount,
    flow:         CHANGENOW_CONFIG.flow,
  });
  return {
    receiveAmount:  data.toAmount || data.estimatedAmount,
    rate:           data.rate,
    processingTime: '5-30',
  };
}

// ─── DEPOSIT (USDT TRC20 → SOL) ──────────────────────────────────────────────

/**
 * Create a deposit exchange.
 * ChangeNOW gives us a TRC20 address → user sends USDT there → SOL arrives in bot wallet.
 *
 * @param {number} usdtAmount        - Amount of USDT user will send
 * @param {string} solReceiveAddress - User's bot Solana wallet (receives SOL)
 * @param {string} refundAddress     - TRC20 address for refund if order fails (optional)
 */
async function createDepositOrder(usdtAmount, solReceiveAddress, refundAddress) {
  const body = {
    fromCurrency:   CHANGENOW_CONFIG.fromCurrency,
    toCurrency:     CHANGENOW_CONFIG.toCurrency,
    fromNetwork:    CHANGENOW_CONFIG.fromNetwork,
    toNetwork:      CHANGENOW_CONFIG.toNetwork,
    fromAmount:     String(usdtAmount),
    address:        solReceiveAddress,   // where SOL gets sent
    flow:           CHANGENOW_CONFIG.flow,
    type:           'direct',
    ...(refundAddress ? { refundAddress } : {}),
  };

  const data = await post('/exchange', body);

  console.log(`[changenow] Deposit order: ${data.id} | ${usdtAmount} USDT → ~${data.toAmount} SOL`);
  console.log(`[changenow] User sends USDT TRC20 to: ${data.payinAddress}`);

  return {
    orderId:        data.id,
    sendAddress:    data.payinAddress,   // TRC20 address user sends USDT to
    sendAmount:     data.fromAmount,     // exact USDT amount
    receiveAmount:  data.toAmount,       // estimated SOL
    processingTime: '5-30',
    createdAt:      data.createdAt,
  };
}

// ─── WITHDRAW (SOL → USDT TRC20) ─────────────────────────────────────────────

/**
 * Create a withdrawal exchange.
 * Bot sends SOL → ChangeNOW converts → USDT TRC20 to user's personal wallet.
 *
 * @param {number} usdtAmount           - Amount of USDT user wants to receive
 * @param {string} trc20ReceiveAddress  - User's personal TRC20 wallet
 * @param {string} solRefundAddress     - Bot's SOL wallet for refund if order fails
 */
async function createWithdrawOrder(usdtAmount, trc20ReceiveAddress, solRefundAddress) {
  // For withdraw: we send SOL, user receives USDT TRC20
  // First estimate how much SOL is needed for the requested USDT amount
  const estimate = await get('/exchange/estimated-amount', {
    fromCurrency: CHANGENOW_CONFIG.toCurrency,    // SOL
    toCurrency:   CHANGENOW_CONFIG.fromCurrency,  // USDT
    fromNetwork:  CHANGENOW_CONFIG.toNetwork,
    toNetwork:    CHANGENOW_CONFIG.fromNetwork,
    toAmount:     String(usdtAmount),
    flow:         CHANGENOW_CONFIG.flow,
  });

  const solAmount = estimate.fromAmount || estimate.estimatedAmount;
  if (!solAmount) throw new Error('Could not estimate SOL amount needed');

  // Create the order using fromAmount (SOL) — required for standard flow
  const body = {
    fromCurrency:   CHANGENOW_CONFIG.toCurrency,
    toCurrency:     CHANGENOW_CONFIG.fromCurrency,
    fromNetwork:    CHANGENOW_CONFIG.toNetwork,
    toNetwork:      CHANGENOW_CONFIG.fromNetwork,
    fromAmount:     String(solAmount),
    address:        trc20ReceiveAddress,
    flow:           CHANGENOW_CONFIG.flow,
    ...(solRefundAddress ? { refundAddress: solRefundAddress } : {}),
  };

  const data = await post('/exchange', body);

  console.log(`[changenow] Withdraw order: ${data.id} | ~${data.fromAmount} SOL → ${usdtAmount} USDT TRC20`);
  console.log(`[changenow] Bot must send SOL to: ${data.payinAddress}`);

  return {
    orderId:        data.id,
    sendAddress:    data.payinAddress,   // SOL address bot sends to
    sendAmount:     data.fromAmount,     // SOL amount bot must send
    receiveAmount:  data.toAmount,       // USDT amount user receives
    processingTime: '5-30',
    createdAt:      data.createdAt,
  };
}

/**
 * Withdraw ALL — takes a known SOL amount and converts directly to USDT TRC20.
 * Use when you already know exactly how much SOL to send (e.g. entire balance).
 *
 * @param {number} solAmount            - Exact SOL amount to send
 * @param {string} trc20ReceiveAddress  - User's personal TRC20 wallet
 * @param {string} solRefundAddress     - Bot's SOL wallet for refund if order fails
 */
async function createWithdrawAllOrder(solAmount, trc20ReceiveAddress, solRefundAddress) {
  // Check minimum first
  const minData = await get('/exchange/min-amount', {
    fromCurrency: CHANGENOW_CONFIG.toCurrency,
    toCurrency:   CHANGENOW_CONFIG.fromCurrency,
    fromNetwork:  CHANGENOW_CONFIG.toNetwork,
    toNetwork:    CHANGENOW_CONFIG.fromNetwork,
    flow:         CHANGENOW_CONFIG.flow,
  });
  const minSol = parseFloat(minData.minAmount || minData.minAmountFrom || 0);
  console.log(`[changenow] WithdrawAll: have ${solAmount} SOL, minimum is ${minSol} SOL`);
  if (solAmount < minSol) {
    throw new Error(`Minimum withdrawal is ${minSol} SOL (~$${(minSol * 150).toFixed(0)} USD). Your balance: ${solAmount.toFixed(6)} SOL — please deposit more first.`);
  }

  const body = {
    fromCurrency:   CHANGENOW_CONFIG.toCurrency,    // SOL
    toCurrency:     CHANGENOW_CONFIG.fromCurrency,  // USDT
    fromNetwork:    CHANGENOW_CONFIG.toNetwork,
    toNetwork:      CHANGENOW_CONFIG.fromNetwork,
    fromAmount:     String(solAmount),
    address:        trc20ReceiveAddress,
    flow:           CHANGENOW_CONFIG.flow,
    ...(solRefundAddress ? { refundAddress: solRefundAddress } : {}),
  };

  const data = await post('/exchange', body);

  console.log(`[changenow] WithdrawAll order: ${data.id} | ${solAmount} SOL → ~${data.toAmount} USDT TRC20`);
  console.log(`[changenow] Bot must send SOL to: ${data.payinAddress}`);

  return {
    orderId:        data.id,
    sendAddress:    data.payinAddress,
    sendAmount:     data.fromAmount,
    receiveAmount:  data.toAmount,
    processingTime: '5-30',
    createdAt:      data.createdAt,
  };
}

// ─── ORDER STATUS ─────────────────────────────────────────────────────────────

/**
 * Get current status of an exchange.
 * Statuses: waiting | confirming | exchanging | sending | finished | failed | refunded | expired
 */
async function getOrderStatus(orderId) {
  return get(`/exchange/by-id`, { id: orderId });
}

/**
 * Poll an order until it completes, fails, or times out.
 */
async function waitForOrder(orderId, onUpdate) {
  const start = Date.now();
  let lastStatus = null;

  // Map ChangeNOW statuses → friendly messages (same as EasyBit naming for compatibility)
  const statusMap = {
    waiting:    'Awaiting Deposit',
    confirming: 'Confirming Deposit',
    exchanging: 'Exchanging',
    sending:    'Sending',
    finished:   'Complete',
    failed:     'Failed',
    refunded:   'Refund',
    expired:    'Failed',
  };

  while (Date.now() - start < CHANGENOW_CONFIG.statusPollTimeoutMs) {
    try {
      const data = await getOrderStatus(orderId);
      const friendly = statusMap[data.status] || data.status;

      if (friendly !== lastStatus) {
        lastStatus = friendly;
        console.log(`[changenow] Order ${orderId} status: ${data.status} (${friendly})`);
        if (onUpdate) onUpdate({ ...data, status: friendly });
      }

      if (['Complete', 'Refund', 'Failed'].includes(friendly)) {
        return { ...data, status: friendly };
      }
    } catch (e) {
      console.error('[changenow] status poll error:', e.message);
    }

    await new Promise(r => setTimeout(r, CHANGENOW_CONFIG.statusPollIntervalMs));
  }

  throw new Error(`Order ${orderId} timed out after ${CHANGENOW_CONFIG.statusPollTimeoutMs / 3600000}h`);
}

module.exports = {
  getDepositRate,
  getDepositLimits,
  createDepositOrder,
  createWithdrawOrder,
  createWithdrawAllOrder,
  getOrderStatus,
  waitForOrder,
  CHANGENOW_CONFIG,
};
