/**
 * PeakSeek — EasyBit Integration
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all USDT TRC20 → SOL deposits and SOL → USDT TRC20 withdrawals
 * via the EasyBit exchange API.
 *
 * Flow:
 *   DEPOSIT:  User sends USDT (TRC20) → EasyBit converts → SOL lands in user's bot wallet
 *   WITHDRAW: Bot sends SOL → EasyBit converts → USDT (TRC20) lands in user's personal wallet
 *
 * Docs: https://easybit.com/en/apidocs
 */

'use strict';

const BASE_URL = 'https://api.easybit.com';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const EASYBIT_CONFIG = {
  apiKey:          process.env.EASYBIT_API_KEY || '',
  minDepositUsdt:  10,
  depositCurrency: 'USDT',
  depositNetwork:  'TRX',   // TRC20
  receiveCurrency: 'SOL',
  receiveNetwork:  'SOL',
  statusPollIntervalMs: 30 * 1000,      // poll every 30s
  statusPollTimeoutMs:  30 * 60 * 1000, // give up after 30 min
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function fetchJson(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url = `${BASE_URL}${path}`;
    const headers = {
      'API-KEY':      EASYBIT_CONFIG.apiKey,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };
    const r = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    const json = await r.json();
    if (!json.success) {
      throw new Error(`EasyBit error ${json.errorCode}: ${json.errorMessage}`);
    }
    return json.data;
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

// ─── RATES ───────────────────────────────────────────────────────────────────

/**
 * Get current USDT TRC20 → SOL rate for a given USDT amount.
 * Returns { rate, sendAmount, receiveAmount, networkFee, processingTime }
 */
async function getDepositRate(usdtAmount) {
  return get('/rate', {
    send:           EASYBIT_CONFIG.depositCurrency,
    receive:        EASYBIT_CONFIG.receiveCurrency,
    sendNetwork:    EASYBIT_CONFIG.depositNetwork,
    receiveNetwork: EASYBIT_CONFIG.receiveNetwork,
    amount:         usdtAmount,
  });
}

/**
 * Get current SOL → USDT TRC20 rate for a given SOL amount.
 * Returns { rate, sendAmount, receiveAmount, networkFee, processingTime }
 */
async function getWithdrawRate(solAmount) {
  return get('/rate', {
    send:           EASYBIT_CONFIG.receiveCurrency,
    receive:        EASYBIT_CONFIG.depositCurrency,
    sendNetwork:    EASYBIT_CONFIG.receiveNetwork,
    receiveNetwork: EASYBIT_CONFIG.depositNetwork,
    amount:         solAmount,
  });
}

/**
 * Get min/max deposit limits for USDT TRC20 → SOL pair.
 * Returns { minimumAmount, maximumAmount, networkFee, processingTime }
 */
async function getDepositLimits() {
  return get('/pairInfo', {
    send:           EASYBIT_CONFIG.depositCurrency,
    receive:        EASYBIT_CONFIG.receiveCurrency,
    sendNetwork:    EASYBIT_CONFIG.depositNetwork,
    receiveNetwork: EASYBIT_CONFIG.receiveNetwork,
  });
}

// ─── DEPOSIT (USDT TRC20 → SOL) ──────────────────────────────────────────────

/**
 * Create a deposit order.
 * User sends USDT TRC20 to the returned sendAddress → EasyBit → SOL to solReceiveAddress.
 *
 * @param {number} usdtAmount         - Amount of USDT user will send
 * @param {string} solReceiveAddress  - User's bot Solana wallet (receives the SOL)
 * @param {string} refundTrc20Address - Where to refund if order fails
 * @returns {{ orderId, sendAddress, sendAmount, receiveAmount, processingTime }}
 */
async function createDepositOrder(usdtAmount, solReceiveAddress, refundTrc20Address) {
  const body = {
    send:           EASYBIT_CONFIG.depositCurrency,
    receive:        EASYBIT_CONFIG.receiveCurrency,
    sendNetwork:    EASYBIT_CONFIG.depositNetwork,
    receiveNetwork: EASYBIT_CONFIG.receiveNetwork,
    amount:         String(usdtAmount),
    receiveAddress: solReceiveAddress,
    vpm:            '3', // cancel & refund if rate drops >3% — protects user
    refundAddress:  refundTrc20Address || undefined,
  };

  const data = await post('/order', body);

  console.log(`[easybit] Deposit order created: ${data.id} | ${usdtAmount} USDT → ~${data.receiveAmount} SOL`);
  console.log(`[easybit] User must send to TRC20 address: ${data.sendAddress}`);

  return {
    orderId:        data.id,
    sendAddress:    data.sendAddress,    // TRC20 address user sends USDT to
    sendAmount:     data.sendAmount,     // exact USDT amount
    receiveAmount:  data.receiveAmount,  // estimated SOL
    processingTime: data.processingTime, // e.g. "3-5" minutes
    createdAt:      data.createdAt,
  };
}

// ─── WITHDRAW (SOL → USDT TRC20) ─────────────────────────────────────────────

/**
 * Create a withdrawal order.
 * Bot sends SOL to EasyBit → EasyBit sends USDT TRC20 to user's personal wallet.
 *
 * @param {number} solAmount            - Amount of SOL to convert
 * @param {string} trc20ReceiveAddress  - User's personal TRC20 address (receives USDT)
 * @param {string} solRefundAddress     - Bot's SOL wallet (refund destination if order fails)
 * @returns {{ orderId, sendAddress, sendAmount, receiveAmount, processingTime }}
 */
async function createWithdrawOrder(solAmount, trc20ReceiveAddress, solRefundAddress) {
  const body = {
    send:           EASYBIT_CONFIG.receiveCurrency,
    receive:        EASYBIT_CONFIG.depositCurrency,
    sendNetwork:    EASYBIT_CONFIG.receiveNetwork,
    receiveNetwork: EASYBIT_CONFIG.depositNetwork,
    amount:         String(solAmount),
    receiveAddress: trc20ReceiveAddress,
    vpm:            '3',
    refundAddress:  solRefundAddress || undefined,
  };

  const data = await post('/order', body);

  console.log(`[easybit] Withdraw order created: ${data.id} | ${solAmount} SOL → ~${data.receiveAmount} USDT TRC20`);
  console.log(`[easybit] Bot must send SOL to: ${data.sendAddress}`);

  return {
    orderId:        data.id,
    sendAddress:    data.sendAddress,    // EasyBit's SOL address — bot sends here
    sendAmount:     data.sendAmount,
    receiveAmount:  data.receiveAmount,  // estimated USDT
    processingTime: data.processingTime,
    createdAt:      data.createdAt,
  };
}

// ─── ORDER STATUS ─────────────────────────────────────────────────────────────

/**
 * Get current status of an order.
 * Possible statuses: "Awaiting Deposit" | "Confirming Deposit" | "Exchanging" |
 *                    "Sending" | "Complete" | "Refund" | "Failed"
 */
async function getOrderStatus(orderId) {
  return get('/orderStatus', { id: orderId });
}

/**
 * Poll an order until it completes, fails, or times out.
 * @param {string} orderId
 * @param {function} onUpdate - called on every status change with the status object
 * @returns {object} final status object
 */
async function waitForOrder(orderId, onUpdate) {
  const start = Date.now();
  let lastStatus = null;

  while (Date.now() - start < EASYBIT_CONFIG.statusPollTimeoutMs) {
    try {
      const data = await getOrderStatus(orderId);

      if (data.status !== lastStatus) {
        lastStatus = data.status;
        console.log(`[easybit] Order ${orderId} status: ${data.status}`);
        if (onUpdate) onUpdate(data);
      }

      if (['Complete', 'Refund', 'Failed'].includes(data.status)) {
        return data;
      }
    } catch (e) {
      console.error('[easybit] status poll error:', e.message);
    }

    await new Promise(r => setTimeout(r, EASYBIT_CONFIG.statusPollIntervalMs));
  }

  throw new Error(`Order ${orderId} timed out after ${EASYBIT_CONFIG.statusPollTimeoutMs / 60000} min`);
}

// ─── ADDRESS VALIDATION ───────────────────────────────────────────────────────

async function validateTrc20Address(address) {
  try {
    await get('/validateAddress', { currency: 'USDT', network: 'TRX', address });
    return true;
  } catch {
    return false;
  }
}

async function validateSolAddress(address) {
  try {
    await get('/validateAddress', { currency: 'SOL', network: 'SOL', address });
    return true;
  } catch {
    return false;
  }
}

// ─── ACCOUNT ─────────────────────────────────────────────────────────────────

async function getAccountInfo() {
  return get('/account');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  getDepositRate,
  getWithdrawRate,
  getDepositLimits,
  createDepositOrder,
  createWithdrawOrder,
  getOrderStatus,
  waitForOrder,
  validateTrc20Address,
  validateSolAddress,
  getAccountInfo,
  EASYBIT_CONFIG,
};
