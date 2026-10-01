// scripts/restore.js - Database Restore Tool
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../server/db');
const migrator = require('../server/db/migrator');

async function restoreDatabase(backupFilePath) {
  if (!backupFilePath || !fs.existsSync(backupFilePath)) {
    throw new Error(`Резервная копия не найдена по пути: ${backupFilePath}`);
  }

  const raw = fs.readFileSync(backupFilePath, 'utf-8');
  const dump = JSON.parse(raw);

  console.log(`[SmartFlow Restore] Restoring database from backup created at ${dump.metadata.createdAt}...`);

  // Ensure migrations are run first so schema exists
  await migrator.runMigrations({ silent: true });

  const tables = Object.keys(dump.data);

  for (const table of tables) {
    const rows = dump.data[table];
    if (!rows || rows.length === 0) continue;

    for (const row of rows) {
      const keys = Object.keys(row);
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => row[k]);

      const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
      await db.run(sql, values);
    }
    console.log(`[SmartFlow Restore] Restored ${rows.length} rows to ${table}`);
  }

  console.log('[SmartFlow Restore] Database restoration complete.');
  return true;
}

if (require.main === module) {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/restore.js <path-to-backup.json>');
    process.exit(1);
  }
  restoreDatabase(fileArg).then(() => {
    db.closeDatabase();
    process.exit(0);
  }).catch(err => {
    console.error('[SmartFlow Restore] Error:', err);
    process.exit(1);
  });
}

module.exports = { restoreDatabase };
