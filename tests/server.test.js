const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('account, listing, approval and enquiry flows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-homes-test-'));
  for (const file of ['server.js', 'index.html', 'app.js', 'app.css', 'login.html', 'login.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(dir, file));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child = spawn(process.execPath, [path.join(dir, 'server.js')], { env: { ...process.env, NODE_PATH: path.join(__dirname, '..', 'node_modules'), PORT: String(port), ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'password123', JWT_SECRET: 'test-secret' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error(`Server exited: ${child.exitCode}`);
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Server did not start');
  }
  async function stop() { if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } }
  async function request(url, method = 'GET', body, token) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  }
  try {
    await start();
    assert.match(await (await fetch(base + '/')).text(), /Hostel Homes/);
    assert.equal((await fetch(base + '/app.js')).status, 200);
    assert.match(await (await fetch(base + '/login')).text(), /id="loginForm"/);
    assert.equal((await fetch(base + '/login.js')).status, 200);
    assert.doesNotMatch(await (await fetch(base + '/.env')).text(), /JWT_SECRET/);
    const malformed = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'Invalid JSON request.');
    assert.equal((await request('/api/owner/properties')).status, 401);
    assert.equal((await request('/api/auth/me', 'GET', undefined, 'invalid-token')).status, 401);
    const owner = await request('/api/auth/register', 'POST', { name: 'Owner', email: 'owner@test.local', password: 'password123', role: 'Owner' });
    assert.equal(owner.status, 201);
    const otherOwner = await request('/api/auth/register', 'POST', { name: 'Other owner', email: 'other-owner@test.local', password: 'password123', role: 'Owner' });
    assert.equal(otherOwner.status, 201);
    assert.equal((await request('/api/auth/register', 'POST', { name: 'Owner', email: 'OWNER@test.local', password: 'password123' })).status, 409);
    const user = await request('/api/auth/register', 'POST', { name: 'User', email: 'user@test.local', password: 'password123' });
    const admin = await request('/api/auth/login', 'POST', { email: 'admin@test.local', password: 'password123' });
    assert.equal(user.status, 201); assert.equal(admin.status, 200);
    const listing = { title: 'Room', type: 'Hostel', rent: 5000, city: 'Pune', locality: 'Wakad', description: 'A room', phone: '+91 90000 00000' };
    assert.equal((await request('/api/admin/owners', 'GET', undefined, user.body.token)).status, 403);
    assert.equal((await request('/api/admin/owners', 'GET', undefined, admin.body.token)).body.owners.some(o => o.id === owner.body.user.id), true);
    assert.equal((await request('/api/properties', 'POST', listing, admin.body.token)).status, 400);
    assert.equal((await request('/api/properties', 'POST', { ...listing, owner_id: user.body.user.id }, admin.body.token)).status, 400);
    const adminListing = await request('/api/properties', 'POST', { ...listing, owner_id: owner.body.user.id, gender: 'Women', facilities: ['Wi-Fi','Laundry'], image_labels: ['Bedroom'], image_url: 'data:image/png;base64,aGVsbG8=', availability: 'Available' }, admin.body.token);
    assert.equal(adminListing.status, 201);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`)).body.property.owner_id, owner.body.user.id);
    assert.equal((await request(`/api/properties/${adminListing.body.id}/contact`)).status, 401);
    assert.equal((await request(`/api/properties/${adminListing.body.id}/contact`, 'GET', undefined, admin.body.token)).status, 403);
    assert.deepEqual((await request(`/api/properties/${adminListing.body.id}/contact`, 'GET', undefined, user.body.token)).body.owner, { name: 'Owner', email: 'owner@test.local', phone: '+91 90000 00000' });
    const directEnquiry = await request('/api/enquiries', 'POST', { property_id: adminListing.body.id, move_date: '2027-01-01', message: 'Message for the real owner' }, user.body.token);
    assert.equal(directEnquiry.status, 201);
    assert.equal((await request('/api/enquiries', 'GET', undefined, owner.body.token)).body.enquiries[0].id, directEnquiry.body.id);
    assert.equal((await request('/api/enquiries', 'GET', undefined, otherOwner.body.token)).body.enquiries.length, 0);
    assert.equal((await request('/api/enquiries', 'GET', undefined, admin.body.token)).status, 403);
    assert.equal((await request(`/api/enquiries/${directEnquiry.body.id}`, 'PATCH', { status: 'Closed' }, admin.body.token)).status, 403);
    assert.equal((await request(`/api/enquiries/${directEnquiry.body.id}`, 'PATCH', { status: 'Closed' }, otherOwner.body.token)).status, 403);
    assert.equal((await request(`/api/enquiries/${directEnquiry.body.id}`, 'PATCH', { status: 'Closed' }, user.body.token)).status, 403);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { owner_id: otherOwner.body.user.id }, owner.body.token)).status, 400);
    // Existing admin-owned demo listings must be assigned before accepting enquiries.
    const legacyDb = new DatabaseSync(path.join(dir, 'hostel-homes.sqlite'));
    legacyDb.prepare('UPDATE properties SET owner_id=? WHERE id=?').run(admin.body.user.id, adminListing.body.id);
    legacyDb.close();
    assert.equal((await request(`/api/properties/${adminListing.body.id}/contact`, 'GET', undefined, user.body.token)).status, 409);
    assert.equal((await request('/api/enquiries', 'POST', { property_id: adminListing.body.id, move_date: '2027-01-01', message: 'Unassigned room' }, user.body.token)).status, 409);
    assert.equal((await request(`/api/admin/properties/${adminListing.body.id}/status`, 'PATCH', { status: 'Approved' }, admin.body.token)).status, 400);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { owner_id: otherOwner.body.user.id }, admin.body.token)).status, 200);
    assert.equal((await request('/api/enquiries', 'GET', undefined, otherOwner.body.token)).body.enquiries[0].id, directEnquiry.body.id);
    assert.equal((await request('/api/enquiries', 'GET', undefined, owner.body.token)).body.enquiries.length, 0);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { owner_id: owner.body.user.id }, admin.body.token)).status, 200);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`)).body.property.image_url, 'data:image/png;base64,aGVsbG8=');
    assert.deepEqual((await request(`/api/properties/${adminListing.body.id}`)).body.property.image_labels, ['Bedroom']);
    assert.equal((await request('/api/properties?gender=Women&amenity=Wi-Fi')).body.properties.some(p => p.id === adminListing.body.id), true);
    assert.equal((await request('/api/properties?gender=Men')).body.properties.some(p => p.id === adminListing.body.id), false);
    assert.equal((await request('/api/properties?amenity=Meals')).body.properties.some(p => p.id === adminListing.body.id), false);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { image_labels: ['Unsafe'] }, admin.body.token)).status, 400);
    const photoA = 'https://example.com/room-a.jpg';
    const photoB = 'https://example.com/room-b.jpg';
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { image_urls: [photoA, photoB] }, admin.body.token)).status, 200);
    assert.deepEqual((await request(`/api/properties/${adminListing.body.id}`)).body.property.images, ['data:image/png;base64,aGVsbG8=', photoA, photoB]);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { image_url: photoA, image_urls: [photoB], image_labels: ['Bathroom','Kitchen'] }, admin.body.token)).status, 200);
    assert.deepEqual((await request(`/api/properties/${adminListing.body.id}`)).body.property.images, [photoA, photoB]);
    assert.deepEqual((await request(`/api/properties/${adminListing.body.id}`)).body.property.image_labels, ['Bathroom','Kitchen']);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { image_urls: Array(6).fill(photoA) }, admin.body.token)).status, 400);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { image_urls: ['javascript:alert(1)'] }, admin.body.token)).status, 400);

    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { availability: 'Unavailable' }, user.body.token)).status, 403);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { availability: 'Unavailable' }, admin.body.token)).status, 200);
    assert.equal((await request(`/api/properties/${adminListing.body.id}/contact`, 'GET', undefined, user.body.token)).status, 404);
    assert.equal((await request('/api/enquiries', 'POST', { property_id: adminListing.body.id, move_date: '2027-01-01', message: 'Unavailable room' }, user.body.token)).status, 404);
    assert.equal((await request('/api/properties')).body.properties.some(p => p.id === adminListing.body.id), false);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { availability: 'Available', image_url: 'javascript:alert(1)' }, admin.body.token)).status, 400);
    assert.equal((await request(`/api/properties/${adminListing.body.id}`, 'PATCH', { availability: 'Available', image_url: 'https://example.com/room.jpg' }, admin.body.token)).status, 200);
    assert.equal((await request('/api/properties')).body.properties.some(p => p.id === adminListing.body.id), true);

    assert.equal((await request('/api/properties', 'POST', { ...listing, title: ' ' }, owner.body.token)).status, 400);
    const created = await request('/api/properties', 'POST', listing, owner.body.token);
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal((await request(`/api/properties/${id}`)).status, 404);
    assert.equal((await request(`/api/properties/${id}`, 'PATCH', { rent: -1 }, owner.body.token)).status, 400);
    assert.equal((await request(`/api/admin/properties/${id}/status`, 'PATCH', { status: 'Approved' }, admin.body.token)).status, 200);
    assert.equal((await request(`/api/favourites/${id}`, 'POST', {}, user.body.token)).body.saved, true);
    assert.equal((await request('/api/enquiries', 'POST', {}, user.body.token)).status, 400);
    assert.equal((await request('/api/enquiries', 'POST', { property_id: id, move_date: '2027-01-01', message: 'Hello' }, user.body.token)).status, 201);
    assert.equal((await request('/api/enquiries', 'GET', undefined, owner.body.token)).body.enquiries[0].user_email, 'user@test.local');
    const enquiry = (await request('/api/enquiries', 'GET', undefined, owner.body.token)).body.enquiries[0];
    assert.equal((await request(`/api/enquiries/${enquiry.id}`, 'PATCH', { status: 'Contacted' }, owner.body.token)).status, 200);
    assert.equal((await request(`/api/properties/${id}`, 'PATCH', { title: 'Updated room' }, owner.body.token)).status, 200);
    assert.equal((await request('/api/favourites', 'GET', undefined, user.body.token)).body.properties.length, 0);
    assert.equal((await request(`/api/admin/properties/${id}/status`, 'PATCH', { status: 'Approved' }, admin.body.token)).status, 200);
    const beforeRestart = (await request(`/api/properties/${adminListing.body.id}`)).body.property;
    await stop(); await start();
    const loggedInAgain = await request('/api/auth/login', 'POST', { email: 'user@test.local', password: 'password123' });
    assert.equal(loggedInAgain.status, 200);
    assert.equal(loggedInAgain.body.user.id, user.body.user.id);
    assert.equal((await request('/api/auth/me', 'GET', undefined, admin.body.token)).body.user.role, 'Admin');
    assert.deepEqual((await request(`/api/properties/${adminListing.body.id}`)).body.property, beforeRestart);
    assert.equal((await request(`/api/properties/${id}`)).body.property.title, 'Updated room');
    assert.equal((await request('/api/favourites', 'GET', undefined, loggedInAgain.body.token)).body.properties[0].id, id);
    assert.equal((await request('/api/enquiries', 'GET', undefined, loggedInAgain.body.token)).body.enquiries[0].status, 'Contacted');
    const all = (await request('/api/admin/properties', 'GET', undefined, admin.body.token)).body.properties;
    for (const property of all) assert.equal((await request(`/api/properties/${property.id}`, 'DELETE', undefined, admin.body.token)).status, 200);
    await stop(); await start();
    assert.equal((await request('/api/properties')).body.properties.length, 0);
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
