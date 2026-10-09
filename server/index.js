// server/index.js - SmartFlow Core Backend Entrypoint
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const config = require('./config');
const db = require('./db');
const migrator = require('./db/migrator');
const errorHandler = require('./middleware/error-handler');
const { renderIndexHtml } = require('./asset-version');

// Route modules
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const clientRoutes = require('./routes/clients');
const conversationRoutes = require('./routes/conversations');
const templateRoutes = require('./routes/templates');
const subscriptionRoutes = require('./routes/subscriptions');
const publicRoutes = require('./routes/public');
const meRoutes = require('./routes/me');
const mediaRoutes = require('./routes/media');
const chatRoutes = require('./routes/chat');
const marketplaceRoutes = require('./routes/marketplace');
const feedbackRoutes = require('./routes/feedback');
const brainRoutes = require('./routes/brain');
const siEngine = require('./services/si-engine');

const app = express();

// Global Middleware
app.use(compression());
app.use(cors({
  // CORS_ORIGINS: comma-separated frontend origins allowed to call the API, e.g.
  // https://smartflow.pages.dev. Unset → any origin (auth uses Bearer tokens, not cookies).
  origin: config.corsOrigins.length ? config.corsOrigins : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400 // let browsers cache the preflight for a day
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Healthcheck & System Status Endpoint
app.get('/api/health', async (req, res) => {
  try {
    const { activeDriver } = db.getDatabase();
    const migrations = await migrator.getAppliedMigrations();
    res.json({
      status: 'ok',
      service: 'SmartFlow Core Backend',
      version: '1.0.0-stage1',
      // Which commit is running (Railway sets this): shows whether the latest merge reached the server
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      environment: config.nodeEnv,
      database: {
        driver: activeDriver,
        appliedMigrationsCount: migrations.length
      },
      telegramBot: {
        configured: Boolean(config.telegramBotToken),
        botUsername: config.telegramBotUsername
      },
      // true = the server sees the OpenAI key (the key itself is never shown)
      openai: {
        configured: siEngine.isConfigured(),
        model: config.openaiModel
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// API Routes Mounting
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects/:projectId/clients', clientRoutes);
app.use('/api/projects/:projectId/conversations', conversationRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/me', meRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/brain', brainRoutes);

// Serve ONLY the public frontend assets. The repository root also holds server code,
// package.json, migrations and scripts — none of it may be reachable over HTTP.
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIRS = ['css', 'js', 'images'];
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// index.html references css/js with ?v=<content hash> (see asset-version.js), so those
// requests can be cached for a year; un-versioned requests are revalidated every time.
const staticOptions = {
  dotfiles: 'deny',
  index: false,
  fallthrough: false,
  setHeaders(res) {
    const req = res.req;
    if (req && req.query && req.query.v) {
      res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
};

for (const dir of PUBLIC_DIRS) {
  app.use(`/${dir}`, express.static(path.join(ROOT_DIR, dir), staticOptions));
}

// In production the stamped index.html is built once; in development it is rebuilt on
// every request so edits to css/js show up without a restart.
const prodIndexHtml = config.isProd ? renderIndexHtml() : null;
function sendIndexHtml(res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(prodIndexHtml || renderIndexHtml());
}

// Fallback to index.html for single-page app routing.
// Paths that look like files (have an extension) or dotfiles get 404 instead of the SPA
// shell, so probes like /package.json, /.env or /server/config.js never reveal anything.
app.get('*splat', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: 'API маршрут не найден' });
  }
  if (req.path === '/index.html') {
    return sendIndexHtml(res);
  }
  if (path.extname(req.path) || req.path.split('/').some(seg => seg.startsWith('.'))) {
    return res.status(404).type('text/plain').send('Not found');
  }
  sendIndexHtml(res);
});

// Error handling middleware
app.use(errorHandler);

async function startServer(port = config.port) {
  // Ensure database is initialized and latest migrations are applied
  console.log('[SmartFlow] Initializing database...');
  db.getDatabase();
  await migrator.runMigrations({ silent: false });

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[SmartFlow] Backend successfully running on http://localhost:${port}`);
      resolve(server);
    });
  });
}

// Auto-start when executed directly
if (require.main === module) {
  startServer().catch(err => {
    console.error('[SmartFlow] Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer };
