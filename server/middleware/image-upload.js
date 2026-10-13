// server/middleware/image-upload.js - Reads an uploaded image sent as the raw request body.
const express = require('express');
const { MAX_IMAGE_BYTES } = require('../services/media-service');

// Any Content-Type is read; media-service decides by the file's own bytes what it is.
const rawBody = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

function readImageBody(req, res, next) {
  rawBody(req, res, (err) => {
    if (!err) return next();
    const tooLarge = err.status === 413;
    res.status(tooLarge ? 413 : 400).json({
      error: 'bad_request',
      code: tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE',
      message: tooLarge ? 'Фото слишком большое (больше 2 МБ).' : 'Не удалось прочитать файл. Выберите фото ещё раз.'
    });
  });
}

// Payment receipts: photo or PDF up to 5 MB (receipt-service decides by the bytes what it is)
const rawReceipt = express.raw({ type: () => true, limit: 5 * 1024 * 1024 });
function readReceiptBody(req, res, next) {
  rawReceipt(req, res, (err) => {
    if (!err) return next();
    const tooLarge = err.status === 413;
    res.status(tooLarge ? 413 : 400).json({
      error: 'bad_request',
      code: tooLarge ? 'RECEIPT_TOO_LARGE' : 'INVALID_RECEIPT',
      message: tooLarge ? 'Файл больше 5 МБ. Сделайте снимок экрана с чеком.' : 'Не удалось прочитать файл. Выберите чек ещё раз.'
    });
  });
}

// Voice messages: up to 1.5 minutes, 3 MB is plenty (voice-service decides by the bytes what it is)
const rawVoice = express.raw({ type: () => true, limit: 3 * 1024 * 1024 });
function readVoiceBody(req, res, next) {
  rawVoice(req, res, (err) => {
    if (!err) return next();
    const tooLarge = err.status === 413;
    res.status(tooLarge ? 413 : 400).json({
      error: 'bad_request',
      code: tooLarge ? 'VOICE_TOO_LARGE' : 'INVALID_VOICE',
      message: tooLarge ? 'Голосовое слишком длинное — до 1,5 минуты.' : 'Не получилось прочитать запись. Попробуйте ещё раз.'
    });
  });
}

module.exports = { readImageBody, readReceiptBody, readVoiceBody };
