// server/services/funnel-purchase-service.js - Ready-made funnels, part 2 (migration 027): buying,
// the marketer's confirmation and connecting a funnel to the expert's SI-seller.
// Owner's decisions 21 Nov.:
//  - the expert pays by the marketer's own link; the marketer confirms the payment (until SmartFlow
//    takes payments itself). A percentage of sales: the expert asks to connect on these terms, the
//    marketer agrees and sees how many sales the SI made on the funnel;
//  - monthly: works until the end of the paid month; not renewed — the SI-seller goes back to the
//    expert's own methodology by itself (server/services/ai-settings.js);
//  - the marketer's texts stay on the server: the expert sees the steps, not the instructions;
//    the marketer's step materials are not sent to the expert's clients — the expert adds their own.
const crypto = require('crypto');
const db = require('../db');
const funnelService = require('./funnel-service');
const puzzleSpec = require('./puzzle-spec');
const { cleanText } = require('./profile-service');
const { mediaUrl } = require('./media-service');
const { toDate } = require('./ai-settings');

const MONTH_DAYS = 30;
// Real results in the catalogue: only when there are enough clients to be honest about it
const RESULTS_SHOWN_FROM = 30;

class PurchaseError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (err) { return fallback; }
}

function sqlTime(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function nameOf(user) {
  if (!user) return '';
  return (parseJson(user.profile).displayName || user.display_name || '').trim();
}

// Monthly and not paid any more
function isExpired(row, now = new Date()) {
  if (row.price_type !== 'monthly' || row.status !== 'active') return false;
  const until = toDate(row.paid_until);
  return !until || until <= now;
}

// Steps where the marketer gave the client a material: the expert adds their own there
function stepsOf(snapshot) {
  return funnelService.normalizeSteps(snapshot.steps).map(st => ({
    id: st.id,
    title: st.title,
    goal: st.goal || '',
    needsMaterial: Boolean(st.material)
  }));
}

const SELECT = `
  SELECT fp.*, f.title AS funnel_title, f.niche AS funnel_niche, f.status AS funnel_status, f.payment_url AS funnel_payment_url,
         e.display_name AS expert_display_name, e.profile AS expert_profile, e.photo_media_id AS expert_photo_media_id, e.avatar_url AS expert_avatar_url,
         m.display_name AS marketer_display_name, m.profile AS marketer_profile,
         p.name AS project_name, p.funnel_purchase_id AS project_funnel_purchase_id, p.funnel_settings AS project_funnel_settings
  FROM funnel_purchases fp
  JOIN ready_funnels f ON f.id = fp.funnel_id
  LEFT JOIN users e ON e.id = fp.expert_id
  LEFT JOIN users m ON m.id = fp.marketer_id
  LEFT JOIN projects p ON p.id = fp.project_id`;

async function getRow(id) {
  return id ? db.get(`${SELECT} WHERE fp.id = ?`, [id]) : null;
}

// Numbers of the SI-seller since the funnel was connected: new clients and payments
async function numbersOf(row) {
  if (!row.project_id || !row.applied_at) return null;
  const since = row.applied_at instanceof Date ? sqlTime(row.applied_at) : row.applied_at;
  const clients = await db.get(
    `SELECT COUNT(*) AS n FROM clients WHERE project_id = ? AND created_at >= ? AND (entry IS NULL OR entry <> 'self')`,
    [row.project_id, since]
  );
  const paid = await db.get(
    `SELECT COUNT(*) AS n FROM client_events WHERE project_id = ? AND type = 'paid' AND created_at >= ?`,
    [row.project_id, since]
  );
  return { clients: Number(clients && clients.n) || 0, sales: Number(paid && paid.n) || 0, since: row.applied_at };
}

/**
 * view: 'expert' (the buyer), 'marketer' (the author: who bought, the numbers for a percentage).
 */
async function toPurchase(row, view = 'expert') {
  const snapshot = parseJson(row.snapshot);
  const connected = Boolean(row.project_id && row.project_funnel_purchase_id === row.id);
  const result = {
    id: row.id,
    funnelId: row.funnel_id,
    funnelTitle: row.funnel_title,
    funnelNiche: row.funnel_niche || '',
    priceType: row.price_type,
    priceLabel: row.price_label || '',
    status: row.status,
    expired: isExpired(row),
    note: row.note || '',
    reason: row.reason || '',
    paidUntil: row.paid_until || null,
    renewalRequested: Boolean(row.renewal_requested_at),
    renewalNote: row.renewal_note || '',
    confirmedAt: row.confirmed_at || null,
    createdAt: row.created_at
  };
  if (view === 'expert') {
    result.marketerName = nameOf({ profile: row.marketer_profile, display_name: row.marketer_display_name }) || 'Маркетолог';
    result.marketerId = row.marketer_id;
    result.paymentUrl = row.funnel_payment_url || null;
    result.steps = stepsOf(snapshot);
    result.connectedTo = connected ? { projectId: row.project_id, name: row.project_name } : null;
    if (connected) {
      const own = funnelService.normalizeSteps(parseJson(row.project_funnel_settings).steps);
      result.materials = Object.fromEntries(own.filter(st => st.material).map(st => [st.id, st.material]));
    }
  } else {
    result.expert = {
      id: row.expert_id,
      name: nameOf({ profile: row.expert_profile, display_name: row.expert_display_name }) || 'Эксперт',
      photoUrl: mediaUrl(row.expert_photo_media_id) || row.expert_avatar_url || null
    };
    result.connected = connected;
  }
  if (connected || view === 'marketer') result.numbers = connected ? await numbersOf(row) : null;
  return result;
}

// ---------- The expert ----------

async function requestPurchase(expertId, funnelId, rawNote = '') {
  const funnel = await db.get('SELECT * FROM ready_funnels WHERE id = ?', [funnelId]);
  if (!funnel || funnel.status !== 'published') throw new PurchaseError('Шаблон не найден или снят с публикации', 404, 'not_found');
  if (funnel.author_id === expertId) throw new PurchaseError('Это ваш шаблон — он уже в методологии вашего AI-продавца');
  const note = cleanText(rawNote, 300);
  if (funnel.price_type !== 'percent' && !note) {
    throw new PurchaseError('Напишите, как и когда оплатили — автору будет проще найти платёж');
  }
  const existing = await db.get(
    `SELECT * FROM funnel_purchases WHERE funnel_id = ? AND expert_id = ? AND status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1`,
    [funnelId, expertId]
  );
  if (existing && existing.status === 'pending') throw new PurchaseError('Уже ждём подтверждения автора', 409, 'conflict');
  if (existing && existing.status === 'active') {
    if (existing.price_type !== 'monthly') throw new PurchaseError('Шаблон уже ваш', 409, 'conflict');
    // Monthly: the next month
    if (existing.renewal_requested_at) throw new PurchaseError('Уже ждём, когда автор подтвердит оплату следующего месяца', 409, 'conflict');
    await db.run(
      'UPDATE funnel_purchases SET renewal_requested_at = ?, renewal_note = ?, reason = NULL, updated_at = ? WHERE id = ?',
      [sqlTime(), note, sqlTime(), existing.id]
    );
    return { row: await getRow(existing.id), renewal: true };
  }
  const id = `fpu_${crypto.randomBytes(8).toString('hex')}`;
  await db.run(
    `INSERT INTO funnel_purchases (id, funnel_id, expert_id, marketer_id, price_type, price_label, snapshot, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, funnel.id, expertId, funnel.author_id, funnel.price_type, funnel.price_label, funnel.snapshot, note || null]
  );
  return { row: await getRow(id), renewal: false };
}

async function expertRow(expertId, purchaseId) {
  const row = await getRow(purchaseId);
  if (!row || row.expert_id !== expertId) throw new PurchaseError('Покупка не найдена', 404, 'not_found');
  return row;
}

/**
 * Connect a bought funnel to one's own SI-seller (one at a time). materials: { stepId: text or link }
 * for the steps where the client gets a material — the expert's own; the marketer's are not used.
 */
async function apply(expertId, purchaseId, projectId, materials = {}, brainAccess) {
  const row = await expertRow(expertId, purchaseId);
  if (row.status !== 'active') throw new PurchaseError('Шаблон можно подключить после того, как автор подтвердит оплату');
  if (isExpired(row)) throw new PurchaseError('Оплаченный месяц закончился — оплатите следующий, чтобы подключить снова');
  const project = projectId ? await db.get('SELECT * FROM projects WHERE id = ?', [projectId]) : null;
  if (!project || project.owner_id !== expertId) throw new PurchaseError('Выберите своего SI-продавца', 404, 'not_found');

  const snapshot = parseJson(row.snapshot);
  const own = (materials && typeof materials === 'object') ? materials : {};
  const steps = funnelService.normalizeSteps(snapshot.steps).map(st => ({
    ...st,
    material: cleanText(String(own[st.id] || ''), 1000)
  }));
  const settings = {
    title: row.funnel_title,
    goal: snapshot.goal || '',
    instructions: snapshot.instructions || '',
    methodology: snapshot.methodology || '',
    steps: funnelService.normalizeSteps(steps),
    scenarios: funnelService.normalizeScenarios(snapshot.scenarios, steps),
    puzzle: puzzleSpec.normalizePuzzle(snapshot.puzzle)
  };
  // The author's puzzle: the funnel starts selling only when its condition is met (answers already given count)
  const fpz = settings.puzzle.pieces.length ? settings.puzzle : null;
  const answers = fpz ? await require('./puzzle-service').answersOf(project.id) : {};
  const released = !fpz || puzzleSpec.releaseMet(fpz, answers) ? 1 : 0;
  // As soon as an expert buys a funnel, it asks for the access to the Brain (owner's decision 22 Nov.)
  const access = brainAccess === undefined ? Number(project.funnel_brain_access) !== 0 : Boolean(brainAccess);
  const until = row.price_type === 'monthly' ? row.paid_until : null;
  const now = sqlTime();

  // The funnel moves: off the SI-seller it was on; the SI-seller loses another funnel it had
  if (row.project_id && row.project_id !== project.id) {
    await db.run(
      'UPDATE projects SET funnel_settings = NULL, funnel_until = NULL, funnel_purchase_id = NULL, funnel_released = 1 WHERE id = ? AND funnel_purchase_id = ?',
      [row.project_id, row.id]
    );
  }
  if (project.funnel_purchase_id && project.funnel_purchase_id !== row.id) {
    await db.run('UPDATE funnel_purchases SET project_id = NULL, applied_at = NULL, updated_at = ? WHERE id = ?', [now, project.funnel_purchase_id]);
  }
  await db.run(
    'UPDATE projects SET funnel_settings = ?, funnel_until = ?, funnel_purchase_id = ?, funnel_released = ?, funnel_brain_access = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(settings), until, row.id, released, access ? 1 : 0, now, project.id]
  );
  // The numbers for a percentage count from the first connection to this SI-seller
  const sameProject = row.project_id === project.id && row.applied_at;
  await db.run(
    'UPDATE funnel_purchases SET project_id = ?, applied_at = ?, updated_at = ? WHERE id = ?',
    [project.id, sameProject ? row.applied_at : now, now, row.id]
  );
  return { row: await getRow(row.id), moved: Boolean(row.project_id && row.project_id !== project.id), first: !row.project_id, released: Boolean(released), puzzle: Boolean(fpz) };
}

/**
 * A bought template becomes a NEW AI-продавец of the expert (owner's decision 22 Nov.; the sellers made before
 * keep working): in the business and with the product the expert chose, with the name they gave. Then the
 * template is connected to it as by apply() (the Brain access, the author's puzzle).
 */
async function launch(expertId, purchaseId, { businessId = null, productId = null, name = '', materials = {}, brainAccess } = {}) {
  const row = await expertRow(expertId, purchaseId);
  if (row.status !== 'active') throw new PurchaseError('AI-продавца можно запустить после того, как автор подтвердит оплату');
  if (isExpired(row)) throw new PurchaseError('Оплаченный месяц закончился — оплатите следующий, чтобы запустить снова');
  const projectService = require('./project-service');
  const sellerName = cleanText(name, 80) || row.funnel_title;
  let project;
  try {
    project = await projectService.createProject(expertId, { name: sellerName, businessId: businessId ? String(businessId) : null, productId: productId ? String(productId) : null });
  } catch (err) {
    throw new PurchaseError(err.message || 'Не получилось создать AI-продавца', err.status || 400, err.code || 'bad_request');
  }
  try {
    const out = await apply(expertId, purchaseId, project.id, materials, brainAccess);
    return { ...out, projectId: project.id };
  } catch (err) {
    await db.run('DELETE FROM projects WHERE id = ?', [project.id]); // nothing half-made stays behind
    throw err;
  }
}

async function detachProject(row) {
  if (!row.project_id) return;
  await db.run(
    'UPDATE projects SET funnel_settings = NULL, funnel_until = NULL, funnel_purchase_id = NULL, funnel_released = 1 WHERE id = ? AND funnel_purchase_id = ?',
    [row.project_id, row.id]
  );
  await db.run('UPDATE funnel_purchases SET project_id = NULL, applied_at = NULL, updated_at = ? WHERE id = ?', [sqlTime(), row.id]);
}

async function detach(expertId, purchaseId) {
  const row = await expertRow(expertId, purchaseId);
  if (!row.project_id) throw new PurchaseError('Шаблон не подключён');
  await detachProject(row);
  return getRow(row.id);
}

async function listForExpert(expertId) {
  const rows = await db.all(`${SELECT} WHERE fp.expert_id = ? ORDER BY fp.created_at DESC`, [expertId]);
  return Promise.all(rows.map(r => toPurchase(r, 'expert')));
}

// The latest purchase of this funnel by this expert (for the funnel's page)
async function mineFor(expertId, funnelId) {
  const row = await db.get(`${SELECT} WHERE fp.expert_id = ? AND fp.funnel_id = ? ORDER BY fp.created_at DESC LIMIT 1`, [expertId, funnelId]);
  return row ? toPurchase(row, 'expert') : null;
}

// ---------- The marketer ----------

async function marketerRow(marketerId, purchaseId) {
  const row = await getRow(purchaseId);
  if (!row || row.marketer_id !== marketerId) throw new PurchaseError('Покупка не найдена', 404, 'not_found');
  return row;
}

/**
 * The marketer's answer: 'confirm' (the payment came / I agree to a percentage) or 'decline' (with a
 * reason the expert sees). Works on a new purchase and on a monthly renewal.
 */
async function decide(marketerId, purchaseId, decision, rawReason = '') {
  if (!['confirm', 'decline'].includes(decision)) throw new PurchaseError('Неизвестное решение');
  const row = await marketerRow(marketerId, purchaseId);
  const reason = cleanText(rawReason, 300);
  if (decision === 'decline' && !reason) throw new PurchaseError('Напишите причину — эксперт её увидит');
  const now = new Date();
  const renewal = row.status === 'active' && Boolean(row.renewal_requested_at);
  if (row.status !== 'pending' && !renewal) throw new PurchaseError('Здесь уже нечего подтверждать — обновите экран', 409, 'conflict');

  if (renewal) {
    if (decision === 'decline') {
      await db.run('UPDATE funnel_purchases SET renewal_requested_at = NULL, reason = ?, updated_at = ? WHERE id = ?', [reason, sqlTime(), row.id]);
    } else {
      const current = toDate(row.paid_until);
      const from = current && current > now ? current : now;
      const until = sqlTime(new Date(from.getTime() + MONTH_DAYS * 86400000));
      await db.run(
        'UPDATE funnel_purchases SET paid_until = ?, renewal_requested_at = NULL, renewal_note = NULL, reason = NULL, updated_at = ? WHERE id = ?',
        [until, sqlTime(), row.id]
      );
      if (row.project_id) await db.run('UPDATE projects SET funnel_until = ? WHERE id = ? AND funnel_purchase_id = ?', [until, row.project_id, row.id]);
    }
    return { row: await getRow(row.id), renewal: true };
  }

  const changed = decision === 'confirm'
    ? await db.run(
      `UPDATE funnel_purchases SET status = 'active', confirmed_at = ?, paid_until = ?, reason = NULL, updated_at = ? WHERE id = ? AND status = 'pending'`,
      [sqlTime(), row.price_type === 'monthly' ? sqlTime(new Date(now.getTime() + MONTH_DAYS * 86400000)) : null, sqlTime(), row.id]
    )
    : await db.run(
      `UPDATE funnel_purchases SET status = 'declined', reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      [reason, sqlTime(), row.id]
    );
  if (changed && changed.changes === 0) throw new PurchaseError('Здесь уже нечего подтверждать — обновите экран', 409, 'conflict');
  return { row: await getRow(row.id), renewal: false };
}

// A percentage the expert does not pay: the marketer stops it (with a reason); the SI-seller goes back
async function endPercent(marketerId, purchaseId, rawReason = '') {
  const row = await marketerRow(marketerId, purchaseId);
  if (row.price_type !== 'percent' || row.status !== 'active') throw new PurchaseError('Отключить можно только шаблон за процент с продаж');
  const reason = cleanText(rawReason, 300);
  if (!reason) throw new PurchaseError('Напишите причину — эксперт её увидит');
  await detachProject(row);
  await db.run(`UPDATE funnel_purchases SET status = 'ended', reason = ?, updated_at = ? WHERE id = ?`, [reason, sqlTime(), row.id]);
  return getRow(row.id);
}

async function listForMarketer(marketerId) {
  const rows = await db.all(
    `${SELECT} WHERE fp.marketer_id = ? AND fp.status IN ('pending', 'active', 'ended') ORDER BY fp.created_at DESC LIMIT 200`,
    [marketerId]
  );
  return Promise.all(rows.map(r => toPurchase(r, 'marketer')));
}

async function waitingForMarketer(marketerId) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM funnel_purchases WHERE marketer_id = ? AND (status = 'pending' OR (status = 'active' AND renewal_requested_at IS NOT NULL))`,
    [marketerId]
  );
  return Number(row && row.n) || 0;
}

/**
 * Real results of funnels in the catalogue: experts using it now and, once there are enough
 * clients, how many of them bought. Never made up: below RESULTS_SHOWN_FROM clients — no share.
 */
async function resultsFor(funnelIds) {
  const out = {};
  if (!funnelIds.length) return out;
  const rows = await db.all(
    `SELECT fp.* FROM funnel_purchases fp JOIN projects p ON p.id = fp.project_id AND p.funnel_purchase_id = fp.id
     WHERE fp.status = 'active' AND fp.funnel_id IN (${funnelIds.map(() => '?').join(',')})`,
    funnelIds
  );
  for (const row of rows) {
    if (isExpired(row)) continue;
    const n = await numbersOf(row);
    const r = out[row.funnel_id] || (out[row.funnel_id] = { experts: 0, clients: 0, sales: 0 });
    r.experts += 1;
    if (n) { r.clients += n.clients; r.sales += n.sales; }
  }
  for (const r of Object.values(out)) {
    r.salesShare = r.clients >= RESULTS_SHOWN_FROM ? Math.round((r.sales / r.clients) * 100) : null;
    if (r.clients < RESULTS_SHOWN_FROM) { delete r.clients; delete r.sales; }
  }
  return out;
}

module.exports = {
  PurchaseError,
  MONTH_DAYS,
  RESULTS_SHOWN_FROM,
  nameOf,
  getRow,
  toPurchase,
  requestPurchase,
  apply,
  launch,
  detach,
  listForExpert,
  mineFor,
  decide,
  endPercent,
  listForMarketer,
  waitingForMarketer,
  resultsFor
};
