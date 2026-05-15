const { autoPolicy, portfolio } = require('./state');
const { runAutoPickOnce } = require('./autopicker');

const schedule = {
enabled: false,
everyMin: 10,
timer: null
};

function stopSchedule() {
if (schedule.timer) clearInterval(schedule.timer);
schedule.timer = null;
schedule.enabled = false;
}

function startSchedule() {
if (schedule.timer) clearInterval(schedule.timer);

schedule.enabled = true;
const ms = Math.max(1, Number(schedule.everyMin || 5)) * 60 * 1000;

schedule.timer = setInterval(async () => {
try {
if (!schedule.enabled) return;
if (!autoPolicy.enabled) return;
if ((autoPolicy.mode || 'paper') !== 'paper') return;

const open = (portfolio.positions || []).length;
const maxOpen = Number(autoPolicy.maxOpen || 2);
if (open >= maxOpen) return;

await runAutoPickOnce(null, false);
} catch {}
}, ms);
}

function setEveryMin(v) {
const n = Math.max(1, Number(v || 5));
schedule.everyMin = n;
if (schedule.enabled) startSchedule();
}

function getScheduleStatus() {
return {
enabled: !!schedule.enabled,
everyMin: Number(schedule.everyMin || 5)
};
}

module.exports = {
startSchedule,
stopSchedule,
setEveryMin,
getScheduleStatus
};
