// server/services/inheritance.js - Data goes down: бизнес → продукт → AI-продавец («Бизнес-режим 2.0», шаг 1).
// The expert explains things once: what the AI-продавец has not filled in itself is taken from its product, and
// «о бизнесе» from its business, «обо мне» from the Profile — only what the expert allowed («пазл», шаг 3); plus the
// expert's own additions (seller_notes). What the seller has itself always wins (owner's decision 22 Nov.: below, one may
// change one's own — a different price, an offer). Nothing is invented: empty stays empty.
const db = require('../db');
const puzzleSpec = require('./puzzle-spec');

// Seller field ← product field (both as the expert typed them)
const FROM_PRODUCT = [
  ['offer', 'name'],
  ['description', 'description'],
  ['payment_url', 'payment_url'],
  ['access_url', 'access_url']
];

/**
 * A copy of the seller (project row) with what it inherits. Adds:
 *   inheritedProduct  — the product's details for the SI's knowledge (result, format, duration, installment, guarantee)
 *   inheritedBusiness — name, about, niche of the business
 * The original row is not changed and nothing is written to the database.
 */
async function withInherited(project) {
  if (!project) return project;
  const out = { ...project };
  const product = project.product_id
    ? await db.get(`SELECT * FROM products WHERE id = ? AND status = 'active'`, [project.product_id])
    : null;
  if (product) {
    for (const [own, from] of FROM_PRODUCT) {
      if (!out[own] && product[from]) out[own] = product[from];
    }
    // The price goes as a whole: the seller's own price (or «бесплатно» / «по запросу») wins
    if (!out.price_mode && !out.price_label) {
      if (product.price_mode && product.price_mode !== 'fixed') out.price_mode = product.price_mode;
      else if (product.price_label) out.price_label = product.price_label;
    }
    out.inheritedProduct = {
      name: product.name,
      result: product.result || '',
      format: product.format || '',
      duration: product.duration || '',
      installment: product.installment || '',
      guarantee: product.guarantee || ''
    };
  }
  // «Пазл» (шаг 3): «о бизнесе» — только если эксперт разрешил (по умолчанию да)
  const knowsBusiness = project.knows_business === undefined || project.knows_business === null || Number(project.knows_business) === 1;
  const business = knowsBusiness && project.business_id ? await db.get('SELECT name, about, niche FROM businesses WHERE id = ?', [project.business_id]) : null;
  if (business && (business.about || business.name)) {
    out.inheritedBusiness = { name: business.name || '', about: business.about || '', niche: business.niche || '' };
  }
  // «Обо мне» из Профиля эксперта — только с его разрешения (по умолчанию нет)
  if (Number(project.knows_profile) === 1) {
    const owner = await db.get('SELECT profile FROM users WHERE id = ?', [project.owner_id]);
    let p = {};
    try { p = JSON.parse((owner && owner.profile) || '{}'); } catch (e) { p = {}; }
    const fields = { headline: p.headline || '', bio: p.bio || '', regalia: p.regalia || '', results: p.results || '' };
    if (Object.values(fields).some(Boolean)) out.inheritedProfile = fields;
  }
  // Дополнения эксперта: свои у продавца, работают и с купленной воронкой
  const notes = await db.all('SELECT step_id, topic, text FROM seller_notes WHERE project_id = ? ORDER BY created_at, id', [project.id]);
  if (notes.length) out.sellerNotes = notes.map(n => ({ stepId: n.step_id || null, topic: n.topic, text: n.text }));
  // Ответы эксперта на вопросы пазла купленной воронки (что нужно этой воронке, решил её автор)
  const fpz = puzzleSpec.funnelPuzzleOf(project);
  if (fpz) {
    const rows = await db.all('SELECT question_id, answer FROM seller_answers WHERE project_id = ?', [project.id]);
    const answers = Object.fromEntries(rows.map(r => [r.question_id, r.answer]));
    const list = [];
    for (const piece of fpz.pieces) {
      for (const q of piece.questions) if (answers[q.id]) list.push({ piece: piece.title, question: q.text, answer: answers[q.id] });
    }
    if (list.length) out.puzzleAnswers = list;
  }
  return out;
}

module.exports = { withInherited, FROM_PRODUCT };
