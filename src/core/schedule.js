// A start/stop window for the worker itself, separate from permissions.activeHours
// (which only throttles which new tasks get *picked up* in Delegated mode).
// This one actually starts/stops the worker, and the worker always finishes
// whatever task is currently running before an auto-stop takes effect --
// see OrbitWorker.checkSchedule()/maybeScheduledStop() in worker.js.
function withinSchedule(schedule, now = new Date()) {
  if (!schedule || !schedule.enabled) return true;
  if (Array.isArray(schedule.days) && schedule.days.length && !schedule.days.includes(now.getDay())) return false;
  const [sh, sm] = (schedule.start || '09:00').split(':').map(Number);
  const [eh, em] = (schedule.end || '18:00').split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? (mins >= s && mins < e) : (mins >= s || mins < e);
}
module.exports = { withinSchedule };
