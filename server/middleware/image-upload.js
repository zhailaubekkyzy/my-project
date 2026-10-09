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

module.exports = { readImageBody };
