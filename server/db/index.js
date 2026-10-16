// server/db/index.js - Unified Database Connection Layer (SQLite & PostgreSQL)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const pg = require('pg');
const { Pool, types } = pg;

// PostgreSQL returns BIGINT (e.g. COUNT(*)) and NUMERIC (e.g. SUM/AVG) as strings to avoid
// precision loss; SQLite returns plain numbers. Parse them so both drivers behave the same.
types.setTypeParser(20, value => (value === null ? null : parseInt(value, 10)));   // INT8 / BIGINT
types.setTypeParser(1700, value => (value === null ? null : parseFloat(value)));   // NUMERIC
// TIMESTAMP (without time zone): all times are kept in UTC. Read and write them as UTC whatever the
// server's own time zone is (otherwise a server outside UTC would shift meetings and reminders).
types.setTypeParser(1114, value => (value === null ? null : new Date(value.replace(' ', 'T') + 'Z')));
pg.defaults.parseInputDatesAsUTC = true;

let sqliteDb = null;
let pgPool = null;
let activeDriver = 'sqlite';

// DB_DRIVER must be exactly "postgres" or "sqlite". A typo used to silently start the server on
// a temporary SQLite file (data lost on restart); now the server refuses to start and says why.
const DRIVER_ALIASES = { postgres: 'postgres', postgresql: 'postgres', pg: 'postgres', sqlite: 'sqlite', sqlite3: 'sqlite' };

function resolveDriver(value) {
  if (!value) return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  const driver = DRIVER_ALIASES[String(value).trim().toLowerCase()];
  if (!driver) {
    throw new Error(`DB_DRIVER="${value}" не понят. В Railway → Variables впишите DB_DRIVER=postgres (ровно это слово).`);
  }
  return driver;
}

function initDatabase(customOptions = {}) {
  const driver = resolveDriver(customOptions.driver || process.env.DB_DRIVER);
  activeDriver = driver;
  if (driver === 'postgres' && !(customOptions.connectionString || process.env.DATABASE_URL)) {
    throw new Error('DB_DRIVER=postgres, но DATABASE_URL не задан. В Railway → Variables добавьте DATABASE_URL (Supabase → Session pooler).');
  }

  if (driver === 'postgres') {
    const connectionString = customOptions.connectionString || process.env.DATABASE_URL;
    pgPool = new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      // Never wait forever: no connection in 10 s or no answer in 30 s → an error the person sees
      // with a code, instead of an endless «Загрузка…»
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
      // Idle connections are closed before the Supabase pooler drops them on its side
      idleTimeoutMillis: 30000,
      keepAlive: true
    });
    // The database closed an idle connection (restart, network blip). Without this handler Node
    // stops the whole server; with it the pool simply opens a new connection on the next query.
    pgPool.on('error', (err) => {
      console.warn('[SmartFlow DB] idle connection lost, will reconnect:', err.message);
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
  resolveDriver,
  initDatabase,
  getDatabase,
  query,
  get,
  all,
  run,
  exec,
  closeDatabase
};
