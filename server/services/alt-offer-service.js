// server/services/alt-offer-service.js - Alternative offers above the chat.
//
// Owner's decisions (15 Oct.): when the SI notices an objection, the client sees up to 3 SI-sellers of OTHER
// experts from the Marketplace that may solve their problem. All listed SI-sellers take part, the same niche
// included — the platform's goal is to find the client a solution sooner. The more concretely an expert's
// methodology closes objections and describes the product, the more often their SI-seller appears to others
// (quality score below). SI picks what fits this client's objection; without OpenAI — by common words.
// Nothing is written into the first expert's client journal; the numbers go to PostHog only.
const db = require('../db');
const siEngine = require('./si-engine');
const funnelService = require('./funnel-service');
const partnerService = require('./partner-service');
const analytics = require('./analytics-service');
const { mediaUrl } = require('./media-service');

const PARTNER_BONUS = 15;

const MAX_SHOWN = 3;
const CANDIDATES = 15;
const SHOW_DAYS = 7;

const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const toDate = (value) => (value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[Z+]/.test(String(value)) ? '' : 'Z')));

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str) || fallback; } catch (e) { return fallback; }
}

/**
 * How well an SI-seller is worked out (0–100): the general methodology, scenarios that close objections,
 * steps of the funnel, the description, price and payment link, real reviews, the SI-brain.
 */
function qualityScore(row) {
  const s = parseJson(row.custom_ai_settings);
  const scenarios = funnelService.normalizeScenarios(s.scenarios);
  const closing = scenarios.filter(sc => sc.when === 'objection' || sc.when === 'custom').length;
  const steps = funnelService.normalizeSteps(s.steps).length;
  const reviews = Number(row.review_count) || 0;
  const average = Number(row.review_average) || 0;
  let score = 0;
  score += Math.min(20, String(s.methodology || '').trim().length / 40);
  score += Math.min(25, closing * 5);
  score += Math.min(10, steps * 3);
  score += Math.min(15, String(row.description || '').trim().length / 20);
  if (row.price_label) score += 5;
  if (row.payment_url) score += 5;
  if (reviews) score += Math.min(10, reviews * 2) * (average / 5);
  if (Number(row.materials) > 0) score += 10;
  return Math.round(Math.min(100, score));
}

const CANDIDATE_SQL = `
  SELECT p.*,
    (SELECT COUNT(*) FROM reviews r WHERE r.project_id = p.id AND r.hidden_at IS NULL) AS review_count,
    (SELECT AVG(r.rating) FROM reviews r WHERE r.project_id = p.id AND r.hidden_at IS NULL) AS review_average,
    (SELECT COUNT(*) FROM consultant_materials cm WHERE cm.project_id = p.id) AS materials,
    (SELECT COUNT(*) FROM users bu JOIN tracked_links bl ON bl.id = bu.referred_by_link WHERE bl.owner_user_id = p.owner_id) AS owner_brought
  FROM projects p
  WHERE p.is_listed = 1 AND p.status = 'active' AND p.is_demo = 0 AND COALESCE(p.offer, '') <> ''
    AND p.owner_id <> ? AND p.id <> ?`;

// What a candidate offers and how it handles doubts, in short (for the choice and for word matching)
function summary(row) {
  const s = parseJson(row.custom_ai_settings);
  const scenarios = funnelService.normalizeScenarios(s.scenarios)
    .filter(sc => sc.when === 'objection' || sc.when === 'custom')
    .map(sc => [sc.words, sc.condition, sc.text].filter(Boolean).join(' → '))
    .slice(0, 5);
  return [row.name, row.offer, row.niche, row.price_label, String(row.description || '').slice(0, 300),
    String(s.methodology || '').slice(0, 300), scenarios.join('; ')].filter(Boolean).join(' · ');
}

const WORD = /[a-zа-яё0-9]{4,}/gi;
const wordsOf = (text) => new Set((String(text || '').toLowerCase().match(WORD) || []).map(w => w.slice(0, 6)));

/**
 * Picks up to 3 other experts' SI-sellers for this client's objection and keeps them on the client row.
 * Returns the ids (possibly none).
 */
async function refresh(project, client, objection, clientText = '') {
  const rows = await db.all(CANDIDATE_SQL, [project.owner_id, project.id]);
  if (!rows.length) return [];
  // SMARTFLOW PARTNER owners get a lift (owner's decision 15 Oct.), the methodology still matters most
  const ranked = rows.map(r => ({ row: r, quality: qualityScore(r) + (Number(r.owner_brought) >= partnerService.PARTNER_MIN ? PARTNER_BONUS : 0) }))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, CANDIDATES);
  const context = `${objection || ''} ${clientText || ''}`.trim();
  let ids = null;
  if (siEngine.isConfigured()) {
    const answer = await siEngine.callOpenAI([
      {
        role: 'system',
        content: [
          'Клиент засомневался в предложении одного эксперта. Выбери из списка других предложений до 3, которые',
          'реально могут решить проблему клиента (с учётом его возражения: цена, формат, время и т. п.).',
          'Порядок списка — от лучше проработанных; при равной пользе бери тех, кто выше. Если ничего не подходит — пусто.',
          'Ответь только JSON {"ids": ["..."]}.',
          ...ranked.map(c => `${c.row.id}: ${summary(c.row)}`)
        ].join('\n')
      },
      { role: 'user', content: `Предложение, в котором клиент засомневался: ${project.offer || project.name}.\nВозражение и слова клиента: ${context.slice(0, 800)}` }
    ], { response_format: { type: 'json_object' } });
    try {
      const parsed = answer ? JSON.parse(answer) : null;
      if (parsed && Array.isArray(parsed.ids)) ids = parsed.ids.filter(id => ranked.some(c => c.row.id === id)).slice(0, MAX_SHOWN);
    } catch (e) { ids = null; }
  }
  if (!ids) {
    // Without OpenAI: common words between the client's doubt and the candidate, then the quality
    const need = wordsOf(`${context} ${project.niche || ''} ${project.offer || ''}`);
    ids = ranked
      .map(c => ({ id: c.row.id, quality: c.quality, overlap: [...wordsOf(summary(c.row))].filter(w => need.has(w)).length }))
      .filter(c => c.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || b.quality - a.quality)
      .slice(0, MAX_SHOWN)
      .map(c => c.id);
  }
  await db.run('UPDATE clients SET alt_offers = ?, alt_offers_at = CURRENT_TIMESTAMP WHERE id = ?', [
    JSON.stringify({ ids, objection: String(objection || '').slice(0, 200) }), client.id
  ]);
  if (ids.length) analytics.capture('alt_offers_shown', client.external_client_id, { project_id: project.id, count: ids.length });
  return ids;
}

/**
 * The cards to show above this client's chat (fresh, still listed; not after buying here).
 */
async function forClient(client, now = new Date()) {
  if (!client || !client.alt_offers || client.funnel_status === 'bought') return [];
  if (client.alt_offers_at && now - toDate(client.alt_offers_at) > SHOW_DAYS * 86400000) return [];
  const ids = (parseJson(client.alt_offers).ids || []).slice(0, MAX_SHOWN);
  if (!ids.length) return [];
  const rows = await db.all(
    `SELECT p.id, p.slug, p.name, p.offer, p.price_label, p.photo_media_id, p.role_title,
       (SELECT COUNT(*) FROM reviews r WHERE r.project_id = p.id AND r.hidden_at IS NULL) AS review_count,
       (SELECT AVG(r.rating) FROM reviews r WHERE r.project_id = p.id AND r.hidden_at IS NULL) AS review_average
     FROM projects p WHERE p.id IN (${ids.map(() => '?').join(', ')}) AND p.is_listed = 1 AND p.status = 'active'`,
    ids
  );
  return ids.map(id => rows.find(r => r.id === id)).filter(Boolean).map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    offer: r.offer || '',
    priceLabel: r.price_label || '',
    roleTitle: r.role_title || 'SI-консультант',
    photoUrl: mediaUrl(r.photo_media_id),
    reviews: { count: Number(r.review_count) || 0, average: Number(r.review_count) ? Math.round(Number(r.review_average) * 10) / 10 : null }
  }));
}

module.exports = { MAX_SHOWN, SHOW_DAYS, qualityScore, refresh, forClient, sqlTime };
