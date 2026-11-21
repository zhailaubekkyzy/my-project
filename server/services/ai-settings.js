// server/services/ai-settings.js - What the SI-seller follows right now (no dependencies: used everywhere).
// The expert's own methodology lives in projects.custom_ai_settings. A ready-made funnel connected to
// the SI-seller (migration 027) replaces its goal, instructions, methodology, steps and scenarios while
// it is paid: funnel_until empty (one-time payment, percentage) or in the future (monthly). After that
// the expert's own methodology works again by itself — nothing has to run on time.
const FUNNEL_FIELDS = ['goal', 'instructions', 'methodology', 'steps', 'scenarios'];

function parse(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

// Database time: a Date (PostgreSQL) or "2026-11-21 10:00:00" in UTC (SQLite)
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) ? `${str.replace(' ', 'T')}Z` : str);
  return isNaN(d) ? null : d;
}

function funnelOn(project, now = new Date()) {
  if (!project || !project.funnel_settings) return false;
  const until = toDate(project.funnel_until);
  return !project.funnel_until || (until && until > now);
}

/** The settings the SI follows now: the connected funnel while it is paid, otherwise the expert's own. */
function settingsOf(project, now = new Date()) {
  const own = parse(project && project.custom_ai_settings);
  if (!funnelOn(project, now)) return own;
  const funnel = parse(project.funnel_settings);
  const merged = { ...own };
  for (const key of FUNNEL_FIELDS) merged[key] = funnel[key] !== undefined ? funnel[key] : (key === 'steps' || key === 'scenarios' ? [] : '');
  return merged;
}

module.exports = { settingsOf, funnelOn, toDate, FUNNEL_FIELDS };
