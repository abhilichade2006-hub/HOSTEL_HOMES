const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase, initializeDatabase } = require('../database');
const { createEmailDelivery } = require('../email');
const { migrateSQLite } = require('../migrate-sqlite');
const { postgresFixture } = require('./postgres-fixture.cjs');

for (const backend of ['SQLite', ...(process.env.TEST_DATABASE_URL ? ['PostgreSQL'] : [])]) {
  test(`${backend}: transactions isolate awaited work and roll back every write`, async t => {
    const db = backend === 'PostgreSQL' ? (await postgresFixture(t, process.env.TEST_DATABASE_URL)).db : createDatabase({ connectionString: '', filename: ':memory:' });
    if (backend === 'SQLite') t.after(() => db.close());
    await initializeDatabase(db);
    await assert.rejects(db.transaction(async tx => {
      const user = await tx.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?) RETURNING id').run('Owner', 'rollback@example.test', 'hash');
      await tx.prepare('INSERT INTO notifications(user_id,kind,message) VALUES(?,?,?)').run(user.lastInsertRowid, 'enquiry', 'Must roll back');
      throw Error('abort');
    }), /abort/);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM users').get()).n), 0);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM notifications').get()).n), 0);

    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const paused = new Promise(resolve => { release = resolve; });
    const transaction = db.transaction(async tx => {
      await tx.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run('Inside', 'inside@example.test', 'hash');
      entered();
      await paused;
      throw Error('rollback paused transaction');
    });
    await started;
    const outside = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run('Outside', 'outside@example.test', 'hash');
    release();
    await assert.rejects(transaction, /rollback paused/);
    await outside;
    assert.deepEqual((await db.prepare('SELECT email FROM users').all()).map(row => row.email), ['outside@example.test']);
    const literal = await db.prepare("SELECT '?' AS question, ? AS parameter").get('bound value');
    assert.equal(literal.question, '?');
    assert.equal(literal.parameter, 'bound value');
  });

  test(`${backend}: email outbox saves provider acceptance without changing in-app alerts`, async t => {
    const db = backend === 'PostgreSQL' ? (await postgresFixture(t, process.env.TEST_DATABASE_URL)).db : createDatabase({ connectionString: '', filename: ':memory:' });
    if (backend === 'SQLite') t.after(() => db.close());
    await initializeDatabase(db);
    const user = await db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?) RETURNING id').run('Owner', 'owner@example.test', 'hash');
    await db.prepare('INSERT INTO notifications(user_id,kind,message) VALUES(?,?,?)').run(user.lastInsertRowid, 'enquiry', 'New enquiry');
    let calls = 0;
    const delivery = createEmailDelivery(db, { apiKey: 'fake-key', from: 'sender@example.test', appUrl: 'https://example.test' }, async (url, options) => {
      calls++;
      assert.equal(JSON.parse(options.body).to[0].email, 'owner@example.test');
      return { ok: true, status: 201, json: async () => ({ messageId: 'fake-message' }) };
    });
    await delivery.flush(); await delivery.flush();
    assert.equal(calls, 1);
    const alert = await db.prepare('SELECT * FROM notifications').get();
    assert.ok(alert.email_sent_at);
    assert.equal(alert.email_attempts, 1);
    assert.equal(alert.is_read, 0);
    await db.prepare('INSERT INTO notifications(user_id,kind,message) VALUES(?,?,?)').run(user.lastInsertRowid, 'enquiry', 'Concurrent update');
    const keys = [], releases = [];
    const provider = async (url, options) => {
      keys.push(JSON.parse(options.body).headers.idempotencyKey);
      return new Promise(resolve => {
        releases.push(() => resolve({ok:true,status:201,json:async()=>({messageId:'fake-message'})}));
        if(releases.length===2)releases.forEach(release=>release());
      });
    };
    const config = {apiKey:'fake-key',from:'sender@example.test',appUrl:'https://example.test'};
    await Promise.all([createEmailDelivery(db,config,provider).flush(),createEmailDelivery(db,config,provider).flush()]);
    assert.equal(keys.length,2);
    assert.equal(new Set(keys).size,1);
  });
}

test('SQLite to PostgreSQL import preserves IDs and photos, refuses repeats and rolls back invalid data', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-migration-test-'));
  let source;
  t.after(async () => {
    if(source)await source.close();
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('hostel-migration-test-')) throw Error('Unexpected cleanup target');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const sourceFile = path.join(dir, 'legacy.sqlite');
  source = createDatabase({ connectionString: '', filename: sourceFile });
  await initializeDatabase(source);
  await source.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(12, 'Owner', 'Owner@Example.test', 'existing-password-hash', 'Owner');
  await source.prepare('INSERT INTO properties(id,owner_id,title,type,rent,city,locality,description,image_url,latitude,longitude) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(25, 12, 'Existing room', 'Hostel', 4500.5, 'Pune', 'Wakad', 'Existing description', 'data:image/jpeg;base64,aGVsbG8=', 18.5, 73.8);
  await source.prepare('INSERT INTO favourites(user_id,property_id) VALUES(?,?)').run(12, 25);
  await source.prepare('INSERT INTO enquiries(id,property_id,user_id,move_date,message) VALUES(?,?,?,?,?)').run(9, 25, 12, '2027-01-01', 'Existing enquiry');
  await source.exec('DROP TABLE notifications');
  const { db } = await postgresFixture(t, process.env.TEST_DATABASE_URL);
  const result = await migrateSQLite({ filename: sourceFile, db, backupDirectory: dir });
  assert.deepEqual(result.counts, { users: 1, properties: 1, favourites: 1, enquiries: 1, notifications: 0 });
  assert.equal(fs.existsSync(result.backupFile), true);
  assert.equal((await source.prepare("SELECT name FROM sqlite_master WHERE name='notifications'").get()), undefined);
  assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').get(12)).password_hash, 'existing-password-hash');
  const room = await db.prepare('SELECT * FROM properties WHERE id=?').get(25);
  assert.equal(room.image_url, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal(Number(room.rent), 4500.5);
  assert.equal(room.latitude, 18.5);
  assert.equal((await db.prepare('SELECT property_id FROM favourites').get()).property_id, 25);
  assert.equal((await db.prepare('SELECT id FROM enquiries').get()).id, 9);
  await assert.rejects(migrateSQLite({ filename: sourceFile, db, backupDirectory: dir }), /already contains app data/);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM properties').get()).n), 1);
  const next = await db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?) RETURNING id').run('New user', 'new@example.test', 'hash');
  assert.ok(next.lastInsertRowid > 12);

  // A bad legacy foreign key must not leave the earlier imported users behind.
  await source.exec('PRAGMA foreign_keys=OFF; UPDATE properties SET owner_id=999;');
  const empty = (await postgresFixture(t, process.env.TEST_DATABASE_URL)).db;
  await assert.rejects(migrateSQLite({ filename: sourceFile, db: empty, backupDirectory: dir }), error => error.code === '23503');
  assert.equal(Number((await empty.prepare('SELECT COUNT(*) n FROM users').get()).n), 0);
  assert.equal(Number((await empty.prepare('SELECT COUNT(*) n FROM properties').get()).n), 0);
});
