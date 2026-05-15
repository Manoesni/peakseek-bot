const { answerCallback, tg } = require('../telegram');
const { openPaperPosition } = require('./paper');
const { settings, pendingInput, dexPickCache } = require('../state');
const { sendPaged } = require('./dexscan');
const { getCandles } = require('../hyperliquid');
const { computeSignal } = require('../indicators');
const { buildMajorsPlan } = require('./signal');
const { canAutoTrade, policyAmount, consumePolicyBudget, rollbackPolicyBudget } = require('../autocore');

async function majorsPlanFor(symbol) {
try {
const candles = await getCandles(symbol);
const closes = (candles || []).map(c => Number(c.c));
const sig = computeSignal(closes);
if (!sig) return null;
return buildMajorsPlan(sig);
} catch {
return null;
}
}

async function handleCallback(cb) {
const data = cb?.data || '';
const chatId = cb?.message?.chat?.id;
if (!chatId) return;
const key = String(chatId);
  if (data.startsWith('cmd_')) { await handleMenuCallback(data, chatId, cb.id); return; }

if (data.startsWith('dexpage_')) {
const parts = data.split('_');
const mode = parts[1] || 'standard';
const page = Number(parts[2] || 0);
const rows = dexPickCache.get(key) || [];
await answerCallback(cb.id, `Page ${page + 1}`);
if (!rows.length) {
await tg('sendMessage', { chat_id: key, text: 'Scan expired. Run /dexscan live again.' });
return;
}
await sendPaged(chatId, rows, mode, page);
return;
}

if (data.startsWith('paper_custom_')) {
const parts = data.split('_');
const side = parts[2];
const symbol = (parts[3] || '').toUpperCase();
pendingInput.set(key, { kind: 'paper_custom', side, symbol });

await answerCallback(cb.id, `Enter amount for ${side} ${symbol}`);
await tg('sendMessage', { chat_id: key, text: `Enter amount only for ${side.toUpperCase()} ${symbol}.\nExample: 250` });
return;
}

if (data.startsWith('paper_')) {
const parts = data.split('_');
const side = parts[1];
const symbol = (parts[2] || '').toUpperCase();
const requestedAmount = Number(parts[3] || 0);
await answerCallback(cb.id, `${side.toUpperCase()} ${symbol} $${requestedAmount}`);
if (side === 'skip') return;
if (!['long', 'short'].includes(side) || !symbol || !requestedAmount) return;

const gate = canAutoTrade('ETH'); // majors lane
if (!gate.ok) {
await tg('sendMessage', { chat_id: key, text: `🚫 AutoCore block: ${gate.reason}` });
return;
}

const amount = policyAmount(requestedAmount);
const lev = Number(settings.leverage?.majors || 5);
const plan = await majorsPlanFor(symbol);

consumePolicyBudget(amount);
const ok = await openPaperPosition(chatId, side, symbol, lev, amount, plan || undefined);
if (!ok) rollbackPolicyBudget(amount);
return;
}

if (data.startsWith('dexpairidx_')) {
const idx = Number(data.split('_')[1]);
const rows = dexPickCache.get(key) || [];
const row = rows[idx];
if (!row) {
await answerCallback(cb.id, 'Pair expired, run /dexscan live again');
return;
}

await answerCallback(cb.id, `Pick amount for ${row.token} (${row.chain})`);

await tg('sendMessage', {
chat_id: key,
text: `Select paper amount for ${row.token} (${row.chain})`,
reply_markup: JSON.stringify({
inline_keyboard: [
[
{ text: '$5', callback_data: `dexpickamtidx_${idx}_5` },
{ text: '$10', callback_data: `dexpickamtidx_${idx}_10` },
{ text: '$25', callback_data: `dexpickamtidx_${idx}_25` }
],
[
{ text: '$50', callback_data: `dexpickamtidx_${idx}_50` },
{ text: '$100', callback_data: `dexpickamtidx_${idx}_100` }
],
[{ text: 'Custom', callback_data: `dexpickcustomidx_${idx}` }]
]
})
});
return;
}

if (data.startsWith('dexpickcustomidx_')) {
const idx = Number(data.split('_')[1]);
const rows = dexPickCache.get(key) || [];
const row = rows[idx];
if (!row) {
await answerCallback(cb.id, 'Pair expired, run /dexscan live again');
return;
}

pendingInput.set(key, {
kind: 'dexpick_custom_pair',
token: row.token,
chain: row.chain,
pairAddress: row.pairAddress,
priceUsd: row.priceUsd
});

await answerCallback(cb.id, `Enter amount for ${row.token}`);
await tg('sendMessage', { chat_id: key, text: `Enter DEX amount only for ${row.token} (${row.chain}).\nExample: 250` });
return;
}

if (data.startsWith('dexpickamtidx_')) {
const parts = data.split('_');
const idx = Number(parts[1]);
const amount = Number(parts[2] || 0);
const rows = dexPickCache.get(key) || [];
const row = rows[idx];
if (!row || !amount) return;

await answerCallback(cb.id, `Buying ${row.token} $${amount}`);
const { handleDexpick } = require('./dexpick');
await handleDexpick(chatId, ['/dexpick', row.token, String(amount), row.chain, row.pairAddress, String(row.priceUsd)]);
return;
}
}

module.exports = { handleCallback };

// ── Menu button callbacks ──────────────────────────────────────────────────
async function handleMenuCallback(data, chatId, cbId) {
  const { answerCallback } = require('../telegram');
  await answerCallback(cbId, '').catch(() => {});
  if (data === 'cmd_portfolio') { const { handlePortfolio } = require('./portfolio'); await handlePortfolio(chatId); }
  else if (data === 'cmd_positions') { const { handlePositions } = require('./positions'); await handlePositions(chatId); }
  else if (data === 'cmd_whale') { try { const { getWhaleStatus } = require('/Users/macpro/Desktop/peakseek/src/whale_watcher'); const st = getWhaleStatus(); const lines = [`🐋 *Whale Watcher*`, `Status: ${st.running ? '🟢 Running' : '🔴 Stopped'}`, `Open: ${st.openPositions}/${st.maxPositions} positions`]; if (st.positions && st.positions.length > 0) { lines.push(''); st.positions.forEach(p => { const pct = p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) : '0.0'; lines.push(`• ${p.symbol} +${pct}% [${p.chain}]`); }); } else lines.push('No open whale positions'); const { reply } = require('../telegram'); reply(chatId, lines.join('\n')); } catch(e) { const { reply } = require('../telegram'); reply(chatId, '🐋 Whale error: ' + e.message); } }
  else if (data === 'cmd_social') { try { const { getSocialStatus } = require('/Users/macpro/Desktop/peakseek/src/social_agent'); const s = getSocialStatus(); const lines = [`📢 *Social Agent*`, `Status: ${s.running ? '🟢 Running' : '🔴 Stopped'}`, `Open: ${s.openPositions}/${s.maxPositions} positions`]; if (s.positions && s.positions.length > 0) { lines.push(''); s.positions.forEach(p => { const pct = p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) : '0.0'; lines.push(`• ${p.symbol} ${pct >= 0 ? '+' : ''}${pct}% [${p.source}]`); }); } else lines.push('No open social positions'); const { reply } = require('../telegram'); reply(chatId, lines.join('\n')); } catch(e) { const { reply } = require('../telegram'); reply(chatId, '📢 Social error: ' + e.message); } }
  else if (data === 'cmd_wallets') { try { const { getWalletFollowerStatus } = require('/Users/macpro/Desktop/peakseek/src/wallet_follower'); const s = getWalletFollowerStatus(); const lines = [`👛 *Wallet Follower*`, `Status: ${s.running ? '🟢 Running' : '🔴 Stopped'}`, `Watching: ${s.trackedWallets} wallets`, `Positions: ${s.openPositions}/${s.maxPositions}`]; if (s.positions && s.positions.length > 0) { lines.push(''); s.positions.forEach(p => { const pct = p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) : '0.0'; lines.push(`• ${p.symbol} ${pct >= 0 ? '+' : ''}${pct}% [${p.source}]`); }); } else lines.push('No open copy positions'); const { reply } = require('../telegram'); reply(chatId, lines.join('\n')); } catch(e) { const { reply } = require('../telegram'); reply(chatId, '👛 Wallets error: ' + e.message); } }
  else if (data === 'cmd_trial') { const { handleTrial } = require('./trial'); await handleTrial(chatId, ['/trial']); }
  else if (data === 'cmd_history') { const { handleHistory } = require('./history'); await handleHistory(chatId); }
  else if (data === 'cmd_open') { const { handleOpen } = require('./open'); await handleOpen(chatId); }
}
