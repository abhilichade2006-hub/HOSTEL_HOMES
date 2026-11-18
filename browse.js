const comparedRooms = new Map();

function moveInCost(property) {
  return Number(property.rent) + Number(property.deposit);
}

function roomShareUrl(id) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('room', id);
  return url.href;
}

function sharedRoomId(search = window.location.search) {
  const id = Number(new URLSearchParams(search).get('room'));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function toggleCompare(property) {
  if (comparedRooms.has(property.id)) comparedRooms.delete(property.id);
  else {
    if (comparedRooms.size === 3) { toast('Compare up to 3 rooms. Remove one to add another.'); return; }
    comparedRooms.set(property.id, property);
  }
  updateCompareBar();
}

function updateCompareBar() {
  const count = comparedRooms.size;
  $('compareBar').hidden = count === 0;
  document.body.classList.toggle('has-comparison', count > 0);
  $('compareCount').textContent = `${count} of 3 rooms selected`;
  $('showCompare').disabled = count < 2;
  $('compareSelections').innerHTML = [...comparedRooms.values()].map(p => `<button class="compare-pill" data-remove-compare="${p.id}" aria-label="Remove ${esc(p.title)} from comparison">${esc(p.title)} <span aria-hidden="true">×</span></button>`).join('');
  $('compareSelections').querySelectorAll('[data-remove-compare]').forEach(button => button.onclick = () => toggleCompare(comparedRooms.get(Number(button.dataset.removeCompare))));
  document.querySelectorAll('[data-compare]').forEach(button => {
    const selected = comparedRooms.has(Number(button.dataset.compare));
    button.textContent = selected ? '✓ Selected' : 'Compare';
    button.setAttribute('aria-pressed', String(selected));
  });
}

function comparisonTable(rooms) {
  const rows = [
    ['Monthly rent', p => money(p.rent)],
    ['Deposit', p => money(p.deposit)],
    ['First month + deposit', p => money(moveInCost(p))],
    ['Room type', p => p.type],
    ['Location', p => `${p.locality}, ${p.city}`],
    ['Preference', p => p.gender],
    ['Availability', p => p.availability],
    ['Amenities', p => p.facilities.join(', ') || 'None listed']
  ];
  return `<div class="comparison-scroll" role="region" aria-label="Room comparison" tabindex="0"><table class="comparison-table"><caption class="sr-only">Selected rooms compared by price, location and amenities</caption><thead><tr><th scope="col">Details</th>${rooms.map(p => `<th scope="col"><button class="comparison-room" data-compare-open="${p.id}">${esc(p.title)} ↗</button></th>`).join('')}</tr></thead><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${label}</th>${rooms.map(p => `<td>${esc(value(p))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

async function showComparison() {
  const ids = [...comparedRooms.keys()];
  if (ids.length < 2) { toast('Select at least 2 rooms to compare.'); return; }
  $('showCompare').disabled = true;
  try {
    const rooms = await Promise.all(ids.map(async id => (await api('/properties/' + id)).property));
    if (!ids.every(id => comparedRooms.has(id))) return;
    openModal(`<div class="eyebrow">FIND YOUR FIT</div><h2>Compare rooms</h2><p class="muted">Check the costs and amenities side by side. Select a room name for full details.</p>${comparisonTable(rooms)}<p class="muted">The estimate includes first month's rent and deposit. Confirm other charges with the owner.</p>`);
    $('modalBody').querySelectorAll('[data-compare-open]').forEach(button => button.onclick = () => showProperty(Number(button.dataset.compareOpen)));
  } catch (error) {
    toast(`Could not compare rooms: ${error.message} Remove an unavailable room or try again.`);
  } finally { $('showCompare').disabled = comparedRooms.size < 2; }
}

async function copyRoomLink(input) {
  try {
    if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
    await navigator.clipboard.writeText(input.value);
    toast('Room link copied.');
  } catch {
    input.focus(); input.select();
    toast('Select and copy the room link above.');
  }
}

function showRoomShare(property) {
  openModal(`<div class="eyebrow">SHARE THIS STAY</div><h2>Share ${esc(property.title)}</h2><p class="muted">This link opens the room's details directly. You can send it to a friend or family member.</p><label class="share-label">Room link<input id="roomShareLink" type="url" readonly value="${esc(roomShareUrl(property.id))}"></label><div class="room-actions"><button class="btn dark" id="copyRoomLink">Copy link</button><button class="btn ghost" id="backToRoom">Back to room</button></div>`);
  $('roomShareLink').onclick = () => $('roomShareLink').select();
  $('copyRoomLink').onclick = () => copyRoomLink($('roomShareLink'));
  $('backToRoom').onclick = () => showProperty(property.id);
}

function initBrowseTools() {
  $('showCompare').onclick = showComparison;
  $('clearCompare').onclick = () => { comparedRooms.clear(); updateCompareBar(); };
  updateCompareBar();
}
