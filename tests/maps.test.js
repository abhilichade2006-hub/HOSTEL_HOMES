const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'maps.js'), 'utf8');

test('map links distinguish a saved pin from an unpinned locality', () => {
  const maps = vm.createContext({});
  vm.runInContext(source, maps);
  assert.equal(maps.hasMapPin({ latitude: null, longitude: null }), false);
  assert.equal(maps.hasMapPin({ latitude: 0, longitude: 0 }), true);
  assert.equal(maps.hasMapPin({ latitude: '18', longitude: 73 }), false);
  const unpinned = { locality: 'A&B "Road"', city: 'Pune' };
  assert.ok(maps.mapLink(unpinned).endsWith(encodeURIComponent('A&B "Road", Pune')));
  assert.doesNotMatch(maps.propertyMapSection(unpinned), /id="propertyMap"/);
  assert.match(maps.propertyMapSection({ latitude: 0, longitude: 0 }), /mlat=0&mlon=0/);
});

test('location picker stores only a chosen pin, supports clearing, and cleans up its map', () => {
  const elements = Object.fromEntries(['pinLatitude', 'pinLongitude', 'pinStatus', 'clearPin', 'useMapCentre', 'pinMap'].map(id => [id, { value: '' }]));
  const events = {};
  let removed = false;
  let markers = 0;
  const map = { setView() { return this; }, on(event, fn) { events[event] = fn; }, getCenter() { return { lat: 18.5, lng: 73.8 }; }, removeLayer() {}, remove() { removed = true; } };
  const maps = vm.createContext({
    document: { getElementById: id => elements[id] },
    L: {
      map: () => map,
      tileLayer: () => ({ addTo() {} }),
      latLng: point => ({ wrap: () => Array.isArray(point) ? { lat: point[0], lng: point[1] } : point }),
      marker: point => { markers++; return { addTo() { return this; }, on() {}, setLatLng() {} }; }
    }
  });
  vm.runInContext(source, maps);
  maps.initLocationPicker();
  assert.equal(markers, 0);
  assert.equal(elements.pinLatitude.value, '');
  elements.useMapCentre.onclick();
  assert.equal(elements.pinLatitude.value, '18.500000');
  assert.equal(elements.pinLongitude.value, '73.800000');
  elements.clearPin.onclick();
  assert.equal(elements.pinLatitude.value, '');
  assert.equal(elements.pinLongitude.value, '');
  events.click({ latlng: { lat: 0, lng: 0 } });
  assert.equal(elements.pinLatitude.value, '0.000000');
  maps.destroyMap();
  assert.equal(removed, true);
});

test('a saved location can still be removed when the map library is unavailable', () => {
  const elements = Object.fromEntries(['pinLatitude', 'pinLongitude', 'pinStatus', 'clearPin', 'useMapCentre', 'pinMap'].map(id => [id, { value: '' }]));
  elements.pinLatitude.value = '18.5';
  elements.pinLongitude.value = '73.8';
  const maps = vm.createContext({ document: { getElementById: id => elements[id] } });
  vm.runInContext(source, maps);
  maps.initLocationPicker();
  assert.equal(elements.clearPin.disabled, false);
  assert.equal(elements.useMapCentre.disabled, true);
  assert.match(elements.pinStatus.textContent, /Map unavailable/);
  elements.clearPin.onclick();
  assert.equal(elements.pinLatitude.value, '');
  assert.equal(elements.pinLongitude.value, '');
});
