const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createEmailDelivery } = require('../email');

const config = { apiKey: 'test-key', from: 'alerts@example.com', appUrl: 'https://hostel.example' };
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT);
    INSERT INTO users VALUES(1,'Owner','owner@example.com'),(2,'Student','student@example.com');
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id INTEGER,message TEXT,is_read INTEGER DEFAULT 0,
      email_sent_at TEXT,email_key TEXT,email_attempts INTEGER DEFAULT 0,email_next_attempt INTEGER DEFAULT 0);
    INSERT INTO notifications(id,user_id,message) VALUES(1,1,'New enquiry for Room');`);
  return db;
}
const accepted = () => ({ ok: true, status: 201, json: async () => ({ messageId: 'test-message' }) });

test('missing email configuration keeps the in-app notification queued', async t => {
  const db = fixture(t);
  let calls = 0;
  await createEmailDelivery(db, { ...config, apiKey: '' }, async () => { calls++; }).flush();
  await createEmailDelivery(db, { ...config, from: '' }, async () => { calls++; }).flush();
  assert.equal(calls, 0);
  assert.equal(db.prepare('SELECT email_attempts FROM notifications').get().email_attempts, 0);
  assert.equal(db.prepare('SELECT message FROM notifications').get().message, 'New enquiry for Room');
});

test('email delivery uses each account recipient and does not resend accepted messages', async t => {
  const db = fixture(t);
  db.exec("INSERT INTO notifications(id,user_id,message) VALUES(2,2,'Your enquiry was contacted');");
  const calls = [];
  const delivery = createEmailDelivery(db, config, async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return accepted(); });
  await delivery.flush();
  await delivery.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].options.headers['api-key'], 'test-key');
  assert.equal(calls[0].body.sender.email, config.from);
  assert.equal(calls[0].body.to[0].email, 'owner@example.com');
  assert.equal(calls[1].body.to[0].email, 'student@example.com');
  assert.match(calls[1].body.textContent, /Your enquiry was contacted/);
  assert.ok(calls[0].body.textContent.includes(config.appUrl));
  assert.notEqual(calls[0].body.headers.idempotencyKey, calls[1].body.headers.idempotencyKey);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE email_sent_at IS NOT NULL').get().n, 2);
  assert.equal(db.prepare('SELECT is_read FROM notifications WHERE id=1').get().is_read, 0);
});

test('failed delivery retries with the same key and preserves the in-app message', async t => {
  const db = fixture(t);
  t.mock.method(console, 'error', () => {});
  const keys = [];
  const delivery = createEmailDelivery(db, config, async (url, options) => {
    keys.push(JSON.parse(options.body).headers.idempotencyKey);
    if (keys.length === 1) throw new Error('Network unavailable');
    return accepted();
  });
  await delivery.flush();
  const failed = db.prepare('SELECT * FROM notifications').get();
  assert.equal(failed.email_sent_at, null);
  assert.equal(failed.email_attempts, 1);
  assert.ok(failed.email_next_attempt > Date.now());
  assert.equal(failed.message, 'New enquiry for Room');
  await delivery.flush();
  assert.equal(keys.length, 1);
  db.exec('UPDATE notifications SET email_next_attempt=0');
  await delivery.flush();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.ok(db.prepare('SELECT email_sent_at FROM notifications').get().email_sent_at);
});

test('permanent provider failures stop after three attempts', async t => {
  const db = fixture(t);
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  const delivery = createEmailDelivery(db, config, async () => {
    calls++;
    return { ok: false, status: 400, json: async () => ({ code: 'duplicate_parameter', message: 'Invalid recipient parameter' }) };
  });
  for (let attempt = 0; attempt < 4; attempt++) { await delivery.flush(); db.exec('UPDATE notifications SET email_next_attempt=0'); }
  assert.equal(calls, 3);
  assert.equal(db.prepare('SELECT email_sent_at FROM notifications').get().email_sent_at, null);
});

test('an acknowledged idempotent retry is recorded as accepted', async t => {
  const db = fixture(t);
  await createEmailDelivery(db, config, async () => ({ ok: false, status: 400, json: async () => ({ code: 'duplicate_parameter', message: 'Email for the idempotency key has already been processed' }) })).flush();
  assert.ok(db.prepare('SELECT email_sent_at FROM notifications').get().email_sent_at);
});

test('overlapping flushes do not send the same queued email twice', async t => {
  const db = fixture(t);
  let release;
  let calls = 0;
  const delivery = createEmailDelivery(db, config, async () => { calls++; return new Promise(resolve => { release = () => resolve(accepted()); }); });
  const first = delivery.flush();
  await delivery.flush();
  assert.equal(calls, 1);
  release();
  await first;
});
