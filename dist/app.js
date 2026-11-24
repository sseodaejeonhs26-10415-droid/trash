/* 서버·빌드 도구 없는 연습용 웹앱. 핵심 데이터는 localStorage에 저장합니다. */
const $ = id => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000;
const KEY = 'gildam-v1';
const HOME = { lat: 37.5665, lng: 126.9780 };
const trashIcon = '<svg viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 17h10l1-17M10 10v9m4-9v9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const escapeHTML = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validPoint = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
function distance(a, b) {
  const rad = n => n * Math.PI / 180;
  const d = Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, d)));
}
const meters = m => m < 1000 ? `${Math.round(m)}m` : `${(m/1000).toFixed(1)}km`;
const dateText = t => new Date(t).toLocaleString('ko-KR');
let storageOK = true;
let state;
try {
  state = JSON.parse(localStorage.getItem(KEY));
  if (!state) state = { userId: crypto.randomUUID(), bins: INITIAL_BINS.map(b => ({ ...b, source: '예시 위치' })), reports: [], full: {} };
  if (!Array.isArray(state.bins) || !Array.isArray(state.reports) || !state.full || !state.userId || state.bins.some(b => !validPoint(b))) throw Error('잘못된 저장 데이터');
} catch {
  storageOK = false;
  state = { userId: crypto.randomUUID(), bins: INITIAL_BINS.map(b => ({ ...b, source: '예시 위치' })), reports: [], full: {} };
}
let origin = { ...HOME }, selected = null, picking = false, nearestBin = null, toastTimer;
let photoGPS = null, photoData = null, photoBusy = false, photoGeneration = 0;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').hidden = true, 5500);
}
// 저장 실패 시 메모리 상태도 되돌려, 저장되지 않은 승인·보상을 표시하지 않습니다.
function commit(change) {
  const next = structuredClone(state);
  change(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); state = next; return true; }
  catch { toast('기기 저장 공간이 부족하거나 저장이 차단되어 반영하지 못했어요.'); return false; }
}
const isFull = b => state.full[b.id]?.expiresAt > Date.now();
function expireFull() {
  const expired = Object.keys(state.full).filter(id => state.full[id].expiresAt <= Date.now());
  if (expired.length) commit(s => expired.forEach(id => delete s.full[id]));
}

const map = L.map('map', { zoomControl: false }).setView([HOME.lat, HOME.lng], 16);
L.control.zoom({ position: 'topright' }).addTo(map);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
tiles.on('tileerror', () => $('map-error').hidden = false);
tiles.on('load', () => { /* 지도 실패 안내는 다음 정상 타일에서 해제합니다. */ });
tiles.on('tileload', () => $('map-error').hidden = true);
const markerLayer = L.layerGroup().addTo(map);
const markers = new Map();
const userMarker = L.marker([origin.lat, origin.lng], { title: '거리 계산 기준 위치', alt: '거리 계산 기준 위치', icon: L.divIcon({ className: 'user-pin', iconSize: [17,17] }), zIndexOffset: 1000 }).addTo(map).bindTooltip('거리 계산 기준 위치');
let radiusCircle = L.circle([origin.lat, origin.lng], { radius: 1000, color: '#5e9970', weight: 1, opacity: .3, fillOpacity: .025 }).addTo(map);

function visibleBins() {
  const query = $('search').value.trim().toLowerCase();
  return state.bins.map(b => ({...b, distance: distance(origin, b)}))
    .filter(b => b.distance <= Number($('radius').value) && b.name.toLowerCase().includes(query) && (!$('available').checked || !isFull(b)))
    .sort((a,b) => a.distance - b.distance);
}
function render() {
  const bins = visibleBins();
  nearestBin = bins.find(b => !isFull(b));
  $('count').textContent = bins.length;
  $('list').innerHTML = bins.length ? bins.map(b => `
    <button class="bin-card ${b.id === selected ? 'selected' : ''}" data-id="${escapeHTML(b.id)}" aria-label="${escapeHTML(b.name)}, ${meters(b.distance)}, ${isFull(b) ? '가득 참' : '상태 제보 없음'}">
      <span class="bin-symbol">${trashIcon}</span><span class="bin-card-content">
        ${b.id === nearestBin?.id ? '<span class="nearest-tag">가장 가까운 이용 가능 위치</span>' : ''}
        <span class="card-top"><span class="card-name">${escapeHTML(b.name)}</span><span class="distance">${meters(b.distance)}</span></span>
        <span class="card-meta"><span class="status ${isFull(b) ? 'full' : ''}">${isFull(b) ? '가득 참' : '이용 가능'}</span><span>${escapeHTML(b.source || '사용자 제보')} · 길가</span></span>
      </span>
    </button>`).join('') : '<p class="empty">조건에 맞는 쓰레기통이 없어요.<br>반경을 넓히거나 검색 조건을 바꿔보세요.<br>현재 데이터는 서울시청 주변 예시입니다.</p>';
  $('nearest-title').textContent = nearestBin ? `가까운 쓰레기통까지 ${meters(nearestBin.distance)}` : '이용 가능한 쓰레기통이 없어요';
  $('nearest-text').textContent = nearestBin ? `${nearestBin.name} · 직선거리 기준` : '반경이나 검색 조건을 바꿔보세요.';
  $('nearest').disabled = !nearestBin;
  markerLayer.clearLayers(); markers.clear();
  bins.forEach(b => {
    const marker = L.marker([b.lat,b.lng], { title: b.name, alt: b.name, icon: L.divIcon({ className: `bin-pin ${isFull(b) ? 'is-full' : ''} ${b.id === nearestBin?.id ? 'is-nearest' : ''}`, html: `<span class="pin-body">${trashIcon}</span>`, iconSize: [38,44], iconAnchor: [19,44] }) });
    marker.bindTooltip(escapeHTML(b.name), { direction: 'top', offset: [0,-36] });
    marker.on('click', () => selectBin(b.id));
    marker.addTo(markerLayer); markers.set(b.id,marker);
  });
  radiusCircle.setLatLng([origin.lat,origin.lng]);
  const radius = Number($('radius').value);
  radiusCircle.setRadius(Number.isFinite(radius) ? radius : 0);
  renderActivity();
}
function selectBin(id) {
  const b = state.bins.find(b => b.id === id);
  if (!b || !markers.has(id)) return;
  selected = id;
  const wrap = document.createElement('div');
  const full = isFull(b);
  const routeURL = `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=walking`;
  wrap.innerHTML = `<h3>${escapeHTML(b.name)}</h3><span class="status ${full ? 'full' : ''}">${full ? '가득 참' : '이용 가능 · 상태 제보 없음'}</span><p class="popup-meta">기준 위치에서 ${meters(distance(origin,b))} · 직선거리<br>${full ? `표시 해제: ${dateText(state.full[id].expiresAt)}` : escapeHTML(b.source || '사용자 제보')}</p><div class="popup-actions"><a href="${routeURL}" target="_blank" rel="noopener noreferrer">도보 길 안내</a><button type="button">가득 참 제보</button></div>`;
  wrap.querySelector('button').onclick = () => reportFull(id);
  markers.get(id).bindPopup(wrap).openPopup();
  map.panTo([b.lat,b.lng]);
  document.querySelectorAll('.bin-card').forEach(card => card.classList.toggle('selected', card.dataset.id === id));
}
function reportFull(id) {
  const b = state.bins.find(b => b.id === id);
  if (!b) return;
  if (isFull(b)) return toast('이미 제보된 쓰레기통이에요. 기존 만료 시각을 유지해요.');
  const now = Date.now();
  if (!commit(s => s.full[id] = { userId: s.userId, reportedAt: now, expiresAt: now + DAY })) return;
  map.closePopup(); render();
  toast('가득 참을 알려주셔서 고마워요. 24시간 후 자동 해제돼요.');
}
function setOrigin(point, note) {
  origin = point;
  userMarker.setLatLng([point.lat,point.lng]);
  $('location-note').textContent = note;
  map.setView([point.lat,point.lng],16);
  render();
}
$('locate').onclick = () => {
  if (!navigator.geolocation) return toast('위치를 사용할 수 없어요. 지도에서 기준 위치를 선택해주세요.');
  $('locate').disabled = true; $('locate').textContent = '위치 확인 중…';
  navigator.geolocation.getCurrentPosition(p => {
    $('locate').disabled = false; $('locate').textContent = '◎ 내 위치로 찾기';
    setOrigin({lat:p.coords.latitude,lng:p.coords.longitude}, `내 위치 기준 · GPS 오차 약 ${Math.round(p.coords.accuracy)}m`);
  }, () => {
    $('locate').disabled = false; $('locate').textContent = '◎ 내 위치로 찾기';
    $('location-note').textContent = '위치를 확인하지 못했어요. 지도를 눌러 기준 위치를 선택해주세요.';
    toast('위치 권한이나 GPS를 확인해주세요. 지도에서 직접 선택할 수도 있어요.');
  }, {enableHighAccuracy:true,timeout:10000,maximumAge:30000});
};
map.on('click', e => {
  if (picking) {
    picking = false;
    $('latitude').value = e.latlng.lat.toFixed(6); $('longitude').value = e.latlng.lng.toFixed(6);
    $('report-dialog').showModal();
    toast('제보 위치를 선택했어요. 사진 속 위치와 함께 확인해주세요.');
  } else setOrigin({lat:e.latlng.lat,lng:e.latlng.lng}, '지도에서 선택한 위치 기준 · 실제 내 위치와 다를 수 있어요.');
});
$('nearest').onclick = () => { if (nearestBin) selectBin(nearestBin.id); };
$('list').onclick = e => { const card = e.target.closest('[data-id]'); if (card) selectBin(card.dataset.id); };
['search','available','radius'].forEach(id => $(id).addEventListener('input', () => { map.closePopup(); render(); }));
$('map-tab').onclick = () => { $('map').scrollIntoView({behavior:'smooth',block:'center'}); map.invalidateSize(); };
function openReport() {
  picking = false;
  $('report-error').textContent = '';
  if (!$('latitude').value) { $('latitude').value = origin.lat.toFixed(6); $('longitude').value = origin.lng.toFixed(6); }
  $('report-dialog').showModal();
}
$('report-top').onclick = openReport; $('report-bottom').onclick = openReport;
$('pick-point').onclick = () => { picking = true; $('report-dialog').close(); toast('지도에서 쓰레기통 위치를 눌러주세요.'); $('map').scrollIntoView({behavior:'smooth',block:'center'}); };
$('activity').onclick = () => { renderActivity(); $('activity-dialog').showModal(); };
$('help').onclick = () => $('help-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

// 원본 EXIF를 읽은 다음 저장용 미리보기만 작게 만듭니다. 원본은 업로드하지 않습니다.
async function thumbnail(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bitmap.width,bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width*scale); canvas.height = Math.round(bitmap.height*scale);
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg',.65);
}
$('photo').onchange = async () => {
  const generation = ++photoGeneration;
  photoBusy = false; $('submit-report').disabled = false;
  photoGPS = photoData = null; $('photo-preview').hidden = true; $('report-error').textContent = '';
  const file = $('photo').files[0];
  if (!file) { $('photo-info').textContent = 'GPS가 포함된 JPG 사진을 선택해주세요.'; return; }
  if (file.type !== 'image/jpeg' || file.size > 8*1024*1024) {
    $('report-error').textContent = '8MB 이하의 JPG 사진을 선택해주세요.'; $('photo').value = ''; return;
  }
  photoBusy = true; $('submit-report').disabled = true; $('photo-info').textContent = '사진의 위치 정보를 확인하고 있어요…';
  try {
    const gps = await exifr.gps(file);
    if (generation !== photoGeneration) return;
    if (!gps || !validPoint({lat:gps.latitude,lng:gps.longitude})) throw Error('사진에 GPS 위치 정보가 없어요. 카메라 위치 태그를 켜고 다시 촬영해주세요.');
    const preview = await thumbnail(file);
    if (generation !== photoGeneration) return;
    photoGPS = {lat:gps.latitude,lng:gps.longitude}; photoData = preview;
    $('photo-preview').src = preview; $('photo-preview').hidden = false;
    $('photo-info').textContent = `사진 GPS 확인: ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
  } catch (e) {
    if (generation !== photoGeneration) return;
    $('report-error').textContent = e.message?.includes('GPS') ? e.message : '사진을 읽지 못했어요. GPS가 포함된 정상 JPG를 선택해주세요.';
    $('photo-info').textContent = '사진 확인 실패 · 다른 사진을 선택해주세요.';
  } finally { if (generation === photoGeneration) { photoBusy = false; $('submit-report').disabled = false; } }
};
$('report-form').onsubmit = e => {
  e.preventDefault();
  const fail = message => $('report-error').textContent = message;
  const name = $('bin-name').value.trim();
  const point = {lat:Number($('latitude').value),lng:Number($('longitude').value)};
  if (!name) return fail('쓰레기통 이름을 입력해주세요.');
  if (!validPoint(point)) return fail('올바른 위도와 경도를 입력해주세요.');
  if (photoBusy || !photoGPS || !photoData) return fail('GPS가 포함된 사진 확인을 먼저 완료해주세요.');
  if (!$('outdoor').checked) return fail('길가에 설치된 쓰레기통인지 확인해주세요.');
  if (distance(photoGPS,point) > 100) return fail('사진 속 위치와 제보 위치가 100m 넘게 떨어져 있어요. 쓰레기통 앞에서 다시 촬영하거나 제보 위치를 고쳐주세요.');
  const existing = [...state.bins,...state.reports.filter(r => r.status === 'pending')];
  if (existing.some(b => distance(point,b) < 25)) return fail('25m 이내에 이미 등록되었거나 검토 중인 쓰레기통이 있어요. 중복 제보는 보상에 포함되지 않아요.');
  const report = {id:crypto.randomUUID(),name,...point,photoGPS,photo:photoData,status:'pending',createdAt:Date.now()};
  if (!commit(s => s.reports.push(report))) return;
  $('report-dialog').close(); $('report-form').reset();
  photoData = photoGPS = null; $('photo-preview').hidden = true; $('photo-preview').removeAttribute('src');
  $('photo-info').textContent = '사진은 이 브라우저에만 저장됩니다. 기기의 카메라 위치 태그를 켜주세요.';
  renderActivity(); toast('위치 확인 완료! 실제 존재·야외 설치 여부 검토 후 지도에 반영돼요.');
};

function renderActivity() {
  const approved = state.reports.filter(r => r.status === 'approved').length;
  const points = Math.floor(approved/5)*100;
  $('report-count').textContent = approved;
  $('progress').value = approved && approved%5 === 0 ? 5 : approved%5;
  $('reward-text').textContent = approved >= 5 ? `🌱 거리 지킴이 배지 · ${points}P · 다음 보상까지 ${5-approved%5}건` : `5건 승인 시 100P와 거리 지킴이 배지 · 앞으로 ${5-approved}건`;
  const labels = {pending:'검토 대기',approved:'승인 · 지도 반영',rejected:'반려 · 재제보 가능'};
  $('reports-list').innerHTML = state.reports.length ? [...state.reports].reverse().map(r => `<div class="report-entry"><strong>${escapeHTML(r.name)}</strong><p>${labels[r.status]} · ${dateText(r.createdAt)}${r.reason ? `<br>${escapeHTML(r.reason)}` : ''}</p></div>`).join('') : '<p class="hint">아직 제보가 없어요. 발견한 길가 쓰레기통을 알려주세요.</p>';
  $('review-list').innerHTML = state.reports.filter(r => r.status === 'pending').map(r => `<div class="report-entry"><strong>${escapeHTML(r.name)}</strong><p>사진 GPS 차이 ${meters(distance(r,r.photoGPS))} · ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</p><img class="review-photo" src="${escapeHTML(r.photo)}" alt="${escapeHTML(r.name)} 제보 사진"><div class="review-actions"><button data-review="approve" data-id="${escapeHTML(r.id)}">야외 확인 · 승인</button><button data-review="reject" data-id="${escapeHTML(r.id)}">반려</button></div></div>`).join('') || '<p class="hint">검토를 기다리는 제보가 없어요.</p>';
}
$('review-list').onclick = e => {
  const button = e.target.closest('[data-review]');
  if (!button) return;
  const report = state.reports.find(r => r.id === button.dataset.id && r.status === 'pending');
  if (!report) return;
  const approve = button.dataset.review === 'approve';
  if (approve && state.bins.some(b => distance(b,report) < 25)) return toast('이미 가까운 위치가 등록되어 있어 승인할 수 없어요.');
  if (!commit(s => {
    const r = s.reports.find(r => r.id === report.id);
    r.status = approve ? 'approved' : 'rejected';
    if (approve) s.bins.push({id:r.id,name:r.name,lat:r.lat,lng:r.lng,source:'사용자 제보 · 시연 승인'});
    else r.reason = '사진에서 길가 쓰레기통임을 확인하지 못했어요. 위치와 사진을 확인해 다시 제보해주세요.';
  })) return;
  render(); toast(approve ? '시연 승인 완료! 지도에 반영하고 제보 횟수를 늘렸어요.' : '반려 처리했어요. 보상 횟수에 포함되지 않아요.');
};
function refreshExpired() { expireFull(); render(); }
setInterval(refreshExpired,60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshExpired(); });
window.addEventListener('storage', e => { if(e.key === KEY && e.newValue) { try { const incoming=JSON.parse(e.newValue); if(Array.isArray(incoming.bins) && Array.isArray(incoming.reports) && incoming.full) { state=incoming; render(); } } catch { /* 다른 탭의 잘못된 값은 무시 */ } } });
expireFull(); render();
if (!storageOK) toast('저장된 기록을 읽지 못했어요. 예시 지도로 시작합니다.');
