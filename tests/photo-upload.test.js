const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const typeSource = source.slice(source.indexOf('function roomPhotoType('), source.indexOf('\nasync function loadProperties('));
const formSource = source.slice(source.indexOf('async function showListingForm('), source.indexOf('\nfunction enquiryDate('));

test('JPG and JPEG files normalize standard, legacy and missing browser types', () => {
  const context = vm.createContext({});
  vm.runInContext(typeSource, context);
  for (const type of ['image/jpeg', 'image/jpg', 'image/pjpeg', '']) {
    for (const name of ['room.jpg', 'room.jpeg', 'ROOM.JPEG']) assert.equal(context.roomPhotoType({ name, type }), 'image/jpeg');
  }
  assert.equal(context.roomPhotoType({ name: 'room.png', type: 'image/png' }), 'image/png');
  assert.equal(context.roomPhotoType({ name: 'room.webp', type: 'image/webp' }), 'image/webp');
  for (const type of ['text/html', 'image/svg+xml', 'image/gif']) assert.equal(context.roomPhotoType({ name: 'room.jpg', type }), '');
  assert.equal(context.roomPhotoType({ name: 'notes.txt', type: '' }), '');
});

test('an untyped .jpeg uploads through the listing form as standard JPEG', async () => {
  const image = new File([fs.readFileSync(path.join(__dirname, '..', 'sample-photos', 'room-1.jpg'))], 'room.jpeg', { type: '' });
  const fields = { title: 'Room', type: 'Hostel', rent: '5000', deposit: '0', city: 'Pune', locality: 'Wakad', facilities: 'Wi-Fi', description: 'Room', latitude: '', longitude: '', new_image_url: '', new_photo_label: 'Bedroom', availability: 'Available' };
  const form = {};
  let saved;
  const errors = [];
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload(); });
    }
  }
  const context = vm.createContext({
    session: { user: { role: 'Owner' } }, Blob, FileReader: Reader,
    FormData: class {
      getAll(name) { return name === 'image_file' ? [image] : []; }
      entries() { return Object.entries(fields); }
      get(name) { return fields[name]; }
    },
    esc: String, openModal() {}, closeModal() {}, initLocationPicker() {}, loadProperties() {},
    toast: message => errors.push(message),
    $: () => form,
    api: async (route, options) => { saved = { route, ...JSON.parse(options.body) }; return { message: 'Saved' }; }
  });
  vm.runInContext(typeSource + '\n' + formSource, context);
  await context.showListingForm();
  await form.onsubmit({ preventDefault() {}, target: form });
  assert.ok(saved, errors.join('; '));
  assert.equal(saved.route, '/properties');
  assert.ok(saved.image_url.startsWith('data:image/jpeg;base64,'));
  assert.equal(Buffer.from(saved.image_url.split(',')[1], 'base64').length, image.size);
  assert.deepEqual(saved.image_labels, ['Bedroom']);
});
