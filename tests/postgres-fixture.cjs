const { randomUUID } = require('node:crypto');
const { createDatabase } = require('../database');

async function postgresFixture(t, sourceUrl) {
  const url = new URL(sourceUrl);
  // Direct connections preserve the per-test schema across pooled client sessions.
  url.hostname = url.hostname.replace('-pooler.', '.');
  url.searchParams.delete('options');
  const admin = createDatabase({ connectionString: url.toString() });
  const schema = 'hh_test_' + randomUUID().replaceAll('-', '');
  await admin.exec(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const connectionString = url.toString();
  const db = createDatabase({ connectionString });
  t.after(async () => {
    await db.close();
    if (!/^hh_test_[a-f0-9]{32}$/.test(schema)) throw Error('Unexpected test schema');
    await admin.exec(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  });
  return { db, connectionString };
}

module.exports = { postgresFixture };
