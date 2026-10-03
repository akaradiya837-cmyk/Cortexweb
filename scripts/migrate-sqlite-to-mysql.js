const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { createPool, initializeSchema } = require('../database');
const sqlitePath = path.join(root, 'data', 'cortexweb.sqlite');
const tableNames = ['users', 'projects', 'integrations', 'activity_logs', 'submissions'];

async function migrate() {
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite source database not found: ${sqlitePath}`);

  const source = new DatabaseSync(sqlitePath);
  const pool = createPool();
  let connection;
  let transactionOpen = false;

  try {
    await initializeSchema(pool);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;

    for (const table of tableNames) {
      const [counts] = await connection.execute(`SELECT COUNT(*) AS row_count FROM \`${table}\``);
      if (Number(counts[0].row_count) > 0) throw new Error(`MySQL table '${table}' is not empty. Import is only allowed into an empty target.`);
    }

    const totals = {};
    for (const table of tableNames) {
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      totals[table] = rows.length;
      if (!rows.length) continue;

      const columns = Object.keys(rows[0]);
      const columnSql = columns.map((column) => `\`${column}\``).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insert = `INSERT INTO \`${table}\` (${columnSql}) VALUES (${placeholders})`;
      for (const row of rows) {
        await connection.execute(insert, columns.map((column) => row[column]));
      }
    }

    await connection.commit();
    transactionOpen = false;
    console.log('SQLite import completed. Source file was left unchanged.');
    for (const [table, count] of Object.entries(totals)) console.log(`${table}: ${count}`);
  } catch (error) {
    if (transactionOpen) await connection.rollback();
    throw error;
  } finally {
    connection?.release();
    source.close();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(`SQLite import failed: ${error.message}`);
  process.exitCode = 1;
});