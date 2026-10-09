// server/services/media-service.js - Uploaded photos (user and SI-consultant avatars).
//
// Images are kept in the `media` table for now. To move them to object storage later
// (Supabase Storage, Cloudflare R2), change saveImage/getImage only: the rest of the app
// works with media ids and the /api/media/:id URL.
const crypto = require('crypto');
const db = require('../db');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_KINDS = ['user_photo', 'consultant_photo'];

// Accept only real JPEG / PNG / WebP files, recognized by their first bytes
// (never trust the Content-Type the browser sent, and never accept SVG).
function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function mediaUrl(mediaId) {
  return mediaId ? `/api/media/${mediaId}` : null;
}

class MediaError extends Error {
  constructor(message, status = 400, code = 'INVALID_IMAGE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function saveImage(ownerId, buffer, kind) {
  if (!ALLOWED_KINDS.includes(kind)) {
    throw new MediaError('Неизвестный тип файла', 400, 'INVALID_KIND');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new MediaError('Файл не получен. Выберите фото ещё раз.', 400, 'EMPTY_FILE');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new MediaError('Фото слишком большое (больше 2 МБ).', 413, 'IMAGE_TOO_LARGE');
  }
  const mimeType = detectImageType(buffer);
  if (!mimeType) {
    throw new MediaError('Можно загрузить только фото в формате JPEG, PNG или WebP.', 400, 'INVALID_IMAGE');
  }

  const id = `med_${crypto.randomUUID().replace(/-/g, '')}`;
  await db.run(
    `INSERT INTO media (id, owner_id, kind, mime_type, size_bytes, data_base64)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, ownerId, kind, mimeType, buffer.length, buffer.toString('base64')]
  );
  return { id, url: mediaUrl(id), mimeType, sizeBytes: buffer.length };
}

async function getImage(mediaId) {
  if (!/^med_[a-f0-9]{32}$/.test(mediaId || '')) return null;
  const row = await db.get('SELECT mime_type, data_base64 FROM media WHERE id = ?', [mediaId]);
  if (!row) return null;
  return { mimeType: row.mime_type, buffer: Buffer.from(row.data_base64, 'base64') };
}

// Removes an image that is no longer referenced (after it was replaced by a new one).
async function deleteImage(mediaId) {
  if (!mediaId) return;
  await db.run('DELETE FROM media WHERE id = ?', [mediaId]);
}

module.exports = {
  MAX_IMAGE_BYTES,
  detectImageType,
  mediaUrl,
  saveImage,
  getImage,
  deleteImage,
  MediaError
};
