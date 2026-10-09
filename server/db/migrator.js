// server/db/migrator.js - Versioned Database Migration Engine
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function ensureMigrationTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getAppliedMigrations() {
  await ensureMigrationTable();
  const rows = await db.all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC');
  return rows.map(r => r.version);
}

// Blocks between "-- postgres-only:begin" and "-- postgres-only:end" run on PostgreSQL only
// (e.g. Row Level Security for Supabase); SQLite does not support those statements.
function sqlForDriver(sql, driver) {
  if (driver === 'postgres') return sql;
  return sql.replace(/--\s*postgres-only:begin[\s\S]*?--\s*postgres-only:end/g, '');
}

async function runMigrations(options = { silent: false }) {
  await ensureMigrationTable();
  const appliedVersions = await getAppliedMigrations();
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    if (!options.silent) console.log('No migrations directory found.');
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const newlyApplied = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const name = match[2];

    if (!appliedVersions.includes(version)) {
      if (!options.silent) console.log(`[SmartFlow Migrator] Applying migration ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      
      // Execute the migration SQL
      await db.exec(sqlForDriver(sql, db.getDatabase().activeDriver));
      await db.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [version, name]);
      
      newlyApplied.push({ version, name, file });
      if (!options.silent) console.log(`[SmartFlow Migrator] Successfully applied ${file}`);
    }
  }

  if (!options.silent && newlyApplied.length === 0) {
    console.log('[SmartFlow Migrator] Database schema is up to date.');
  }

  return newlyApplied;
}

module.exports = {
  runMigrations,
  sqlForDriver,
  getAppliedMigrations
};
