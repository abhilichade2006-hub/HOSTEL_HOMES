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

function initLocationPicker() {
  const details = document.getElementById('locationPicker');
  details.addEventListener('toggle', () => {
    if (!details.open || activeMap) return;
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
    map = createRoomMap(document.getElementById('pinMap'), centre, existing ? 15 : 11);
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
  });
}
