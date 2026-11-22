// server/services/puzzle-spec.js - The puzzle a funnel's author defines (owner's decisions 22 Nov.).
// No dependencies: used by the methodology (projects route), the frozen funnel (ready-funnel-service),
// inheritance (what the SI knows) and puzzle-service.
//  - pieces: what this funnel needs from the expert — only what the author decided, nothing extra;
//  - each piece has questions (one at a time, like an interview); a question may name where the answer
//    already is in the expert's Brain (source) — then it is filled in by itself, the expert may change it;
//  - release: when the funnel may start selling for the expert (an incomplete seller would hurt the
//    author's numbers and name): all required pieces (default), all pieces, or a number of pieces.
const MAX_PIECES = 8; // they sit around the SI in a 3×3 grid
const MAX_QUESTIONS = 6;

// Where an answer may already be in the Brain. label — for the author's editor
const SOURCES = {
  'business.about': 'Мозг → о бизнесе',
  'business.niche': 'Мозг → ниша',
  'product.name': 'Продукт → название',
  'product.description': 'Продукт → описание',
  'product.result': 'Продукт → результат клиента',
  'product.format': 'Продукт → формат',
  'product.duration': 'Продукт → длительность',
  'product.price_label': 'Продукт → цена',
  'product.installment': 'Продукт → рассрочка',
  'product.guarantee': 'Продукт → гарантия',
  'seller.payment_url': 'Ссылка на оплату',
  'seller.access_url': 'Ссылка на доступ после оплаты',
  'profile.headline': 'Профиль → чем занимаюсь',
  'profile.bio': 'Профиль → о себе',
  'profile.regalia': 'Профиль → регалии',
  'profile.results': 'Профиль → результаты',
  brain: 'Материалы SI-мозга (SI найдёт сам)'
};

const RELEASE_MODES = ['required', 'all', 'count'];

const text = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\r/g, '').trim().slice(0, max);
const idOf = (v, prefix, i) => {
  const id = String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return id || `${prefix}${i + 1}`;
};

/** The author's puzzle as it may be stored: known fields only, limits kept, ids unique. */
function normalizePuzzle(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const seenPieces = new Set();
  const seenQuestions = new Set();
  const pieces = [];
  for (const [i, p] of (Array.isArray(src.pieces) ? src.pieces : []).entries()) {
    if (pieces.length >= MAX_PIECES || !p || typeof p !== 'object') continue;
    const title = text(p.title, 40);
    if (!title) continue;
    let id = idOf(p.id, 'pc', i);
    while (seenPieces.has(id)) id = `${id}x`;
    seenPieces.add(id);
    const questions = [];
    for (const [j, q] of (Array.isArray(p.questions) ? p.questions : []).entries()) {
      if (questions.length >= MAX_QUESTIONS || !q || typeof q !== 'object') continue;
      const qText = text(q.text, 200);
      if (!qText) continue;
      let qid = idOf(q.id, `${id}q`, j);
      while (seenQuestions.has(qid)) qid = `${qid}x`;
      seenQuestions.add(qid);
      questions.push({ id: qid, text: qText, hint: text(q.hint, 200), source: SOURCES[q.source] ? q.source : '' });
    }
    if (!questions.length) continue; // a piece is filled by answering its questions
    pieces.push({ id, title, required: p.required !== false, questions });
  }
  const r = src.release && typeof src.release === 'object' ? src.release : {};
  const mode = RELEASE_MODES.includes(r.mode) ? r.mode : 'required';
  const count = Math.max(1, Math.min(pieces.length || 1, parseInt(r.count, 10) || pieces.length || 1));
  return { pieces, release: mode === 'count' ? { mode, count } : { mode } };
}

/** The funnel's puzzle on this seller (frozen in funnel_settings), or null when the funnel has none. */
function funnelPuzzleOf(project) {
  if (!project || !project.funnel_settings) return null;
  let s = project.funnel_settings;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch (e) { s = {}; } }
  const pz = normalizePuzzle(s && s.puzzle);
  return pz.pieces.length ? pz : null;
}

/** A piece is on its place when every question of it has an answer. */
function pieceDone(piece, answers) {
  return piece.questions.every(q => text(answers[q.id], 4000));
}

/** Is the author's condition to start selling met? */
function releaseMet(pz, answers) {
  const done = pz.pieces.filter(p => pieceDone(p, answers));
  if (pz.release.mode === 'all') return done.length === pz.pieces.length;
  if (pz.release.mode === 'count') return done.length >= pz.release.count;
  return pz.pieces.filter(p => p.required).every(p => pieceDone(p, answers));
}

/** What the author's condition says, in words (for the expert and the author). */
function releaseText(pz) {
  if (pz.release.mode === 'all') return 'когда собраны все кусочки';
  if (pz.release.mode === 'count') return `когда собрано кусочков: ${pz.release.count} из ${pz.pieces.length}`;
  return 'когда собраны все обязательные кусочки';
}

module.exports = { MAX_PIECES, MAX_QUESTIONS, SOURCES, RELEASE_MODES, normalizePuzzle, funnelPuzzleOf, pieceDone, releaseMet, releaseText };
