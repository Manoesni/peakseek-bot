/**
 * persist.js — save/load bot state to disk so restarts don't wipe everything.
 * State file lives at: /Users/macpro/Desktop/peakseek/data/state.json
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Save the parts of state that must survive a restart */
function saveState(state) {
  try {
    ensureDir();
    const snap = {
      savedAt: Date.now(),
      portfolio: {
        balance:   state.portfolio.balance,
        positions: state.portfolio.positions,
        closed:    (state.portfolio.closed || []).slice(-200) // keep last 200 closed
      },
      trial: state.trial,
      autoPolicy: {
        enabled:       state.autoPolicy.enabled,
        mode:          state.autoPolicy.mode,
        perTradeUsd:   state.autoPolicy.perTradeUsd,
        dailyMaxUsd:   state.autoPolicy.dailyMaxUsd,
        maxOpen:       state.autoPolicy.maxOpen,
        chainsEnabled: state.autoPolicy.chainsEnabled
      },
      autoRuntime: {
        spentTodayUsd: state.autoRuntime.spentTodayUsd,
        startedAt:     state.autoRuntime.startedAt
      },
      settings: {
        mode:     state.settings.mode,
        wallets:  state.settings.wallets,
        leverage: state.settings.leverage
      },
      smartExit:    state.smartExit,
      smartAi:      state.smartAi,
      lossCooldown: {
        bySymbol: state.lossCooldown.bySymbol,
        byPair:   state.lossCooldown.byPair,
        minutes:  state.lossCooldown.minutes
      },
      runnerEnabled: state._runnerEnabled || false
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(snap, null, 2));
  } catch (e) {
    console.error('[persist] save error:', e.message);
  }
}

/** Load saved state back into the live state objects */
function loadState(state) {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      console.log('[persist] No saved state found — starting fresh.');
      return false;
    }
    const raw  = fs.readFileSync(STATE_FILE, 'utf8');
    const snap = JSON.parse(raw);
    const age  = Math.round((Date.now() - (snap.savedAt || 0)) / 1000 / 60);
    console.log(`[persist] Loading saved state (saved ${age} min ago)...`);

    // Portfolio
    if (snap.portfolio) {
      state.portfolio.balance   = snap.portfolio.balance   ?? state.portfolio.balance;
      state.portfolio.positions = snap.portfolio.positions ?? [];
      state.portfolio.closed    = snap.portfolio.closed    ?? [];
    }

    // Trial
    if (snap.trial) Object.assign(state.trial, snap.trial);

    // AutoPolicy
    if (snap.autoPolicy) Object.assign(state.autoPolicy, snap.autoPolicy);

    // AutoRuntime
    if (snap.autoRuntime) {
      state.autoRuntime.spentTodayUsd = snap.autoRuntime.spentTodayUsd ?? 0;
      state.autoRuntime.startedAt     = snap.autoRuntime.startedAt     ?? null;
    }

    // Settings
    if (snap.settings) {
      state.settings.mode     = snap.settings.mode     ?? state.settings.mode;
      state.settings.wallets  = snap.settings.wallets  ?? state.settings.wallets;
      state.settings.leverage = snap.settings.leverage ?? state.settings.leverage;
    }

    // SmartExit / SmartAi / LossCooldown
    if (snap.smartExit)    Object.assign(state.smartExit,    snap.smartExit);
    if (snap.smartAi)      Object.assign(state.smartAi,      snap.smartAi);
    if (snap.lossCooldown) Object.assign(state.lossCooldown, snap.lossCooldown);

    // Runner flag (re-enable semi loop if it was on)
    state._runnerEnabled = snap.runnerEnabled || false;

    // Auto-start trial if not active
    if (!state.trial.active) {
      state.trial.active = true;
      state.trial.startedAt = state.trial.startedAt || Date.now();
      state.trial.startBalance = state.trial.startBalance || state.portfolio.balance;
      console.log('[persist] autoStartTrial — trial set to active');
    }
    console.log(`[persist] Restored: ${state.portfolio.positions.length} open positions, balance $${state.portfolio.balance.toFixed(2)}, autocore ${state.autoPolicy.enabled ? 'ON' : 'OFF'}, trial ${state.trial.active ? 'ACTIVE' : 'off'}`);
    return true;
  } catch (e) {
    console.error('[persist] load error:', e.message);
    return false;
  }
}

module.exports = { saveState, loadState };
