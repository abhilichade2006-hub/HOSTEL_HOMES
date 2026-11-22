const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const formSource = appSource.slice(appSource.indexOf('async function showListingForm('), appSource.indexOf('\nfunction enquiryDate('));

for (const role of ['Owner', 'Admin']) {
  for (const editing of [false, true]) {
    test(`${role} ${editing ? 'edit' : 'create'} form shows the map beside the address`, async () => {
      let html, initialized = false;
      const context = vm.createContext({
        session: { user: { id: 1, name: 'Account', role } },
        api: async () => ({ owners: [] }),
        esc: String,
        openModal: markup => { html = markup; },
        initLocationPicker: () => { initialized = true; },
        $: () => ({})
      });
      vm.runInContext(formSource, context);
      await context.showListingForm(editing ? { id: 1, owner_id: 1, latitude: 0, longitude: 73.8, images: ['https://example.com/room.jpg'] } : null);
      assert.equal(initialized, true);
      assert.match(html, /<section[^>]*id="locationPicker"/);
      assert.doesNotMatch(html, /<details[^>]*id="locationPicker"/);
      assert.ok(html.indexOf('name="locality"') < html.indexOf('id="locationPicker"'));
      assert.ok(html.indexOf('id="locationPicker"') < html.indexOf('name="facilities"'));
      assert.match(html, /id="pinMap"/);
      const acceptedPhotos = html.match(/name="image_file"[^>]*accept="([^"]+)"/)[1].split(',');
      assert.ok(acceptedPhotos.includes('.jpg'));
      assert.ok(acceptedPhotos.includes('.jpeg'));
      if (editing) {
        assert.match(html, /id="pinLatitude" value="0"/);
        assert.match(html, /id="pinLongitude" value="73\.8"/);
      }
    });
  }
}
