// server/db/index.js - Unified Database Connection Layer (SQLite & PostgreSQL)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

let sqliteDb = null;
let pgPool = null;
let activeDriver = 'sqlite';

function initDatabase(customOptions = {}) {
  const driver = customOptions.driver || process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
  activeDriver = driver;

  if (driver === 'postgres') {
    const connectionString = customOptions.connectionString || process.env.DATABASE_URL;
    pgPool = new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    });
    return { driver: 'postgres', pool: pgPool };
  }

  // SQLite configuration
  const dbPath = customOptions.dbFile || process.env.DB_FILE || path.join(__dirname, '../../data/smartflow.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  return { driver: 'sqlite', db: sqliteDb };
}

function getDatabase() {
  if (!sqliteDb && !pgPool) {
    initDatabase();
  }
  return { activeDriver, sqliteDb, pgPool };
}

// Convert parameterized query placeholders if necessary
// SQLite uses ?, PostgreSQL uses $1, $2, etc.
function adaptSql(sql, targetDriver) {
  if (targetDriver === 'postgres') {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }
  return sql;
}

async function query(sql, params = []) {
  const { activeDriver: driver, sqliteDb: sDb, pgPool: pool } = getDatabase();

  if (driver === 'postgres') {
    const adaptedSql = adaptSql(sql, 'postgres');
    const res = await pool.query(adaptedSql, params);
    return res.rows;
  }

  const stmt = sDb.prepare(sql);
  if (/^\s*(SELECT|PRAGMA)/i.test(sql)) {
    return stmt.all(...params);
  }
  const info = stmt.run(...params);
  return {
    changes: info.changes,
    lastInsertRowid: info.lastInsertRowid
  };
}

async function get(sql, params = []) {
  const { activeDriver: driver, sqliteDb: sDb, pgPool: pool } = getDatabase();

  if (driver === 'postgres') {
    const adaptedSql = adaptSql(sql, 'postgres');
    const res = await pool.query(adaptedSql, params);
    return res.rows[0] || null;
  }

  const stmt = sDb.prepare(sql);
  const row = stmt.get(...params);
  return row || null;
}

async function all(sql, params = []) {
  const { activeDriver: driver, sqliteDb: sDb, pgPool: pool } = getDatabase();

  if (driver === 'postgres') {
    const adaptedSql = adaptSql(sql, 'postgres');
    const res = await pool.query(adaptedSql, params);
    return res.rows;
  }

  const stmt = sDb.prepare(sql);
  return stmt.all(...params);
}

async function run(sql, params = []) {
  const { activeDriver: driver, sqliteDb: sDb, pgPool: pool } = getDatabase();

  if (driver === 'postgres') {
    const adaptedSql = adaptSql(sql, 'postgres');
    const res = await pool.query(adaptedSql, params);
    return {
      changes: res.rowCount,
      rows: res.rows
    };
  }

  const stmt = sDb.prepare(sql);
  const info = stmt.run(...params);
  return {
    changes: info.changes,
    lastInsertRowid: info.lastInsertRowid
  };
}

async function exec(sql) {
  const { activeDriver: driver, sqliteDb: sDb, pgPool: pool } = getDatabase();

  if (driver === 'postgres') {
    await pool.query(sql);
    return;
  }

  sDb.exec(sql);
}

function closeDatabase() {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  if (pgPool) {
    pgPool.end();
    pgPool = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  query,
  get,
  all,
  run,
  exec,
  closeDatabase
};
