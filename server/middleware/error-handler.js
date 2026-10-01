// server/middleware/error-handler.js - Safe Centralized Error Handler
const config = require('../config');

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const isProd = config.isProd;

  // Log error on server without leaking sensitive request headers / tokens
  console.error(`[SmartFlow Error] ${req.method} ${req.originalUrl}:`, {
    message: err.message,
    status,
    stack: isProd ? undefined : err.stack
  });

  res.status(status).json({
    error: err.name || 'InternalServerError',
    message: isProd && status === 500 ? 'Внутренняя ошибка сервера. Повторите попытку позже.' : err.message,
    code: err.code || 'SERVER_ERROR'
  });
}

module.exports = errorHandler;
