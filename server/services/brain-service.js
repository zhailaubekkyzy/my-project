// server/services/brain-service.js - SI-brain: the expert's materials and search in them.
//
// Only the text is kept: a file (PDF, Word .docx, .txt/.md) is read once, its text is cut into
// pieces and the file itself is thrown away. Each piece gets an OpenAI embedding (its meaning as
// numbers) so the SI can find the pieces that answer the client's question. Without OpenAI
// (no key, no balance) the search falls back to matching words, so materials still work.
//
// Search runs in Node over the consultant's pieces (a few thousand at most, see the limits),
// which works the same on SQLite and PostgreSQL. With far more material, move it to pgvector.
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MATERIAL_CHARS = 400000;
const MAX_TOTAL_CHARS = 2000000;
const MAX_MATERIALS = 50;

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
// A consultant with this little text gets all of it, no search needed
const SMALL_BRAIN_CHARS = 6000;
const CONTEXT_PIECES = 5;
const INSERT_BATCH = 50;

const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;
const EMBEDDING_BATCH = 96;
// Pieces saved while OpenAI was unavailable are processed later, a few at a time
const BACKFILL_LIMIT = 192;

class BrainError extends Error {
  constructor(message, status = 400, code = 'BAD_MATERIAL') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

// ---------------- Reading files ----------------

function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function titleFromName(name) {
  const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '');
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Материал';
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Text pieces of a PDF page come in drawing order, which is not always reading order
// (punctuation in another font may come first). Put them back by position: lines from top
// to bottom, pieces in a line from left to right, a space where there is a gap.
function pageText(items) {
  const parts = items
    .filter(i => i.str && i.str.trim())
    .map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || i.height || 10 }));
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const p of parts) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - p.y) <= Math.max(2, p.h * 0.4)) line.parts.push(p);
    else lines.push({ y: p.y, parts: [p] });
  }
  return lines.map(line => {
    line.parts.sort((a, b) => a.x - b.x);
    let out = '';
    let end = null;
    for (const p of line.parts) {
      if (end !== null && p.x - end > p.h * 0.15 && !/\s$/.test(out) && !/^\s/.test(p.str)) out += ' ';
      out += p.str;
      end = p.x + p.w;
    }
    return out;
  }).join('\n');
}

async function readPdf(buffer) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    pages.push(pageText((await page.getTextContent()).items));
  }
  return pages.join('\n\n');
}

async function readDocx(buffer) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

/**
 * The file's text, recognized by its own bytes (never by what the browser claims).
 * Returns { text, sourceType: 'pdf' | 'docx' | 'txt' }.
 */
async function extractText(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BrainError('Файл не получен. Выберите его ещё раз.', 400, 'EMPTY_FILE');
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new BrainError('Файл больше 10 МБ. Разделите его на части.', 413, 'FILE_TOO_LARGE');
  }
  const ext = extensionOf(filename);
  const head = buffer.slice(0, 5).toString('latin1');
  let raw;
  let sourceType;
  try {
    if (head.startsWith('%PDF')) {
      sourceType = 'pdf';
      raw = await readPdf(buffer);
    } else if (head.startsWith('PK\u0003\u0004')) {
      if (ext !== 'docx') throw new BrainError('Можно загрузить PDF, Word (.docx) или текст (.txt).', 400, 'UNSUPPORTED');
      sourceType = 'docx';
      raw = await readDocx(buffer);
    } else if (ext === 'doc' || buffer.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
      throw new BrainError('Старый формат Word (.doc) не читается. Сохраните файл как .docx или PDF.', 400, 'UNSUPPORTED');
    } else {
      sourceType = 'txt';
      try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch (e) {
        throw new BrainError('Можно загрузить PDF, Word (.docx) или текст (.txt).', 400, 'UNSUPPORTED');
      }
      if (raw.includes('\u0000')) throw new BrainError('Можно загрузить PDF, Word (.docx) или текст (.txt).', 400, 'UNSUPPORTED');
    }
  } catch (err) {
    if (err instanceof BrainError) throw err;
    console.warn(`[SmartFlow brain] cannot read ${sourceType || 'file'}:`, err.message);
    throw new BrainError('Не получилось прочитать файл. Возможно, он повреждён или защищён паролем.', 400, 'UNREADABLE');
  }

  const text = normalizeText(raw);
  if (text.replace(/\s/g, '').length < 20) {
    throw new BrainError(
      sourceType === 'pdf'
        ? 'В PDF не нашлось текста — похоже, это скан или картинки. Загрузите файл с текстом.'
        : 'В файле почти нет текста.',
      400, 'NO_TEXT');
  }
  if (text.length > MAX_MATERIAL_CHARS) {
    throw new BrainError(`В файле больше ${MAX_MATERIAL_CHARS.toLocaleString('ru-RU')} знаков. Разделите его на части.`, 413, 'TEXT_TOO_LONG');
  }
  return { text, sourceType };
}

/**
 * Pieces of ~CHUNK_SIZE characters, cut at paragraph or sentence ends where possible,
 * with a small overlap so a thought split between two pieces is not lost.
 */
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const tail = text.slice(start + Math.floor(size / 2), end);
      const cut = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf('. '), tail.lastIndexOf('! '), tail.lastIndexOf('? '));
      if (cut > 0) end = start + Math.floor(size / 2) + cut + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

// ---------------- Embeddings ----------------

function encodeVector(values) {
  return Buffer.from(new Float32Array(values).buffer).toString('base64');
}

function decodeVector(base64) {
  const buf = Buffer.from(base64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

// OpenAI embeddings come normalized to length 1, so the dot product is the cosine similarity
function similarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Embeddings for the texts (same order), or null when OpenAI is unavailable.
 */
async function embed(texts) {
  if (!config.openaiApiKey || !texts.length) return null;
  const vectors = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH);
    try {
      const res = await fetch(EMBEDDINGS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiApiKey}` },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch, dimensions: EMBEDDING_DIMENSIONS }),
        signal: AbortSignal.timeout(30000)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.data) || data.data.length !== batch.length) {
        console.warn(`[SmartFlow brain] OpenAI embeddings ${res.status}: ${data?.error?.message || 'unexpected reply'}`);
        return null;
      }
      for (const item of [...data.data].sort((a, b) => a.index - b.index)) vectors.push(item.embedding);
    } catch (err) {
      console.warn('[SmartFlow brain] OpenAI embeddings failed:', err.message);
      return null;
    }
  }
  return vectors;
}

// ---------------- Materials ----------------

function toMaterial(row, consultantIds = []) {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    charCount: Number(row.char_count) || 0,
    chunkCount: Number(row.chunk_count) || 0,
    createdAt: row.created_at,
    preview: row.preview ? String(row.preview).slice(0, 300) : '',
    consultantIds
  };
}

async function ownedProjectIds(ownerId, projectIds) {
  const wanted = [...new Set((Array.isArray(projectIds) ? projectIds : []).map(String))];
  if (!wanted.length) return [];
  const rows = await db.all('SELECT id FROM projects WHERE owner_id = ?', [ownerId]);
  const owned = new Set(rows.map(r => r.id));
  const foreign = wanted.filter(id => !owned.has(id));
  if (foreign.length) throw new BrainError('Можно выбрать только своих SI-консультантов.', 403, 'FOREIGN_CONSULTANT');
  return wanted;
}

async function listMaterials(ownerId) {
  const rows = await db.all(
    `SELECT m.*, (SELECT c.text FROM brain_chunks c WHERE c.material_id = m.id AND c.position = 0) AS preview
     FROM brain_materials m WHERE m.owner_id = ? ORDER BY m.created_at DESC, m.id DESC`,
    [ownerId]
  );
  const links = await db.all(
    `SELECT cm.material_id, cm.project_id FROM consultant_materials cm
     JOIN brain_materials m ON m.id = cm.material_id WHERE m.owner_id = ?`,
    [ownerId]
  );
  const byMaterial = {};
  for (const l of links) (byMaterial[l.material_id] = byMaterial[l.material_id] || []).push(l.project_id);
  return rows.map(r => toMaterial(r, byMaterial[r.id] || []));
}

async function getMaterial(ownerId, materialId) {
  return (await listMaterials(ownerId)).find(m => m.id === materialId) || null;
}

/**
 * Saves a file's text as a new material. consultantIds: my consultants that may use it right away.
 */
async function addMaterial(ownerId, { buffer, filename, title, consultantIds = [] }) {
  const projectIds = await ownedProjectIds(ownerId, consultantIds);
  const usage = await db.get(
    'SELECT COUNT(*) AS count, COALESCE(SUM(char_count), 0) AS chars FROM brain_materials WHERE owner_id = ?',
    [ownerId]
  );
  if ((usage.count || 0) >= MAX_MATERIALS) {
    throw new BrainError(`В SI-мозге уже ${MAX_MATERIALS} материалов. Удалите ненужные, чтобы добавить новый.`, 409, 'TOO_MANY');
  }

  const { text, sourceType } = await extractText(buffer, filename);
  if ((usage.chars || 0) + text.length > MAX_TOTAL_CHARS) {
    throw new BrainError('SI-мозг заполнен. Удалите ненужные материалы, чтобы добавить новый.', 409, 'BRAIN_FULL');
  }

  const chunks = chunkText(text);
  const vectors = await embed(chunks);
  const materialId = newId('mat');
  await db.run(
    `INSERT INTO brain_materials (id, owner_id, title, source_type, char_count, chunk_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [materialId, ownerId, String(title || '').trim().slice(0, 120) || titleFromName(filename), sourceType, text.length, chunks.length]
  );
  // Several pieces per INSERT: hundreds of single inserts are slow over the Supabase pooler
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const rows = chunks.slice(i, i + INSERT_BATCH).map((text, j) =>
      [newId('chk'), materialId, i + j, text, vectors ? encodeVector(vectors[i + j]) : null]);
    await db.run(
      `INSERT INTO brain_chunks (id, material_id, position, text, embedding) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
      rows.flat()
    );
  }
  for (const projectId of projectIds) {
    await db.run('INSERT INTO consultant_materials (project_id, material_id) VALUES (?, ?)', [projectId, materialId]);
  }
  return getMaterial(ownerId, materialId);
}

async function setConsultants(ownerId, materialId, consultantIds) {
  const material = await db.get('SELECT id FROM brain_materials WHERE id = ? AND owner_id = ?', [materialId, ownerId]);
  if (!material) return null;
  const projectIds = await ownedProjectIds(ownerId, consultantIds);
  await db.run('DELETE FROM consultant_materials WHERE material_id = ?', [materialId]);
  for (const projectId of projectIds) {
    await db.run('INSERT INTO consultant_materials (project_id, material_id) VALUES (?, ?)', [projectId, materialId]);
  }
  return getMaterial(ownerId, materialId);
}

async function deleteMaterial(ownerId, materialId) {
  const res = await db.run('DELETE FROM brain_materials WHERE id = ? AND owner_id = ?', [materialId, ownerId]);
  return res.changes > 0;
}

// ---------------- Search for the SI ----------------

// Word roots: lowercase words of 3+ letters cut to 5 letters, so "курса", "курсы", "курсом" match
function stems(text) {
  const words = String(text || '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]{3,}/gu) || [];
  return new Set(words.map(w => w.slice(0, 5)));
}

function keywordRank(pieces, query) {
  const wanted = stems(query);
  if (!wanted.size) return [];
  return pieces
    .map(p => {
      const have = stems(p.text);
      let score = 0;
      for (const s of wanted) if (have.has(s)) score++;
      return { piece: p, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.piece);
}

// Pieces stored without an embedding (OpenAI was unavailable then): try again now, a few at a time
async function backfillEmbeddings(pieces) {
  const missing = pieces.filter(p => !p.embedding).slice(0, BACKFILL_LIMIT);
  if (!missing.length || !config.openaiApiKey) return;
  const vectors = await embed(missing.map(p => p.text));
  if (!vectors) return;
  for (let i = 0; i < missing.length; i++) {
    missing[i].embedding = encodeVector(vectors[i]);
    await db.run('UPDATE brain_chunks SET embedding = ? WHERE id = ?', [missing[i].embedding, missing[i].id]);
  }
}

// Support panel: pieces of one expert's materials still without an embedding
async function piecesWithoutMeaning(ownerId) {
  return db.all(
    `SELECT c.id, c.text, c.embedding FROM brain_chunks c
     JOIN brain_materials m ON m.id = c.material_id
     WHERE m.owner_id = ? AND c.embedding IS NULL`,
    [ownerId]
  );
}

// Support panel: process them now. Returns how many pieces got their embedding.
async function processPendingPieces(ownerId) {
  const pieces = await piecesWithoutMeaning(ownerId);
  await backfillEmbeddings(pieces);
  return pieces.filter(p => p.embedding).length;
}

/**
 * Pieces of the consultant's materials that help answer `query`: [{ title, text }].
 * Never throws: a failure here must not break the chat.
 */
async function contextFor(projectId, query, limit = CONTEXT_PIECES) {
  try {
    const pieces = await db.all(
      `SELECT c.id, c.text, c.embedding, c.position, m.title, m.id AS material_id
       FROM consultant_materials cm
       JOIN brain_materials m ON m.id = cm.material_id
       JOIN brain_chunks c ON c.material_id = m.id
       WHERE cm.project_id = ?
       ORDER BY m.created_at ASC, m.id ASC, c.position ASC`,
      [projectId]
    );
    if (!pieces.length) return [];
    const pick = (list) => list.map(p => ({ title: p.title, text: p.text }));

    const totalChars = pieces.reduce((sum, p) => sum + p.text.length, 0);
    if (totalChars <= SMALL_BRAIN_CHARS) return pick(pieces);

    await backfillEmbeddings(pieces);
    const withVectors = pieces.filter(p => p.embedding);
    const queryVector = withVectors.length ? await embed([String(query).slice(0, 2000)]) : null;
    if (queryVector) {
      const q = queryVector[0];
      const ranked = withVectors
        .map(p => ({ p, score: similarity(q, decodeVector(p.embedding)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(x => x.p);
      return pick(ranked);
    }
    return pick(keywordRank(pieces, query).slice(0, limit));
  } catch (err) {
    console.warn('[SmartFlow brain] search failed:', err.message);
    return [];
  }
}

module.exports = {
  MAX_FILE_BYTES,
  BrainError,
  extractText,
  chunkText,
  listMaterials,
  getMaterial,
  addMaterial,
  setConsultants,
  deleteMaterial,
  contextFor,
  BACKFILL_LIMIT,
  piecesWithoutMeaning,
  processPendingPieces
};
