// server/services/voice-service.js - Voice messages from clients in the chat with an SI-seller.
//
// Owner's decisions: up to 1.5 minutes; the limit is shown gently (a small timer), not stressed.
// The phone records (iPhone/iPad in Telegram: audio/webm; codecs=opus — checked 13 Oct.), the server
// keeps the recording (private: the client and the people of the business only) and asks OpenAI for
// the transcript. The SI answers the transcript like any text message: objections and the expert's
// scenarios work the same.
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

const MAX_SECONDS = 90;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_PER_CLIENT_PER_DAY = 20;
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

class VoiceError extends Error {
  constructor(message, status = 400, code = 'INVALID_VOICE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Real audio only, by the file's own first bytes (never by what the browser says)
function detectAudioType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm' };
  if (buf.slice(0, 4).toString('ascii') === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' };
  return null;
}

/**
 * OpenAI transcript of the recording, or null (no key / failure). Never throws.
 */
async function transcribe(buffer, type) {
  if (!config.openaiApiKey) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: type.mime }), `voice.${type.ext}`);
    form.append('model', config.transcribeModel);
    const res = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000)
    });
    const data = await res.json().catch(() => ({}));
    const text = typeof data.text === 'string' ? data.text.replace(/\s+/g, ' ').trim() : '';
    if (!res.ok || !text) {
      console.warn(`[SmartFlow Voice] transcription ${res.status}: ${data?.error?.message || 'empty'}`);
      return null;
    }
    return text.slice(0, 4000);
  } catch (err) {
    console.warn('[SmartFlow Voice] transcription failed:', err.message);
    return null;
  }
}

/**
 * Checks and keeps a recording. Returns { id, seconds, transcript }.
 */
async function saveVoice(project, client, buffer, seconds, userId) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new VoiceError('Запись не получена. Попробуйте ещё раз.', 400, 'EMPTY_VOICE');
  if (buffer.length > MAX_BYTES) throw new VoiceError('Голосовое слишком длинное — до 1,5 минуты.', 413, 'VOICE_TOO_LARGE');
  const type = detectAudioType(buffer);
  if (!type) throw new VoiceError('Не получилось прочитать запись. Попробуйте ещё раз.', 400, 'INVALID_VOICE');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const today = await db.get('SELECT COUNT(*) AS count FROM voice_messages WHERE client_id = ? AND created_at >= ?', [client.id, since]);
  if (Number(today.count) >= MAX_PER_CLIENT_PER_DAY) {
    throw new VoiceError('На сегодня голосовых достаточно — напишите, пожалуйста, текстом.', 429, 'TOO_MANY_VOICES');
  }
  const duration = Math.max(1, Math.min(MAX_SECONDS, parseInt(seconds, 10) || 1));
  const transcript = await transcribe(buffer, type);
  const id = `voi_${crypto.randomUUID().replace(/-/g, '')}`;
  await db.run(
    `INSERT INTO voice_messages (id, business_id, project_id, client_id, user_id, mime_type, size_bytes, duration_seconds, data_base64, transcript)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, client.business_id || null, project.id, client.id, userId || null, type.mime, buffer.length, duration, buffer.toString('base64'), transcript]
  );
  return { id, seconds: duration, transcript };
}

async function voiceFile(clientId, voiceId) {
  const row = await db.get('SELECT mime_type, data_base64 FROM voice_messages WHERE id = ? AND client_id = ?', [voiceId, clientId]);
  return row ? { mimeType: row.mime_type, buffer: Buffer.from(row.data_base64, 'base64') } : null;
}

module.exports = { MAX_SECONDS, MAX_BYTES, VoiceError, detectAudioType, transcribe, saveVoice, voiceFile };
