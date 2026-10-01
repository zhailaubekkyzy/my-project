// scripts/backup.js - Database Backup Tool
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../server/db');

async function backupDatabase(targetPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const destination = targetPath || path.join(backupDir, `smartflow-backup-${timestamp}.json`);

  const tables = [
    'schema_migrations',
    'users',
    'auth_identities',
    'platform_subscriptions',
    'funnel_templates',
    'funnel_subscriptions',
    'projects',
    'project_members',
    'clients',
    'conversations',
    'direct_inquiries'
  ];

  const dump = {
    metadata: {
      createdAt: new Date().toISOString(),
      version: '1.0.0-stage1',
      appName: 'SmartFlow',
      tables: {}
    },
    data: {}
  };

  for (const table of tables) {
    try {
      const rows = await db.all(`SELECT * FROM ${table}`);
      dump.data[table] = rows;
      dump.metadata.tables[table] = rows.length;
    } catch (err) {
      console.warn(`[SmartFlow Backup] Warning: Could not read table ${table}: ${err.message}`);
    }
  }

  fs.writeFileSync(destination, JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`[SmartFlow Backup] Database successfully backed up to: ${destination}`);
  console.log('[SmartFlow Backup] Table summary:', dump.metadata.tables);

  return { destination, summary: dump.metadata.tables };
}

if (require.main === module) {
  backupDatabase().then(() => {
    db.closeDatabase();
    process.exit(0);
  }).catch(err => {
    console.error('[SmartFlow Backup] Error:', err);
    process.exit(1);
  });
}

module.exports = { backupDatabase };
