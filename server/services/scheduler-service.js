// server/services/scheduler-service.js - The server "alarm clock": once a minute it runs its jobs.
//
// Jobs now: "клиент замолчал" scenarios (followup-service.js). Later: reminders about meetings and
// webinars. Each job has a lease row in scheduler_jobs, so that two copies of the server (e.g. during
// a Railway redeploy) never run the same job at the same time. A failing job is logged and retried
// on the next minute; it never stops the server or the other jobs.
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

const TICK_MS = 60 * 1000;
const FIRST_TICK_MS = 15 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const INSTANCE = `srv_${crypto.randomBytes(4).toString('hex')}`;

const jobs = [];
let timer = null;
let lastTickAt = null;

const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * name: unique id; run: async (now) => result (a short object, kept as the last result).
 */
function register(name, run) {
  if (jobs.some(j => j.name === name)) return;
  jobs.push({ name, run });
}

// Takes the job for this server copy, or returns false if another copy runs it right now
async function acquire(name, now) {
  await db.run('INSERT INTO scheduler_jobs (name) VALUES (?) ON CONFLICT (name) DO NOTHING', [name]);
  const res = await db.run(
    `UPDATE scheduler_jobs SET locked_until = ?, locked_by = ?, last_started_at = ?
     WHERE name = ? AND (locked_until IS NULL OR locked_until < ? OR locked_by = ?)`,
    [sqlTime(new Date(now.getTime() + LEASE_MS)), INSTANCE, sqlTime(now), name, sqlTime(now), INSTANCE]
  );
  return Number(res.changes) === 1;
}

async function runJob(job, now) {
  if (!(await acquire(job.name, now))) return { name: job.name, skipped: true };
  let result = null;
  let error = null;
  try {
    result = await job.run(now);
  } catch (err) {
    error = err;
    console.error(`[SmartFlow Scheduler] ${job.name} failed:`, err.message);
  }
  await db.run(
    `UPDATE scheduler_jobs SET locked_until = NULL, last_finished_at = ?, last_error = ?, last_result = ?, runs = runs + 1
     WHERE name = ? AND locked_by = ?`,
    [sqlTime(new Date()), error ? String(error.message).slice(0, 500) : null, result ? JSON.stringify(result).slice(0, 500) : null, job.name, INSTANCE]
  );
  return { name: job.name, result, error: error ? error.message : null };
}

/**
 * One pass over all jobs (also called directly by tests).
 */
async function tick(now = new Date()) {
  lastTickAt = now;
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await runJob(job, now));
    } catch (err) {
      // The database itself failed: try again on the next minute
      console.error(`[SmartFlow Scheduler] ${job.name}: ${err.message}`);
      results.push({ name: job.name, error: err.message });
    }
  }
  return results;
}

function start() {
  if (timer || config.isTest) return;
  const safeTick = () => tick().catch(err => console.error('[SmartFlow Scheduler] tick failed:', err.message));
  setTimeout(safeTick, FIRST_TICK_MS).unref();
  timer = setInterval(safeTick, TICK_MS);
  timer.unref();
  console.log(`[SmartFlow Scheduler] started: ${jobs.map(j => j.name).join(', ') || 'no jobs'} (every minute)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * For /api/health and the support panel: is the alarm clock running, and how did each job end.
 */
async function status() {
  const rows = await db.all('SELECT name, last_finished_at, last_error, last_result, runs FROM scheduler_jobs ORDER BY name');
  return {
    running: Boolean(timer),
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    jobs: rows.map(r => ({
      name: r.name,
      lastFinishedAt: r.last_finished_at,
      lastError: r.last_error,
      lastResult: r.last_result,
      runs: Number(r.runs) || 0
    }))
  };
}

module.exports = { register, tick, start, stop, status, sqlTime };
