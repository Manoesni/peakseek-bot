/* PeakSeek Mini App — v3.2 */

const tg = window.Telegram?.WebApp || null;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d1117'); }

let state = {
  solPrice: 0, solBalance: 0, reserve: 0, botEnabled: false,
  trial: null, wallet: null, trc20Usdt: 0, positions: [], trades: [],
};
let selectedDepositAmount = 10;
let perfChart = null;

async function api(path) {
  try { const r = await fetch(path); return r.ok ? r.json() : null; } catch { return null; }
}

async function loadData() {
  const [trialData, portfolioData, walletData, priceData] = await Promise.all([
    api('/api/trial'), api('/api/portfolio'), api('/api/wallet'),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd').then(r=>r.json()).catch(()=>null),
  ]);
  if (priceData?.solana?.usd) state.solPrice = priceData.solana.usd;
  if (trialData) state.trial = trialData;
  if (portfolioData) {
    state.positions  = portfolioData.positions || [];
    state.trades     = (portfolioData.closed || []).slice(0, 20);
    state.reserve    = portfolioData.reserve || trialData?.reserve || 0;
    state.botEnabled = portfolioData.botEnabled || false;
  }
  if (walletData) {
    state.wallet     = walletData;
    state.trc20Usdt  = walletData.trc20UsdtBalance || 0;
    state.solBalance = walletData.solBalanceUsd || 0;
  }
  render();
}

function render() {
  const t = state.trial;
  const solUsd  = state.solPrice || 0;
  const trading = state.solBalance || (t?.balance || 0);
  const reserve = state.reserve || t?.reserve || 0;
  const total   = trading + reserve + state.trc20Usdt;
  const botOn   = state.botEnabled;

  document.getElementById('headerStatus').textContent =
    state.positions.length > 0 ? `${state.positions.length} position${state.positions.length>1?'s':''} open`
    : botOn ? 'Bot active · scanning' : 'Bot paused';
  document.getElementById('statusDot').className = `status-dot ${botOn ? 'live' : ''}`;

  document.getElementById('balanceAmount').textContent = `$${total.toFixed(2)}`;
  document.getElementById('balanceSub').textContent = solUsd > 0
    ? `${(trading/solUsd).toFixed(4)} SOL · $${solUsd.toFixed(0)}/SOL` : 'Trading balance';

  if (t && t.startBalance > 0) {
    const pnl = total - t.startBalance;
    const sign = pnl >= 0 ? '+' : '';
    const el = document.getElementById('balancePnl');
    el.textContent = `${sign}$${pnl.toFixed(2)} (${sign}${(pnl/t.startBalance*100).toFixed(1)}%) all time`;
    el.className = `balance-pnl ${pnl >= 0 ? 'pos' : 'neg'}`;
  }

  document.getElementById('statTrading').textContent  = `$${trading.toFixed(2)}`;
  document.getElementById('statReserved').textContent = `$${reserve.toFixed(2)}`;

  if (t && t.trades > 0) {
    const wr = ((t.wins/t.trades)*100).toFixed(0);
    const el = document.getElementById('statWinRate');
    el.textContent = `${wr}%`;
    el.className = `stat-value ${parseFloat(wr)>=50?'pos':'neg'}`;
  }

  const startBtn = document.getElementById('btnStartBot');
  const stopBtn  = document.getElementById('btnStopBot');
  if (botOn) { startBtn.classList.add('inactive'); stopBtn.classList.remove('inactive'); }
  else       { startBtn.classList.remove('inactive'); stopBtn.classList.add('inactive'); }

  const solBal = solUsd > 0 ? trading / solUsd : 0;
  document.getElementById('walletSol').textContent = `${solBal.toFixed(4)} SOL`;
  document.getElementById('walletUsd').textContent = `≈ $${trading.toFixed(2)} USD`;

  if (reserve > 0) {
    document.getElementById('reservedCard').style.display = 'block';
    document.getElementById('reservedAmount').textContent = `$${reserve.toFixed(2)}`;
  }

  renderPositions(); renderTrades(); renderChart();
}

function renderPositions() {
  const el = document.getElementById('positionsList');
  if (!state.positions.length) { el.innerHTML = '<div class="empty-state">No open positions right now</div>'; return; }
  el.innerHTML = state.positions.map(p => {
    const pct = p.entryPrice > 0 ? ((p.currentPrice-p.entryPrice)/p.entryPrice*100).toFixed(1) : '0.0';
    const sign = parseFloat(pct)>=0?'+':''; const cls = parseFloat(pct)>=0?'pos':'neg';
    return `<div class="position-item"><div><div class="position-symbol">${p.symbol}</div><div class="position-meta">${p.chain||'SOL'} · $${(p.budget||0).toFixed(0)} in</div></div><div class="position-pnl ${cls}">${sign}${pct}%</div></div>`;
  }).join('');
}

function renderTrades() {
  const el = document.getElementById('tradesList');
  if (!state.trades.length) { el.innerHTML = '<div class="empty-state">No recent trades yet</div>'; return; }
  el.innerHTML = state.trades.map(t => {
    const pnl = t.pnlUsd||0; const sign = pnl>=0?'+':''; const cls = pnl>=0?'pos':'neg';
    return `<div class="trade-item"><div><div class="trade-symbol">${t.symbol}</div><div class="trade-meta">${t.exitReason||''}</div></div><div class="trade-pnl ${cls}">${sign}$${Math.abs(pnl).toFixed(2)}</div></div>`;
  }).join('');
}

function renderChart() {
  const t = state.trial;
  const data   = (!t||!t.history||t.history.length<2) ? [t?.balance||0, t?.balance||0] : t.history;
  const labels = data.map((_,i) => i===0?'Start':i===data.length-1?'Now':`T${i}`);
  const ctx = document.getElementById('perfChart').getContext('2d');
  if (perfChart) perfChart.destroy();
  const isUp = data[data.length-1] >= data[0];
  const color = isUp ? '#3fb950' : '#f85149';
  perfChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: color, borderWidth: 2, pointRadius: 0, fill: true,
      backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0,0,0,160); g.addColorStop(0, isUp?'rgba(63,185,80,0.18)':'rgba(248,81,73,0.18)'); g.addColorStop(1,'rgba(0,0,0,0)'); return g; }, tension: 0.4 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{enabled:false}},
      scales: { x:{display:false}, y:{display:true, grid:{color:'#21262d'}, ticks:{color:'#8b949e', font:{size:11}, callback:v=>`$${v.toFixed(0)}`}} } }
  });
}

async function setBotState(enabled) {
  if (tg) tg.HapticFeedback?.impactOccurred?.('medium');
  await fetch('/api/bot', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enabled}) });
  state.botEnabled = enabled; render();
}

async function emergencyStop() {
  if (!confirm('⚠️ Emergency Stop: Halt ALL trading immediately?')) return;
  await fetch('/api/bot', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enabled:false,emergency:true}) });
  state.botEnabled = false; render();
}

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tg) tg.HapticFeedback?.selectionChanged?.();
  });
});

// Deposit
document.getElementById('btnDeposit').onclick = () => {
  document.getElementById('withdrawPanel').classList.add('hidden');
  document.getElementById('depositPanel').classList.toggle('hidden');
};
document.querySelectorAll('.amount-btn:not(.custom)').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.amount-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDepositAmount = parseFloat(btn.dataset.amount);
    document.getElementById('customAmountInput').style.display = 'none';
  });
});
document.getElementById('customAmountBtn').onclick = () => {
  document.querySelectorAll('.amount-btn').forEach(b=>b.classList.remove('selected'));
  document.getElementById('customAmountBtn').classList.add('selected');
  document.getElementById('customAmountInput').style.display = 'block';
  selectedDepositAmount = null;
  document.getElementById('customAmountInput').focus();
};
document.getElementById('customAmountInput').oninput = e => { selectedDepositAmount = parseFloat(e.target.value)||null; };

document.getElementById('confirmDeposit').onclick = async () => {
  const amount = selectedDepositAmount;
  if (!amount || amount < 10) { alert('Minimum deposit is $10 USDT'); return; }
  const btn = document.getElementById('confirmDeposit');
  btn.disabled = true; btn.textContent = 'Getting address...';
  try {
    const res = await fetch('/api/deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({amount}) });
    const data = await res.json();
    if (data.ok && data.address) {
      document.getElementById('depositPanel').innerHTML = `
        <div class="panel-title">✅ Deposit Address Ready</div>
        <div class="panel-note" style="margin-bottom:8px">Send exactly <strong>$${amount} USDT</strong> via TRC20:</div>
        <div class="deposit-address" id="depositAddr" onclick="copyAddress(this)">${data.address}</div>
        <div class="panel-note">Tap to copy · Bot notifies you when received</div>
        <div class="panel-note">⚠️ TRC20 only · valid 30 min</div>`;
    } else { alert(data.error||'Could not get address. Try again.'); btn.disabled=false; btn.textContent='Get Deposit Address →'; }
  } catch { alert('Could not reach server.'); btn.disabled=false; btn.textContent='Get Deposit Address →'; }
};

function copyAddress(el) {
  const addr = el?.textContent; if (!addr) return;
  navigator.clipboard.writeText(addr).then(() => { const o=el.textContent; el.textContent='✅ Copied!'; setTimeout(()=>{el.textContent=o;},2000); }).catch(()=>{});
  if (tg) tg.HapticFeedback?.notificationOccurred?.('success');
}

// Withdraw
document.getElementById('btnWithdraw').onclick = () => {
  document.getElementById('depositPanel').classList.add('hidden');
  document.getElementById('withdrawPanel').classList.toggle('hidden');
};
document.getElementById('confirmWithdraw').onclick = () => {
  const address = document.getElementById('withdrawAddress').value.trim();
  if (!address.startsWith('T') || address.length < 30) { alert('Please enter a valid TRC20 address (starts with T, ~34 chars)'); return; }
  if (tg) { tg.sendData(JSON.stringify({action:'withdraw',address})); tg.close(); }
  else { alert(`Use /withdraw in the bot chat, then provide:\n${address}`); }
};

loadData();
setInterval(loadData, 30000);
