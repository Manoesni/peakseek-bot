const tg = window.Telegram?.WebApp;
if (tg) {
tg.ready();
tg.expand();
}

let selectedMode = "manual";
const modeText = document.getElementById("modeText");
const statusEl = document.getElementById("status");
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

document.getElementById("saveBtn").addEventListener("click", () => {
const p = payload();
// For now, just show local status + send back to Telegram app context
statusEl.textContent = "Saved locally. Backend sync next step.";
if (tg) {
tg.sendData(JSON.stringify({ type: "peakseek_setup", payload: p }));
}
});

document.getElementById("signalBtn").addEventListener("click", () => {
if (tg) tg.close();
});
