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

test('dashboard map section explains missing pins and handles a missing map library', () => {
  const element = {};
  const maps = vm.createContext({ document: { getElementById: () => element } });
  vm.runInContext(source, maps);
  assert.match(maps.dashboardMapSection([]), /Add a property/);
  assert.match(maps.dashboardMapSection([{ latitude: null, longitude: null }]), /No location pins saved yet/);
  assert.match(maps.dashboardMapSection([]), /id="dashboardMap"/);
  maps.initDashboardMap([], () => {});
  assert.match(element.textContent, /Map unavailable/);
});

function dashboardMapFixture() {
  const markers = [];
  const map = {
    setView(centre, zoom) { this.centre = centre; this.zoom = zoom; return this; },
    fitBounds(bounds, options) { this.bounds = bounds; this.boundsOptions = options; },
    remove() { this.removed = true; }
  };
  const maps = vm.createContext({
    document: {
      getElementById: () => ({}),
      createElement: tag => ({ tag, children: [], append(...children) { this.children.push(...children); } })
    },
    L: {
      map: () => map,
      tileLayer: () => ({ addTo() {} }),
      divIcon: options => options,
      latLngBounds: coordinates => coordinates,
      marker: (coordinates, options) => {
        const marker = { coordinates, options, addTo() { return this; }, bindPopup(popup) { this.popup = popup; return this; } };
        markers.push(marker);
        return marker;
      }
    }
  });
  vm.runInContext(source, maps);
  return { maps, map, markers };
}

test('dashboard map uses saved pins, fits their bounds and safely opens the editor', () => {
  const { maps, map, markers } = dashboardMapFixture();
  const properties = [
    { id: 1, title: '<img src=x onerror=alert(1)>', latitude: 0, longitude: 0, locality: 'Centre', city: 'City', status: 'Pending', availability: 'Available' },
    { id: 2, title: 'Room', latitude: 18.5, longitude: 73.8, locality: 'Wakad', city: 'Pune', status: 'Approved', availability: 'Available' },
    { id: 3, latitude: null, longitude: null }
  ];
  let edited;
  maps.initDashboardMap(properties, property => { edited = property.id; });
  assert.equal(markers.length, 2);
  assert.deepEqual(Array.from(markers[0].coordinates), [0, 0]);
  assert.equal(map.bounds.length, 2);
  assert.equal(map.boundsOptions.maxZoom, 15);
  assert.equal(markers[0].options.icon.html, '1');
  assert.equal(markers[0].popup.children[0].textContent, properties[0].title);
  assert.equal('innerHTML' in markers[0].popup.children[0], false);
  markers[0].popup.children[2].onclick();
  assert.equal(edited, 1);
  assert.match(maps.dashboardMapSection(properties), /2 of 3 listings/);
  maps.destroyMap();
  assert.equal(map.removed, true);
});

test('an unpinned dashboard shows a default area without inventing property markers', () => {
  const { maps, map, markers } = dashboardMapFixture();
  maps.initDashboardMap([{ latitude: null, longitude: null }], () => {});
  assert.equal(markers.length, 0);
  assert.deepEqual(Array.from(map.centre), [18.5204, 73.8567]);
  assert.equal(map.zoom, 11);
  assert.equal(map.bounds, undefined);
});
