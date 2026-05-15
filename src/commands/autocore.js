const { reply } = require('../telegram');
const { persistNow } = require('../state');
const { autoPolicy, autoRuntime } = require('../state');
const { runAutoPickOnce } = require('../autopicker');
const { startSchedule, stopSchedule, setEveryMin, getScheduleStatus } = require('../scheduler');

function gasSummary() {
  const rows = Object.entries(autoRuntime.gasStatus || {}).map(([chain, s]) => {
    const icon = s?.ok ? '✅' : '⚠️';
    return `${icon} ${chain}: ${s?.reason || 'n/a'}`;
  });
  return rows.join('\n');
}

async function handleAutocore(chatId, parts) {
  const sub = (parts[1] || 'status').toLowerCase();

  if (sub === 'go') {
    autoPolicy.mode = 'paper';
    autoPolicy.enabled = true; persistNow();
    if (!Number.isFinite(Number(autoPolicy.perTradeUsd)) || Number(autoPolicy.perTradeUsd) <= 0) autoPolicy.perTradeUsd = 3;
    if (!Number.isFinite(Number(autoPolicy.dailyMaxUsd)) || Number(autoPolicy.dailyMaxUsd) < 100) autoPolicy.dailyMaxUsd = 400;
    if (!Number.isFinite(Number(autoPolicy.maxOpen)) || Number(autoPolicy.maxOpen) <= 0) autoPolicy.maxOpen = 2;

    setEveryMin(10);
    startSchedule();

    await runAutoPickOnce(chatId, true).catch(() => null);

    await reply(chatId, `🚀 AutoCore GO
Mode: PAPER
perTradeUsd: $${autoPolicy.perTradeUsd}
dailyMaxUsd: $${autoPolicy.dailyMaxUsd}
maxOpen: ${autoPolicy.maxOpen}
Scheduler: ON every 10 min`);
    return;
  }

  if (sub === 'safe') {
    autoPolicy.mode = 'paper';
    autoPolicy.perTradeUsd = 3;
    autoPolicy.dailyMaxUsd = 200;
    autoPolicy.maxOpen = 2;
    autoPolicy.enabled = true; persistNow();
    setEveryMin(10);
    startSchedule();

    await reply(chatId, `🛡 AutoCore SAFE preset applied
Mode: PAPER
perTradeUsd: $3
dailyMaxUsd: $200
maxOpen: 2
Scheduler: ON every 10 min`);
    return;
  }

  if (sub === 'resetday') {
    autoRuntime.spentTodayUsd = 0;
    await reply(chatId, '🧹 AutoCore daily spend reset to $0');
    return;
  }

  if (sub === 'start') {
    autoPolicy.enabled = true; persistNow();
    autoRuntime.startedAt = Date.now();
    await reply(chatId, '🤖 Auto Core STARTED.');
    return;
  }

  if (sub === 'stop') {
    autoPolicy.enabled = false; persistNow();
    await reply(chatId, '⏸ Auto Core STOPPED.');
    return;
  }

  if (sub === 'mode' && parts[2]) {
    const m = String(parts[2]).toLowerCase();
    if (!['paper', 'live'].includes(m)) {
      await reply(chatId, 'Mode must be paper or live.');
      return;
    }
    autoPolicy.mode = m;
    await reply(chatId, `✅ Auto Core mode set to ${m.toUpperCase()}`);
    return;
  }

  if (sub === 'pertrade' && parts[2]) {
    const v = Number(parts[2]);
    if (!Number.isFinite(v) || v <= 0) {
      await reply(chatId, 'pertrade must be > 0');
      return;
    }
    autoPolicy.perTradeUsd = v;
    await reply(chatId, `✅ perTradeUsd set to $${v}`);
    return;
  }

  if (sub === 'daily' && parts[2]) {
    const v = Number(parts[2]);
    if (!Number.isFinite(v) || v <= 0) {
      await reply(chatId, 'daily must be > 0');
      return;
    }
    autoPolicy.dailyMaxUsd = v;
    await reply(chatId, `✅ dailyMaxUsd set to $${v}`);
    return;
  }

  if (sub === 'chain' && parts[2] && parts[3]) {
    const action = String(parts[2]).toLowerCase();
    const chain = String(parts[3]).toUpperCase();
    if (!['on', 'off'].includes(action)) {
      await reply(chatId, 'Usage: /autocore chain on|off <ETH|BASE|BNB|ARB|SOL>');
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(autoPolicy.chainsEnabled, chain)) {
      await reply(chatId, 'Unknown chain. Use ETH, BASE, BNB, ARB, SOL');
      return;
    }
    autoPolicy.chainsEnabled[chain] = action === 'on';
    await reply(chatId, `✅ Chain ${chain} ${action.toUpperCase()}`);
    return;
  }

  if (sub === 'run') {
    const out = await runAutoPickOnce(chatId, true);
    await reply(chatId, out.message);
    return;
  }

  if (sub === 'sched') {
const action = String(parts[2] || 'status').toLowerCase();

    if (action === 'on') {
      startSchedule();
      const s = getScheduleStatus();
      await reply(chatId, `⏱ Scheduler ON (every ${s.everyMin} min)`);
      return;
    }

    if (action === 'off') {
      stopSchedule();
      await reply(chatId, '⏱ Scheduler OFF');
      return;
    }

    if (action === 'every' && parts[3]) {
      setEveryMin(Number(parts[3]));
      const s = getScheduleStatus();
      await reply(chatId, `⏱ Scheduler interval set to ${s.everyMin} min`);
      return;
    }

    const s = getScheduleStatus();
    await reply(chatId, `⏱ Scheduler: ${s.enabled ? 'ON' : 'OFF'} (every ${s.everyMin} min)`);
    return;
  }

  const sched = getScheduleStatus();

  await reply(
    chatId,
`🤖 Auto Core Status
Enabled: ${autoPolicy.enabled ? 'YES' : 'NO'}
Mode: ${(autoPolicy.mode || 'paper').toUpperCase()}
perTradeUsd: $${autoPolicy.perTradeUsd}
dailyMaxUsd: $${autoPolicy.dailyMaxUsd}
maxOpen: ${autoPolicy.maxOpen}
spentTodayUsd: $${autoRuntime.spentTodayUsd}

Chains:
${Object.entries(autoPolicy.chainsEnabled || {}).map(([k, v]) => `${v ? '✅' : '❌'} ${k}`).join('\n')}

Gas readiness:
${gasSummary()}

Scheduler:
${sched.enabled ? 'ON' : 'OFF'} every ${sched.everyMin} min

Commands:
• /autocore go
• /autocore safe
• /autocore resetday
• /autocore start
• /autocore stop
• /autocore mode paper|live
• /autocore pertrade <usd>
• /autocore daily <usd>
• /autocore chain on|off <CHAIN>
• /autocore run
• /autocore sched on|off|every <min>`
  );
}

module.exports = { handleAutocore };
