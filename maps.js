let activeMap = null;

function destroyMap() {
  if (activeMap) { activeMap.remove(); activeMap = null; }
}

function hasMapPin(property) {
  return Number.isFinite(property?.latitude) && Number.isFinite(property?.longitude);
}

function mapLink(property) {
  return hasMapPin(property)
    ? `https://www.openstreetmap.org/?mlat=${property.latitude}&mlon=${property.longitude}#map=16/${property.latitude}/${property.longitude}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(property.locality + ', ' + property.city)}`;
}

function propertyMapSection(property) {
  return `<section class="detail-section"><h3>Location</h3><p class="muted">${hasMapPin(property) ? 'Location pin provided by the property owner.' : 'No property pin added yet. You can explore the locality on the map.'}</p>${hasMapPin(property) ? '<div id="propertyMap" class="property-map" aria-label="Property location map"></div>' : ''}<a class="map-link" href="${mapLink(property)}" target="_blank" rel="noopener">Open in OpenStreetMap ↗</a></section>`;
}

function createRoomMap(element, centre, zoom) {
  const map = L.map(element, { scrollWheelZoom: false }).setView(centre, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  activeMap = map;
  return map;
}

function initPropertyMap(property) {
  const element = document.getElementById('propertyMap');
  if (!element) return;
  if (typeof L === 'undefined') { element.textContent = 'Map unavailable. Use the map link below.'; return; }
  const map = createRoomMap(element, [property.latitude, property.longitude], 15);
  L.marker([property.latitude, property.longitude]).addTo(map);
}

function dashboardMapSection(properties) {
  const pinned = properties.filter(hasMapPin).length;
  const description = properties.length === 0
    ? 'Add a property and save its location to show it here.'
    : pinned === 0
      ? 'No location pins saved yet. Edit a listing below to add its location.'
      : `${pinned} of ${properties.length} listings have location pins. Select a numbered pin to view or edit a listing.`;
  return `<section class="dashboard-map-section" aria-labelledby="dashboardMapHeading"><div class="dashboard-map-heading"><h3 id="dashboardMapHeading">Property map</h3><span>${pinned} pinned</span></div><p class="muted">${description}</p><div id="dashboardMap" class="property-map dashboard-map" aria-label="Map of property listings"></div></section>`;
}

function initDashboardMap(properties, onEdit) {
  const element = document.getElementById('dashboardMap');
  if (!element) return;
  if (typeof L === 'undefined') { element.textContent = 'Map unavailable. You can still manage your listings below.'; return; }
  const pinned = properties.filter(hasMapPin);
  const first = pinned[0];
  const map = createRoomMap(element, first ? [first.latitude, first.longitude] : [18.5204, 73.8567], first ? 14 : 11);
  pinned.forEach((property, index) => {
    const popup = document.createElement('div');
    popup.className = 'dashboard-map-popup';
    const title = document.createElement('strong');
    title.textContent = property.title;
    const details = document.createElement('p');
    details.textContent = `${property.locality}, ${property.city} · ${property.status} · ${property.availability}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'smallbtn';
    edit.textContent = 'Edit listing';
    edit.onclick = () => onEdit(property);
    popup.append(title, details, edit);
    const icon = L.divIcon({ className: 'dashboard-map-marker', html: String(index + 1), iconSize: [28, 28], iconAnchor: [14, 28] });
    L.marker([property.latitude, property.longitude], { title: property.title, icon }).addTo(map).bindPopup(popup);
  });
  if (pinned.length > 1) map.fitBounds(L.latLngBounds(pinned.map(property => [property.latitude, property.longitude])), { padding: [24, 24], maxZoom: 15 });
}

function initLocationPicker() {
  const element = document.getElementById('pinMap');
  if (!element || activeMap) return;
  const latitude = document.getElementById('pinLatitude');
  const longitude = document.getElementById('pinLongitude');
  const status = document.getElementById('pinStatus');
  const clear = document.getElementById('clearPin');
  const existing = latitude.value !== '' && longitude.value !== '';
  let map, marker;
  clear.disabled = !existing;
  clear.onclick = () => {
    if (marker) { map.removeLayer(marker); marker = null; }
    latitude.value = ''; longitude.value = ''; clear.disabled = true;
    status.textContent = 'No pin selected.';
  };
  if (typeof L === 'undefined') {
    document.getElementById('useMapCentre').disabled = true;
    status.textContent = 'Map unavailable. You can save the listing and add a location later.';
    return;
  }
  const centre = existing ? [Number(latitude.value), Number(longitude.value)] : [18.5204, 73.8567];
  map = createRoomMap(element, centre, existing ? 15 : 11);
  function setPin(point) {
    point = L.latLng(point).wrap();
    latitude.value = point.lat.toFixed(6);
    longitude.value = point.lng.toFixed(6);
    if (marker) marker.setLatLng(point);
    else { marker = L.marker(point, { draggable: true }).addTo(map); marker.on('dragend', () => setPin(marker.getLatLng())); }
    status.textContent = 'Pin added. You can drag it to adjust the location.';
    clear.disabled = false;
  }
  if (existing) setPin(centre);
  map.on('click', event => setPin(event.latlng));
  document.getElementById('useMapCentre').onclick = () => setPin(map.getCenter());
}
