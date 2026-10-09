// server/middleware/error-handler.js - Safe Centralized Error Handler
//
// Every error gets a short code (K7P2). The person sees "код K7P2" on screen; the same code
// with the person's number (SF-48213) goes to the Railway log and to error_log, so the support
// panel finds it by code. No request body, tokens or personal data are logged.
const config = require('../config');
const supportService = require('../services/support-service');

async function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const isProd = config.isProd;
  const code = supportService.newErrorCode();

  await supportService.logError({
    code,
    source: 'server',
    userId: req.user ? req.user.userId : null,
    method: req.method,
    path: req.originalUrl.split('?')[0],
    status,
    message: err.message,
    context: isProd || !err.stack ? null : { stack: err.stack.split('\n').slice(0, 6).join('\n') }
  });

  if (res.headersSent) return next(err);
  res.status(status).json({
    error: err.name || 'InternalServerError',
    message: isProd && status >= 500 ? 'Внутренняя ошибка сервера. Повторите попытку позже.' : err.message,
    code: err.code || 'SERVER_ERROR',
    errorCode: code
  });
}

module.exports = errorHandler;
