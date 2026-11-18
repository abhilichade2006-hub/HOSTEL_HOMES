const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'browse.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const room = (id, overrides = {}) => ({ id, title: `Room ${id}`, rent: 5000, deposit: 1000, type: 'Hostel', locality: 'Wakad', city: 'Pune', gender: 'Any', availability: 'Available', facilities: ['Wi-Fi'], images: [], ...overrides });
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => '₹' + Number(value).toLocaleString('en-IN');

function fixture() {
  const elements = {};
  const messages = [];
  let modal = '';
  const element = id => elements[id] ||= { querySelectorAll: () => [], classList: { toggle() {} } };
  const context = vm.createContext({
    URL, URLSearchParams, window: { location: { origin: 'https://rooms.example', search: '' } }, navigator: {},
    document: { body: { classList: { toggle() {} } }, querySelectorAll: () => [] },
    $: element, esc, money, toast: message => messages.push(message),
    openModal: html => { modal = html; },
    api: async url => ({ property: room(Number(url.split('/').pop())) })
  });
  vm.runInContext(source, context);
  return { context, element, messages, modal: () => modal };
}

test('move-in estimate adds numeric rent and deposit, including zero deposit', () => {
  const { context } = fixture();
  assert.equal(context.moveInCost(room(1)), 6000);
  assert.equal(context.moveInCost(room(1, { deposit: 0 })), 5000);
  assert.equal(context.moveInCost(room(1, { rent: '5000', deposit: '2000' })), 7000);
});

test('room links use the current origin and reject invalid shared room IDs', () => {
  const { context } = fixture();
  assert.equal(context.roomShareUrl(7), 'https://rooms.example/?room=7');
  assert.equal(context.sharedRoomId('?room=7'), 7);
  for (const query of ['', '?room=0', '?room=-1', '?room=abc', '?room=1.5', '?room=Infinity', '?room=9007199254740992']) assert.equal(context.sharedRoomId(query), null);
});

test('comparison selections are limited to three and can be removed across filters', () => {
  const { context, element, messages } = fixture();
  context.initBrowseTools();
  assert.equal(element('compareBar').hidden, true);
  context.toggleCompare(room(1));
  assert.equal(element('showCompare').disabled, true);
  context.toggleCompare(room(2));
  context.toggleCompare(room(3));
  context.toggleCompare(room(4));
  assert.equal(element('compareCount').textContent, '3 of 3 rooms selected');
  assert.match(messages.at(-1), /up to 3/);
  context.toggleCompare(room(1));
  context.toggleCompare(room(4));
  assert.match(element('compareSelections').innerHTML, /Room 4/);
  assert.doesNotMatch(element('compareSelections').innerHTML, /Room 1/);
  element('clearCompare').onclick();
  assert.equal(element('compareBar').hidden, true);
});

test('comparison markup escapes listing content and includes total initial costs', () => {
  const { context } = fixture();
  const markup = context.comparisonTable([room(1, { title: '<script>alert(1)</script>', facilities: ['</td><script>'] }), room(2)]);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /First month \+ deposit/);
  assert.match(markup, /₹6,000/);
  assert.match(markup, /data-compare-open="2"/);
});

test('comparison refreshes the selected rooms before showing prices', async () => {
  const { context, modal, element } = fixture();
  const requests = [];
  context.api = async url => { requests.push(url); return { property: room(Number(url.split('/').pop()), { rent: 9000 }) }; };
  context.toggleCompare(room(1));
  context.toggleCompare(room(2));
  await context.showComparison();
  assert.deepEqual(requests, ['/properties/1', '/properties/2']);
  assert.match(modal(), /₹9,000/);
  assert.equal(element('showCompare').disabled, false);
});

test('an unavailable room shows an error without discarding the selection', async () => {
  const { context, messages, modal, element } = fixture();
  context.api = async () => { throw Error('Property not found.'); };
  context.toggleCompare(room(1)); context.toggleCompare(room(2));
  await context.showComparison();
  assert.equal(modal(), '');
  assert.match(messages.at(-1), /Property not found/);
  assert.equal(element('compareCount').textContent, '2 of 3 rooms selected');
  assert.equal(element('showCompare').disabled, false);
});

test('clearing selection while comparison loads cancels the pending modal', async () => {
  const { context, modal, element } = fixture();
  context.initBrowseTools();
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  context.api = async url => { await ready; return { property: room(Number(url.split('/').pop())) }; };
  context.toggleCompare(room(1)); context.toggleCompare(room(2));
  const pending = context.showComparison();
  element('clearCompare').onclick();
  release(); await pending;
  assert.equal(modal(), '');
  assert.equal(element('showCompare').disabled, true);
});

test('copy link supports clipboard success and manual fallback', async () => {
  const { context, messages } = fixture();
  let copied, focused = false, selected = false;
  const input = { value: 'https://rooms.example/?room=1', focus() { focused = true; }, select() { selected = true; } };
  context.navigator.clipboard = { writeText: async value => { copied = value; } };
  await context.copyRoomLink(input);
  assert.equal(copied, input.value);
  assert.equal(messages.at(-1), 'Room link copied.');
  context.navigator.clipboard.writeText = async () => { throw Error('Permission denied'); };
  await context.copyRoomLink(input);
  assert.equal(focused, true); assert.equal(selected, true);
  delete context.navigator.clipboard;
  await context.copyRoomLink(input);
  assert.match(messages.at(-1), /Select and copy/);
});

test('room details show sharing and initial cost without ratings', async () => {
  const { context, modal } = fixture();
  context.favourites = new Set();
  context.art = () => 'No photo';
  context.propertyMapSection = () => '';
  context.initPropertyMap = () => {};
  context.updateCompareBar = () => {};
  vm.runInContext(appSource.slice(appSource.indexOf('async function showProperty('), appSource.indexOf('\nfunction showAuth(')), context);
  await context.showProperty(1);
  assert.match(modal(), /First month \+ deposit/);
  assert.match(modal(), /₹6,000/);
  assert.match(modal(), /id="shareProperty"/);
  assert.match(modal(), /id="compareProperty"/);
  assert.doesNotMatch(modal(), /rating|stars/i);
});
