require('dotenv').config();
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
if (!process.env.DATABASE_URL) {
  console.error('Add DATABASE_URL to .env before running PostgreSQL checks.');
  process.exit(1);
}
const files = fs.readdirSync(__dirname).filter(file => file.endsWith('.test.js')).map(file => path.join(__dirname, file));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL } });
process.exit(result.status ?? 1);
