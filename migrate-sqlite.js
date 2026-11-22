const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { createDatabase, initializeDatabase } = require('./database');

const tables = ['users', 'properties', 'favourites', 'enquiries', 'notifications'];

async function migrateSQLite({ filename, db, backupDirectory = path.join(__dirname, '.backend-check', 'migration-backups') }) {
  if (db.dialect !== 'PostgreSQL') throw Error('Migration requires a PostgreSQL DATABASE_URL.');
  const source = new DatabaseSync(path.resolve(filename), { readOnly: true });
  const backupFile = path.join(backupDirectory, `sqlite-before-neon-${randomUUID()}.sqlite`);
  try {
    const existing = source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    if (!['users', 'properties', 'favourites', 'enquiries'].every(table => existing.includes(table))) throw Error('This is not a Hostel Homes SQLite database.');
    fs.mkdirSync(backupDirectory, { recursive: true });
    await backup(source, backupFile);
  } finally { source.close(); }

  // Only upgrade the snapshot. The original SQLite database stays untouched.
  const snapshot = createDatabase({ connectionString: '', filename: backupFile });
  try {
    await initializeDatabase(snapshot);
    await initializeDatabase(db);
    const counts = await db.transaction(async tx => {
      await tx.exec('LOCK TABLE users, properties, favourites, enquiries, notifications IN ACCESS EXCLUSIVE MODE');
      for (const table of tables) {
        if (Number((await tx.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).n)) throw Error('The destination already contains app data. Nothing was imported; existing records were preserved.');
      }
      const copied = {};
      for (const table of tables) {
        const targetColumns = (await tx.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? ORDER BY ordinal_position').all(table)).map(row => row.column_name);
        const rows = await snapshot.prepare(`SELECT * FROM ${table}`).all();
        for (const row of rows) {
          const columns = targetColumns.filter(column => Object.hasOwn(row, column));
          await tx.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => row[column]));
        }
        if (table !== 'favourites') await tx.exec(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0), 1), EXISTS(SELECT 1 FROM ${table}))`);
        copied[table] = rows.length;
      }
      return copied;
    });
    return { counts, backupFile };
  } finally { await snapshot.close(); }
}

if (require.main === module) {
  require('dotenv').config();
  let db;
  (async () => {
    if (!process.env.DATABASE_URL) throw Error('Add DATABASE_URL to .env before migrating.');
    db = createDatabase();
    const result = await migrateSQLite({ filename: process.argv[2] || path.join(__dirname, 'hostel-homes.sqlite'), db });
    console.log('Migration complete:', JSON.stringify(result.counts));
    console.log('SQLite backup:', result.backupFile);
  })().catch(error => {
    // Driver errors can contain connection details; only our migration errors are printed.
    console.error(error.code ? `Migration failed (${error.code}). No partial data was imported.` : error.message);
    process.exitCode = 1;
  }).finally(async () => { if (db) await db.close(); });
}

module.exports = { migrateSQLite };
