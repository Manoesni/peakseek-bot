const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let selectedMode = "manual";
const modeText = document.getElementById("modeText");
const statusEl = document.getElementById("status");
const panel = document.getElementById("statusPanel");

document.querySelectorAll("[data-mode]").forEach(btn => {
btn.addEventListener("click", () => {
selectedMode = btn.dataset.mode;
document.querySelectorAll("[data-mode]").forEach(b => b.classList.remove("active"));
btn.classList.add("active");
modeText.textContent = `Selected: ${selectedMode}`;
});
});

function payload() {
return {
mode: selectedMode,
wallets: {
evm: document.getElementById("evm").value.trim(),
sol: document.getElementById("sol").value.trim(),
},
budgets: {
ETH: Number(document.getElementById("b_eth").value || 0),
BASE: Number(document.getElementById("b_base").value || 0),
BNB: Number(document.getElementById("b_bnb").value || 0),
ARB: Number(document.getElementById("b_arb").value || 0),
SOL: Number(document.getElementById("b_sol").value || 0),
}
};
}

async function api(path, method = "GET", body) {
const res = await fetch(path, {
method,
headers: { "Content-Type": "application/json" },
body: body ? JSON.stringify(body) : undefined
});
return res.json();
}

function renderStatus(s) {
panel.textContent =
`mode=${s.mode}
semi=${s.semiEnabled}
balance=$${s.balance}
open=${s.openPositions}
trial=${s.trialActive ? 'on' : 'off'} trades=${s.trialTrades} pnl=${s.trialPnl}`;
}

async function refreshStatus() {
try {
const s = await api('/api/status');
renderStatus(s);
} catch {
panel.textContent = 'Status unavailable';
}
}

document.getElementById("refreshBtn").addEventListener("click", refreshStatus);

document.getElementById("saveBtn").addEventListener("click", async () => {
try {
const r = await api('/api/setup', 'POST', payload());
statusEl.textContent = r.ok ? 'Saved.' : 'Save failed.';
await refreshStatus();
} catch {
statusEl.textContent = 'Save failed.';
}
});

document.getElementById("semiOnBtn").addEventListener("click", async () => {
await api('/api/semi', 'POST', { enabled: true });
statusEl.textContent = 'Semi ON';
await refreshStatus();
});

document.getElementById("semiOffBtn").addEventListener("click", async () => {
await api('/api/semi', 'POST', { enabled: false });
statusEl.textContent = 'Semi OFF';
await refreshStatus();
});

document.getElementById("trialStartBtn").addEventListener("click", async () => {
await api('/api/trial', 'POST', { action: 'start' });
statusEl.textContent = 'Trial started';
await refreshStatus();
});

document.getElementById("trialStopBtn").addEventListener("click", async () => {
await api('/api/trial', 'POST', { action: 'stop' });
statusEl.textContent = 'Trial stopped';
await refreshStatus();
});

refreshStatus();
