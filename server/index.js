// server/index.js - SmartFlow Core Backend Entrypoint
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');
const migrator = require('./db/migrator');
const errorHandler = require('./middleware/error-handler');

// Route modules
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const clientRoutes = require('./routes/clients');
const conversationRoutes = require('./routes/conversations');
const templateRoutes = require('./routes/templates');
const subscriptionRoutes = require('./routes/subscriptions');
const publicRoutes = require('./routes/public');

const app = express();

// Global Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
      environment: config.nodeEnv,
      database: {
        driver: activeDriver,
        appliedMigrationsCount: migrations.length
      },
      telegramBot: {
        configured: Boolean(config.telegramBotToken),
        botUsername: 'smartflow_ai_support_bot'
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

// Serve static frontend assets (CSS, JS, images, index.html)
app.use(express.static(path.join(__dirname, '../')));

// Fallback to index.html for single-page app routing
app.get('*splat', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: 'API маршрут не найден' });
  }
  res.sendFile(path.join(__dirname, '../index.html'));
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
