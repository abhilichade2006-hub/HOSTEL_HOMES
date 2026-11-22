const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const dashboardSource = appSource.slice(appSource.indexOf('async function dashboard('), appSource.indexOf('\nfunction bindDashboard('));
const mapSource = fs.readFileSync(path.join(__dirname, '..', 'maps.js'), 'utf8');

for (const role of ['Owner', 'Admin', 'User']) {
  test(`${role} dashboard keeps the property map outside the listing form`, async () => {
    const rooms = [{ id: 1, title: 'Room', status: 'Approved', rent: 5000, locality: 'Wakad', city: 'Pune', latitude: 18.5, longitude: 73.8 }];
    let html, mappedRooms, editRoom;
    const edited = [];
    const requests = [];
    const context = vm.createContext({
      session: { user: { id: 1, name: 'Account', role } },
      showAllAdminListings: false,
      api: async route => { requests.push(route); return route.includes('overview') ? { users: 1, properties: 1, pending: 0 } : { properties: rooms, enquiries: [] }; },
      esc: String, money: value => String(value), enquiryItem: () => '', loadNotifications() {}, bindDashboard() {},
      openModal: markup => { html = markup; },
      showListingForm: room => edited.push(room.id),
      $: () => ({ querySelectorAll: () => [], addEventListener() {} })
    });
    vm.runInContext(mapSource, context);
    context.initDashboardMap = (properties, onEdit) => { mappedRooms = properties; editRoom = onEdit; };
    vm.runInContext(dashboardSource, context);
    await context.dashboard();
    if (role === 'User') {
      assert.doesNotMatch(html, /id="dashboardMap"/);
      assert.equal(mappedRooms, undefined);
    } else {
      assert.match(html, /id="dashboardMap"/);
      assert.doesNotMatch(html, /id="listingForm"/);
      assert.ok(html.indexOf('id="dashboardMap"') < html.indexOf('id="addListing"'));
      assert.equal(mappedRooms, rooms);
      editRoom(rooms[0]);
      assert.deepEqual(edited, [1]);
      assert.ok(requests.includes(role === 'Admin' ? '/admin/properties' : '/owner/properties'));
    }
  });
}
