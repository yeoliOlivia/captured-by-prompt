import { demoMembers, demoPhotos, demoPlaces, demoTrip } from './demo.js';

const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="playground-session"]').content;
let loadGeneration = 0;
let searchGeneration = 0;
let statusInFlight = null;
let jobCheckInFlight = null;
const state = { mode: 'demo', view: 'memories', filter: 'all', query: '', person: null, place: null, sort: 'recent', trip: demoTrip, photos: demoPhotos, trips: [], coverage: null, selected: new Set(), saved: new Set(), importPhotos: [], importSelected: new Set(), importLimit: 60, loading: false, analyzing: false, searching: false, searchResults: null, searchError: null, searchClarification: null, searchBindings: {}, ai: null, aiError: null, analysisJob: null, analysisChecked: false, analysisError: null, pendingAnalysis: null };
const viewNames = { memories: 'Memories', places: 'Places', people: 'Our people', recap: 'The recap', picks: 'The good ones' };
const icons = {
  memories: ['M3 3h6v6H3z', 'M15 3h6v6h-6z', 'M3 15h6v6H3z', 'M15 15h6v6h-6z'],
  places: ['M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0Z', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  people: ['M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', 'M5 21v-3a7 7 0 0 1 14 0v3', 'M19 4a3 3 0 0 1 0 6', 'M22 21v-3a7 7 0 0 0-3-5', 'M5 4a3 3 0 0 0 0 6', 'M2 21v-3a7 7 0 0 1 3-5'],
  recap: ['M5 21V12', 'M12 21V3', 'M19 21V8'],
  picks: ['m12 3 2.8 5.7 6.3.9-4.55 4.45 1.1 6.25L12 17.35l-5.65 2.95 1.1-6.25L2.9 9.6l6.3-.9Z'],
};

function node(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') e.className = value;
    else if (key === 'text') e.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') e.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') e[key] = Boolean(value);
    else e.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null) e.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return e;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const d of icons[name] || icons.memories) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
function safeImage(src) {
  if (typeof src !== 'string') return '';
  if (/^\/photos\/[a-f0-9]{64}$/.test(src) || /^\/studio\/assets\/[a-zA-Z0-9_.-]+$/.test(src)) return src;
  try { const url = new URL(src); return url.protocol === 'https:' && url.hostname === 'images.unsplash.com' ? url.href : ''; } catch { return ''; }
}
function photoImage(photo, attrs = {}) { return node('img', { src: safeImage(photo.image), alt: photo.name || 'Trip photo', loading: 'lazy', decoding: 'async', ...attrs, onerror: e => { e.currentTarget.style.opacity = '.2'; e.currentTarget.alt = 'Photo unavailable'; } }); }
function button(label, attrs = {}) { return node('button', { type: 'button', ...attrs }, label); }
function announce(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(announce.timer); announce.timer = setTimeout(() => { $('toast').hidden = true; }, 4400); }
function members() { return state.trip?.members || []; }
function confirmedMembers(photo) { return (photo.annotation?.members || []).filter(m => m.status === 'confirmed').map(m => m.memberId); }
function memberName(id) { return members().find(m => m.id === id)?.name || 'Unknown member'; }
function avatar(member, extra = {}) { const colors = ['#e7bdb0', '#c3cfb5', '#dec5ab', '#b9c7ce', '#d4bdd2', '#d6d3a2']; return node('span', { class: 'avatar', title: member.name, style: `background:${member.color || colors[members().indexOf(member) % colors.length] || colors[0]}`, ...extra }, member.initials || member.name?.slice(0, 1) || '?'); }
function dateLabel(value) { if (!value) return 'Date not recorded'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
function savedKey() { return `afterglow-shortlist:${state.trip?.id || 'none'}`; }
function loadSaved() { try { const saved = JSON.parse(localStorage.getItem(savedKey()) || '[]'); state.saved = new Set(Array.isArray(saved) ? saved.filter(id => state.photos.some(p => p.id === id)) : []); } catch { state.saved = new Set(); } }
function persistSaved() { try { localStorage.setItem(savedKey(), JSON.stringify([...state.saved])); } catch { announce('Shortlist kept for this session. Browser storage is unavailable.'); } }
function resetFilters() { searchGeneration++; state.searching = false; state.query = ''; state.searchResults = null; state.searchError = null; state.searchClarification = null; state.searchBindings = {}; state.person = null; state.place = null; state.filter = 'all'; $('photo-query').value = ''; }
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-playground-session': token }, body: JSON.stringify(body) });
  let data; try { data = await response.json(); } catch { throw new Error('The workspace did not return a usable response. Make sure the app is running.'); }
  if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
  return data;
}

function providerIdentity(value = state.ai) { return value ? `${value.datasetId}:${value.provider}:${value.model}:${value.dimensions}:${value.observationModel || value.verificationModel}` : ''; }
function observationCurrent(photo) { return photo.annotation?.provenance === 'user' || (state.ai?.observationModel ? photo.annotation?.model === state.ai.observationModel : Boolean(state.ai?.verificationModel && photo.annotation?.model?.startsWith(`${state.ai.verificationModel}/`))); }
function preparationCandidates() { return state.photos.filter(photo => !photo.indexed || !observationCurrent(photo)); }
function analysisStorageKey(tripId = state.trip?.id) { return state.ai && tripId ? `afterglow-preparation:${state.ai.datasetId}:${state.ai.provider}:${tripId}` : null; }
function readPendingAnalysis() {
  try {
    const key = analysisStorageKey(), value = key && JSON.parse(sessionStorage.getItem(key) || 'null');
    return value && /^[a-f0-9-]{36}$/i.test(value.requestId) && Array.isArray(value.photoIds) && value.photoIds.length && value.photoIds.length <= 12 && value.photoIds.every(id => /^[a-f0-9]{64}$/.test(id)) ? value : null;
  } catch { return null; }
}
function writePendingAnalysis(value, key = analysisStorageKey()) {
  state.pendingAnalysis = value;
  try { if (key) value ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key); } catch { /* Server job history remains the source of truth when browser storage is blocked. */ }
}
function persistWorkspaceView() {
  try { sessionStorage.setItem('afterglow-view', JSON.stringify({ mode: state.mode, tripId: state.mode === 'live' ? state.trip?.id || null : null, datasetId: state.ai?.datasetId || null })); } catch { /* Navigation persistence is optional. */ }
}
function renderAIStatus() {
  $('ai-status').hidden = state.mode !== 'live';
  if (state.mode !== 'live') return;
  const ai = state.ai;
  const busy = ai?.analyzing || ai?.indexing || ai?.searching;
  $('ai-status').classList.toggle('connected', Boolean(ai?.configured && !state.aiError));
  $('ai-status-title').textContent = state.aiError ? 'Workspace connection unavailable' : !ai ? 'Checking your workspace…' : ai.configured ? `${ai.providerLabel || ai.provider} · Key loaded` : 'A little AI, when you’re ready.';
  $('ai-status-detail').textContent = state.aiError || (!ai ? 'Checking saved analysis and your model connection.' : `${ai.indexed.toLocaleString()} of ${ai.total.toLocaleString()} workspace photos search-ready${busy ? ' · Model work in progress' : ''}. ${ai.configured ? 'A key is loaded; provider acceptance is checked on use.' : 'Connect your provider to search or prepare photos.'}`);
  $('ai-connect').textContent = ai?.configured ? 'Manage AI ↗' : 'Connect AI ↗';
  $('ai-connect').disabled = !ai || Boolean(state.aiError);
  $('ai-disconnect').hidden = !ai?.configured;
}
async function refreshAIStatus() {
  if (statusInFlight) return statusInFlight;
  statusInFlight = (async () => {
    try {
      const next = await api('/api/studio/status');
      const changed = state.ai && providerIdentity(next) !== providerIdentity();
      const indexedChanged = state.ai && next.indexed !== state.ai.indexed;
      state.ai = next; state.aiError = null;
      if (changed) {
        searchGeneration++; state.searching = false; state.searchResults = null; state.searchClarification = null; state.searchBindings = {}; state.selected.clear();
        if (state.query) state.searchError = 'The connected model changed. Search again using this provider’s saved embeddings.';
        state.analysisChecked = false; state.analysisJob = null; state.pendingAnalysis = readPendingAnalysis();
      }
      renderAIStatus();
      if (state.mode === 'live' && state.trip && (changed || indexedChanged) && !state.loading) await loadTrip(state.trip.id);
      return next;
    } catch (error) { state.aiError = error.message; renderAIStatus(); return null; }
    finally { statusInFlight = null; }
  })();
  return statusInFlight;
}
function updateProviderNote() {
  $('ai-provider-note').textContent = $('ai-provider').value === 'qwen' ? 'Use an Alibaba Cloud Model Studio key for the configured Beijing endpoint. Qwen and Gemini keep separate image indexes.' : 'Use a Gemini API key. The saved sample bundle already contains Gemini image embeddings.';
}
async function openAIConnection() {
  await refreshAIStatus();
  $('ai-error').textContent = ''; $('ai-key').value = ''; $('ai-provider').value = state.ai?.provider || 'gemini'; updateProviderNote();
  $('ai-dialog').showModal();
}
async function checkAnalysisJobs({ refreshPhotos = true } = {}) {
  const tripId = state.trip?.id, identity = providerIdentity();
  if (state.mode !== 'live' || !tripId || !state.ai) return;
  if (jobCheckInFlight?.tripId === tripId && jobCheckInFlight.identity === identity) return jobCheckInFlight.promise;
  const promise = (async () => {
    try {
      const result = await api(`/api/studio/trips/${encodeURIComponent(tripId)}/analysis`);
      if (state.mode !== 'live' || state.trip?.id !== tripId || identity !== providerIdentity()) return;
      const previous = state.analysisJob;
      const pending = state.pendingAnalysis || readPendingAnalysis();
      const jobs = result.jobs || [];
      const job = jobs.find(item => item.status === 'running') || (pending ? jobs.find(item => item.id === pending.requestId) : jobs[0]) || null;
      state.analysisJob = job; state.analysisChecked = true; state.analysisError = null;
      state.pendingAnalysis = pending;
      if (pending && jobs.some(item => item.id === pending.requestId && item.status !== 'running')) writePendingAnalysis(null);
      state.analyzing = job?.status === 'running';
      if (pending && !jobs.some(item => item.id === pending.requestId)) state.analysisError = 'The previous preparation request has no confirmed outcome yet. Check its status, or explicitly retry the same request below. It will use the same request ID to avoid duplicate work.';
      const newlyFinished = previous?.status === 'running' && job?.id === previous.id && job.status !== 'running';
      if (refreshPhotos && newlyFinished) await loadTrip(tripId, { checkJobs: false }); else render();
      return job;
    } catch (error) {
      if (state.mode === 'live' && state.trip?.id === tripId && identity === providerIdentity()) { state.analysisError = `Could not confirm preparation status: ${error.message} No new work will start until the status can be checked.`; state.analysisChecked = false; render(); }
    } finally { if (jobCheckInFlight?.promise === promise) jobCheckInFlight = null; }
  })();
  jobCheckInFlight = { tripId, identity, promise };
  return promise;
}

function renderNavigation() {
  $('navigation').replaceChildren(...Object.entries(viewNames).map(([key, name]) => button([icon(key), node('span', { class: 'nav-text' }, name), key === 'memories' ? node('span', { class: 'nav-number' }, String(state.photos.length)) : null], {
    class: `nav-item${state.view === key ? ' active' : ''}`, 'aria-label': name, 'aria-current': state.view === key ? 'page' : null, onclick: () => { if (state.view !== key) resetFilters(); state.view = key; if (key === 'picks') { state.sort = 'aesthetic'; $('photo-sort').value = 'aesthetic'; } render(); },
  })));
}
function renderHero() {
  const demo = state.mode === 'demo';
  $('hero').hidden = !demo;
  $('breadcrumb-trip').textContent = demo ? 'Lisbon ‘26' : state.trip?.title || 'My trips';
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  if (demo) {
    $('hero-avatars').replaceChildren(...demoMembers.slice(0, 5).map(m => avatar(m)), node('span', { class: 'avatar' }, '+1'));
    $('data-notice').replaceChildren(node('span', { class: 'notice-dot', 'aria-hidden': 'true' }), node('span', {}, node('strong', {}, 'Demo trip'), ' · Illustrative people, places & analysis. ', node('span', { class: 'notice-detail' }, 'A little preview of what’s possible.')), button(['How this works ', node('span', { 'aria-hidden': 'true' }, '↗')], { onclick: () => $('info-dialog').showModal() }));
  } else {
    $('data-notice').replaceChildren(node('span', { class: 'notice-dot', 'aria-hidden': 'true' }), node('span', {}, node('strong', {}, 'Your local workspace'), ' · Trip changes are saved on this Mac. No automatic sharing or cloud sync.'), button('About this preview ↗', { onclick: () => $('info-dialog').showModal() }));
  }
  $('footer-disclosure').textContent = demo ? 'Demo photography via Unsplash. Sample labels are illustrative.' : 'Local trip data. No photos sent to friends automatically.';
}
function places() {
  if (state.mode === 'demo') return demoPlaces;
  const groups = new Map();
  for (const p of state.photos) if (p.place && Number.isFinite(p.place.lat) && Number.isFinite(p.place.lon)) {
    const id = `${p.place.lat.toFixed(3)},${p.place.lon.toFixed(3)}`;
    if (!groups.has(id)) groups.set(id, { id, name: `${p.place.lat.toFixed(2)}°, ${p.place.lon.toFixed(2)}°`, note: 'Recorded photo coordinates', lat: p.place.lat, lon: p.place.lon });
  }
  const all = [...groups.values()];
  const lats = all.map(p => p.lat), lons = all.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  return all.map(p => ({ ...p, x: 15 + 70 * (p.lon - minLon) / (maxLon - minLon || 1), y: 75 - 55 * (p.lat - minLat) / (maxLat - minLat || 1) }));
}
function placeId(photo) { return state.mode === 'demo' ? photo.placeId : photo.place && Number.isFinite(photo.place.lat) && Number.isFinite(photo.place.lon) ? `${photo.place.lat.toFixed(3)},${photo.place.lon.toFixed(3)}` : null; }
function placeName(photo) { return places().find(p => p.id === placeId(photo))?.name || 'Location not recorded'; }
function filteredPhotos() {
  let photos = [...state.photos];
  if (state.mode === 'live' && state.query && !state.searchResults) return [];
  if (state.mode === 'live' && state.searchResults) {
    const byId = new Map(photos.map(p => [p.id, p]));
    photos = state.searchResults.results.filter(p => p.verification?.verdict === 'match').map(p => byId.get(p.id)).filter(Boolean);
  }
  if (state.filter === 'saved') photos = photos.filter(p => state.saved.has(p.id));
  else if (state.filter !== 'all') photos = photos.filter(p => p.annotation?.scene === state.filter);
  if (state.person) photos = photos.filter(p => confirmedMembers(p).includes(state.person));
  if (state.place) photos = photos.filter(p => placeId(p) === state.place);
  const query = state.query.trim().toLowerCase();
  if (query && state.mode === 'demo') {
    const tokens = query.split(/\s+/).filter(t => !['the', 'a', 'an', 'of', 'in', 'at', 'by', 'with', 'photos', 'pictures'].includes(t));
    photos = photos.filter(p => {
      const annotation = p.annotation;
      const searchable = [state.mode === 'demo' ? p.name : '', placeName(p), annotation?.scene || '', ...(annotation?.activities || []), ...(annotation?.vibes || []), ...confirmedMembers(p).map(memberName), annotation?.smilesVisible === true ? 'smiles smiling happy' : ''].join(' ').toLowerCase();
      return tokens.every(t => searchable.includes(t));
    });
  }
  if (state.view === 'picks') photos = photos.filter(p => state.sort === 'faces' ? p.annotation?.facesClear === true : Number.isFinite(p.annotation?.aesthetic));
  if (state.sort === 'aesthetic') photos.sort((a, b) => (b.annotation?.aesthetic ?? -1) - (a.annotation?.aesthetic ?? -1));
  else if (state.sort === 'faces') photos.sort((a, b) => Number(b.annotation?.facesClear === true) - Number(a.annotation?.facesClear === true) || (b.annotation?.aesthetic ?? -1) - (a.annotation?.aesthetic ?? -1));
  else if (!state.searchResults) photos.sort((a, b) => (a.capturedAt || '9999').localeCompare(b.capturedAt || '9999'));
  return photos;
}
function updateSelection() {
  $('selection-tray').hidden = !state.selected.size;
  $('selected-count').textContent = String(state.selected.size);
  $('saved-count').textContent = String(state.saved.size);
  document.querySelectorAll('.photo-select input').forEach(input => { input.checked = state.selected.has(input.dataset.photoId); input.closest('.memory-card')?.classList.toggle('selected', input.checked); });
}
function toggleSaved(photo) { if (state.saved.has(photo.id)) state.saved.delete(photo.id); else state.saved.add(photo.id); persistSaved(); render(); }
function card(photo, rank = null) {
  const picked = state.selected.has(photo.id);
  const checkbox = node('input', { type: 'checkbox', checked: picked, 'data-photo-id': photo.id, 'aria-label': `Select ${photo.name}`, onchange: e => { e.target.checked ? state.selected.add(photo.id) : state.selected.delete(photo.id); updateSelection(); } });
  const names = confirmedMembers(photo).map(memberName);
  const badge = state.view === 'picks' ? (state.sort === 'faces' ? 'Clear faces' : `The good ones / ${String(rank + 1).padStart(2, '0')}`) : null;
  return node('article', { class: `memory-card${picked ? ' selected' : ''}` },
    node('div', { class: 'memory-image', style: `--aspect:${state.mode === 'demo' ? photo.aspect : [0.86, 1.16, 0.89, 1.04][rank % 4] || 1}` },
      button(photoImage(photo), { class: 'memory-open', 'aria-label': `View ${photo.name}`, onclick: () => showPhoto(photo) }),
      node('label', { class: 'photo-select' }, checkbox),
      node('span', { class: 'photo-place' }, icon('places'), placeName(photo)),
      badge ? node('span', { class: 'pick-badge' }, badge) : null),
    node('div', { class: 'memory-caption' }, node('div', {}, node('h3', {}, photo.name), node('p', {}, names.length ? icon('people') : null, names.length > 2 ? `${names[0]} + ${names.length - 1} friends` : names.join(' & ') || (state.mode === 'demo' ? dateLabel(photo.capturedAt) : photo.annotation ? 'Annotated' : 'Awaiting analysis'))), button(state.saved.has(photo.id) ? '♥' : '♡', { class: `memory-heart${state.saved.has(photo.id) ? ' saved' : ''}`, 'aria-label': `${state.saved.has(photo.id) ? 'Remove from' : 'Add to'} shortlist: ${photo.name}`, 'aria-pressed': String(state.saved.has(photo.id)), onclick: () => toggleSaved(photo) })));
}
function empty(title, description, action = null) { return node('div', { class: 'empty-state' }, node('div', { class: 'empty-symbol', 'aria-hidden': 'true' }, '✳'), node('h3', {}, title), node('p', {}, description), action); }
function photoGrid(photos) {
  if (state.mode === 'live' && state.query && state.searching) return node('div', { class: 'loading-state', role: 'status' }, 'Checking for the moments you meant…');
  if (state.mode === 'live' && state.query && state.searchClarification) {
    const clarification = node('section', { class: 'clarification-panel', 'aria-label': 'Clarify who you mean' }, node('span', { class: 'eyebrow' }, 'A LITTLE CONTEXT GOES A LONG WAY'), node('h3', {}, 'Who did you have in mind?'), node('p', {}, state.searchClarification.message || 'A name needs a confirmed photo reference before we can look for that person.'));
    for (const question of state.searchClarification.questions || []) {
      const choices = question.choices || [];
      clarification.append(node('h4', {}, question.term));
      if (choices.length > 1 && !question.needsExamples) clarification.append(node('div', { class: 'clarification-choices' }, ...choices.map(choice => button(`${choice.name}${choice.qualifier ? ` · ${choice.qualifier}` : ''}`, { class: 'button-outline', onclick: () => searchPhotos({ ...state.searchBindings, [question.term]: choice.id }) }))));
      else clarification.append(node('p', {}, choices.length ? `Open a photo, choose “Correct or add an annotation,” and confirm ${choices[0].name} in the frame. Then try this search again.` : `“${question.term}” does not match a confirmed trip member yet. Try a name from this trip, or use a visual description instead.`));
    }
    clarification.append(button('Back to photos', { class: 'button-dark', onclick: () => { resetFilters(); render(); } }));
    return clarification;
  }
  if (state.mode === 'live' && state.query && state.searchError) return empty('The search couldn’t finish.', state.searchError, button('Back to all moments', { class: 'button-outline', onclick: () => { resetFilters(); render(); } }));
  if (!photos.length) return empty(state.searchResults ? 'No verified matches, this time.' : 'A little too specific?', state.searchResults ? 'The visual model did not confirm a match among the closest candidates. Try another description. Uncertain and failed checks are not shown.' : 'No photos match these recorded labels. Try fewer words or another filter. Unanalyzed photos do not have search tags yet.', button('See all moments', { class: 'button-outline', onclick: () => { resetFilters(); state.view = 'memories'; render(); } }));
  const grid = node('div', { class: 'photo-grid' });
  const count = window.innerWidth <= 640 ? 2 : window.innerWidth <= 900 ? 3 : 4;
  const columns = Array.from({ length: count }, () => node('div', { class: 'photo-column' }));
  photos.forEach((p, i) => columns[i % count].append(card(p, i)));
  grid.append(...columns);
  return grid;
}
function coverageNotice() {
  const annotated = state.photos.filter(p => p.annotation).length;
  if (state.mode === 'demo') return node('div', { class: 'coverage-note' }, node('strong', {}, `${annotated} of ${state.photos.length} photos have annotations. `), 'These are authored sample labels, not model findings. Counts below describe the demo fixtures.');
  const indexed = state.photos.filter(p => p.indexed).length;
  return node('div', { class: 'coverage-note coverage-pair' }, node('div', {}, node('strong', {}, `${indexed} / ${state.photos.length} search-ready`), node('span', {}, 'Direct image embeddings for your current provider.')), node('div', {}, node('strong', {}, `${annotated} / ${state.photos.length} with scene notes`), node('span', {}, 'Recorded observations power picks, activities & statistics.')));
}

function renderPlaces(content) {
  const list = places();
  if (!list.length) { content.append(empty('A place for every memory.', 'These photos do not have recorded GPS coordinates yet. Places will appear here when location metadata is available. No location is inferred from filenames.')); return; }
  const map = node('div', { class: 'map-paper', 'aria-label': 'Schematic place map. Not a navigational map.' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 600 420'); svg.setAttribute('class', 'map-lines'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M-20 120 120 120 180 210 450 210 600 160', 'M120 0 120 120 240 310', 'M320 0 320 130 440 210 480 350', 'M0 290 130 250 290 240 600 30', 'M500 0 420 100 210 140 0 180', 'M0 45 200 70 390 50 600 100']) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#f8faf3'); path.setAttribute('stroke-width', '9'); svg.append(path); }
  map.append(svg, node('span', { class: 'map-city-label' }, state.mode === 'demo' ? 'LISBOA' : 'OUR PLACES'));
  const placeList = node('div', { class: 'place-list' });
  list.forEach(place => {
    const photos = state.photos.filter(p => placeId(p) === place.id);
    const select = () => { state.place = state.place === place.id ? null : place.id; render(); };
    map.append(button([node('span', { class: 'marker-dot' }, String(photos.length)), node('span', { class: 'marker-label' }, place.name)], { class: `map-marker${state.place === place.id ? ' active' : ''}`, style: `left:${place.x}%;top:${place.y}%`, 'aria-label': `${place.name}, ${photos.length} photos`, 'aria-pressed': String(state.place === place.id), onclick: select }));
    placeList.append(button([photos[0] ? photoImage(photos[0], { alt: '' }) : null, node('div', {}, node('h3', {}, place.name), node('p', {}, place.note)), node('span', {}, `${photos.length} ↗`)], { class: `place-row${state.place === place.id ? ' active' : ''}`, 'aria-pressed': String(state.place === place.id), onclick: select }));
  });
  map.append(node('span', { class: 'map-caption' }, state.mode === 'demo' ? 'Schematic map · illustrative locations' : 'Schematic coordinate plot · not for navigation'));
  content.append(node('div', { class: 'places-layout' }, map, placeList));
  if (state.place) content.append(node('section', { class: 'map-results' }, node('h3', {}, list.find(p => p.id === state.place)?.name || 'Selected place'), photoGrid(filteredPhotos())));
}
function renderPeople(content) {
  content.append(coverageNotice());
  if (!members().length) { content.append(empty('Good trips start with good people.', 'Add member names when creating a trip. Confirm who is in each photo through its details; names alone do not identify faces.')); return; }
  if (state.person) { content.append(photoGrid(filteredPhotos())); return; }
  const grid = node('div', { class: 'people-grid' });
  for (const member of members()) {
    const photos = state.photos.filter(p => confirmedMembers(p).includes(member.id));
    const portrait = photos.find(p => confirmedMembers(p).length === 1) || photos[0];
    grid.append(button([node('div', { class: 'person-cover', style: `background:${member.color || '#e6eadb'}` }, portrait ? photoImage(portrait, { alt: '' }) : node('span'), photos[photos.length - 1] ? photoImage(photos[photos.length - 1], { alt: '' }) : node('span')), node('div', { class: 'person-meta' }, avatar(member), node('div', {}, node('h3', {}, member.name), node('p', {}, `${photos.length} ${state.mode === 'demo' ? 'sample' : 'confirmed'} appearances`)), node('span', { 'aria-hidden': 'true' }, '↗'))], { class: 'person-card', 'aria-label': `See ${photos.length} photos of ${member.name}`, onclick: () => { state.person = member.id; render(); } }));
  }
  content.append(grid, node('p', { class: 'recap-footnote' }, state.mode === 'demo' ? 'Names are fictional associations for demonstrating grouping. These are not the identities of the people pictured.' : 'Only confirmed person labels appear here. Suggested and uncertain identities are excluded.'));
}
function renderRecap(content) {
  content.append(coverageNotice());
  const annotated = state.photos.filter(p => p.annotation);
  const appearances = members().map(m => ({ ...m, count: state.photos.filter(p => confirmedMembers(p).includes(m.id)).length })).sort((a, b) => b.count - a.count);
  const groupPhotos = state.photos.filter(p => confirmedMembers(p).length >= 2).length;
  const activities = new Map();
  annotated.forEach(p => [...new Set(p.annotation.activities || [])].forEach(a => activities.set(a, (activities.get(a) || 0) + 1)));
  const sortedActivities = [...activities].sort((a, b) => b[1] - a[1]);
  const stats = [
    ['MEMORIES IN ONE PLACE', String(state.photos.length).padStart(2, '0'), 'Everyone’s good side, in one collection.'],
    ['WITH TWO OR MORE FRIENDS', String(groupPhotos).padStart(2, '0'), 'Based on confirmed person labels.'],
    ['DIFFERENT LITTLE ADVENTURES', String(activities.size).padStart(2, '0'), 'Distinct activity tags in this collection.'],
  ];
  content.append(node('div', { class: 'stats-grid' }, ...stats.map(([label, value, note]) => node('article', { class: 'stat-card' }, node('span', { class: 'stat-label' }, label), node('div', { class: 'stat-number' }, value), node('p', {}, note)))));
  const leaders = node('section', { class: 'recap-panel' }, node('h3', {}, 'The camera loves company.'), node('p', {}, 'Appearances in this collection. Each photo counts once per person.'));
  if (!appearances.some(m => m.count)) leaders.append(node('p', {}, 'Confirm people in photo details to start the tally.'));
  else appearances.forEach((m, i) => leaders.append(node('div', { class: 'leader-row' }, node('span', {}, String(i + 1).padStart(2, '0')), avatar(m), node('div', { class: 'leader-body' }, node('div', { class: 'leader-label' }, node('span', {}, m.name), node('span', {}, `${m.count} photos`)), node('div', { class: 'leader-track' }, node('span', { style: `width:${100 * m.count / Math.max(1, appearances[0].count)}%` }))))));
  const activityPanel = node('section', { class: 'recap-panel' }, node('h3', {}, 'Apparently, we had a thing for…'), node('p', {}, 'Most frequent recorded activities. One photo can have several tags.'));
  if (!sortedActivities.length) activityPanel.append(node('p', {}, 'Activity labels will appear after analysis or a manual annotation.'));
  sortedActivities.slice(0, 6).forEach(([name, count]) => activityPanel.append(node('div', { class: 'activity-row' }, node('span', {}, name), node('span', {}, `${count} photos`))));
  content.append(node('div', { class: 'recap-columns' }, leaders, activityPanel), node('p', { class: 'recap-footnote' }, 'Counts reflect the photos and recorded annotations available here, not the whole trip. A visible smile is an observation, not a claim about how someone feels. Aesthetic picks are subjective.'));
}
function liveControls(content) {
  if (state.mode !== 'live' || !state.trip) return;
  const coverage = coverageNotice();
  const candidates = preparationCandidates();
  const busy = state.analyzing || state.ai?.analyzing || state.ai?.indexing || state.ai?.searching;
  const label = state.analyzing ? 'Preparing photos…' : !state.analysisChecked ? 'Checking preparation…' : state.pendingAnalysis ? 'Retry same preparation' : candidates.length ? `Prepare next ${Math.min(candidates.length, 12)} photos` : 'Your photos are prepared';
  const bar = node('div', { class: 'live-controls' }, button('← All my trips', { class: 'button-outline', onclick: () => { state.trip = null; state.photos = []; state.selected.clear(); resetFilters(); loadLiveTrips(); } }), button(label, { id: 'prepare-photos', class: 'button-dark', disabled: busy || !state.analysisChecked || Boolean(state.aiError) || !state.photos.length || (!candidates.length && !state.pendingAnalysis), onclick: analyzeTrip }), node('span', { class: 'preparation-hint' }, state.ai?.configured ? 'Reuses saved work. You choose when to run AI.' : 'Connect AI to prepare or search this trip.'));
  if (!['people', 'recap'].includes(state.view)) content.append(coverage);
  content.append(bar);
  if (state.analysisJob || state.analysisError) {
    const job = state.analysisJob;
    const heading = state.analysisError ? 'Preparation needs a check' : job.status === 'running' ? 'A little perspective, in progress…' : job.status === 'complete' ? 'Your latest preparation' : job.status === 'interrupted' ? 'Preparation was interrupted' : 'Preparation needs another look';
    const metrics = job ? [`${job.embedded ?? 0} new image embeddings`, `${job.embeddingCached ?? 0} saved image embeddings reused`, `${job.processed ?? 0} scene notes saved`, `${job.cached ?? 0} scene notes reused`, ...(job.preservedUser ? [`${job.preservedUser} user edits preserved`] : [])].join(' · ') : '';
    content.append(node('div', { id: 'analysis-notice', class: `analysis-notice${state.analysisError || job?.status === 'failed' || job?.status === 'interrupted' ? ' needs-attention' : ''}`, role: 'status' }, node('strong', {}, heading), node('p', {}, state.analysisError || job?.message || 'Saving image embeddings, then reviewing scenes. You can leave this page; preparation continues on this Mac.'), metrics ? node('p', { class: 'analysis-metrics' }, metrics) : null, button('Check preparation status ↻', { id: 'check-analysis', class: 'analysis-check', onclick: () => checkAnalysisJobs() })));
  }
}
function render() {
  renderNavigation(); renderHero(); renderAIStatus(); updateSelection();
  const content = $('view-content'); content.replaceChildren();
  const browsingTrips = state.mode === 'live' && !state.trip;
  const photoView = ['memories', 'picks'].includes(state.view) && !browsingTrips;
  $('search-form').hidden = !photoView;
  $('suggestions').hidden = !photoView || state.mode !== 'demo';
  $('filters').hidden = !photoView;
  $('select-all').hidden = !photoView && !(state.view === 'people' && state.person);
  $('search-disclosure').hidden = !photoView || (state.mode === 'demo' && !state.query);
  $('search-disclosure').textContent = state.mode === 'demo' ? 'Demo search uses sample tags. Open My trips for real image search.' : 'Search uses saved image embeddings, then checks up to 12 candidate photos against your full prompt. Your prompt and those photos go to your provider; billing applies. Confirm names in photo details to teach your trip who is who.';
  $('search-form').querySelector('button').disabled = state.searching || (state.mode === 'live' && (state.analyzing || state.ai?.analyzing || state.ai?.indexing || state.ai?.searching));
  $('search-form').querySelector('button').setAttribute('aria-label', state.searching ? 'Searching your photos' : 'Search photos');
  $('search-form').querySelector('button span').textContent = state.searching ? '◌' : '↗';
  $('search-form').querySelector('button span').classList.toggle('search-spinner', state.searching);
  const titles = { memories: ['THE CAMERA ROLL, REIMAGINED', 'Every little moment'], places: ['THE PLACES WE LEFT A LITTLE OF OURSELVES', 'Wish we were still here'], people: ['GOOD COMPANY LOOKS GOOD ON YOU', state.person ? `A little more ${memberName(state.person)}` : 'It was always the people'], recap: ['THE WEEKEND, BY THE NUMBERS', 'Turns out, we made memories'], picks: ['SOME MOMENTS JUST HIT DIFFERENT', 'For the group chat. Or the grid'] };
  const [eyebrow, title] = browsingTrips ? ['MAKE ROOM FOR THE GOOD STUFF', 'Your next favorite memory'] : titles[state.view];
  $('view-eyebrow').textContent = eyebrow;
  $('view-title').replaceChildren(title, node('span', { class: 'heading-period' }, '.'));
  $('view-description').hidden = state.mode === 'demo' || browsingTrips;
  $('view-description').textContent = state.trip ? `${state.trip.title}${state.trip.place ? ` · ${state.trip.place}` : ''}` : '';
  $('photo-total').textContent = `${state.photos.length} memories`;
  $('end-note').hidden = browsingTrips || state.loading;
  $('active-filter').hidden = !state.person && !state.place && !state.query;
  $('active-filter').replaceChildren(...[state.person ? memberName(state.person) : null, state.place ? places().find(p => p.id === state.place)?.name : null, state.query ? `“${state.query}”` : null].filter(Boolean).map(label => node('span', {}, label)), button('Clear ×', { onclick: () => { resetFilters(); render(); } }));
  document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b.dataset.filter === state.filter); b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)); });
  if (state.loading) { content.append(node('div', { class: 'loading-state', role: 'status' }, 'Gathering the good stuff…')); return; }
  if (browsingTrips) { renderTripList(content); return; }
  liveControls(content);
  if (state.view === 'places') renderPlaces(content);
  else if (state.view === 'people') renderPeople(content);
  else if (state.view === 'recap') renderRecap(content);
  else {
    if (state.searching) content.append(node('div', { class: 'search-status', role: 'status' }, 'Finding candidates, then checking the images against your full prompt…'));
    if (state.searchResults) content.append(node('div', { class: 'search-status' }, `Visual search checked ${state.searchResults.checked || 0} candidates out of ${state.searchResults.totalCandidates || 0} indexed trip photos. Showing only model-assessed matches; this is not a guarantee. `, node('a', { href: '/' }, 'More search controls ↗')));
    if (state.view === 'picks') content.append(node('div', { class: 'pick-intro' }, node('div', {}, node('h3', {}, state.sort === 'faces' ? 'Everybody gets their good side.' : 'The ones you keep coming back to.'), node('p', {}, state.mode === 'demo' ? 'A sample editorial shortlist. These demo scores illustrate the experience; they are not actual model judgments.' : 'Sorted by recorded assessments. Aesthetic ratings are subjective; “clear faces” describes visibility, not an identity match.')), node('span', { 'aria-hidden': 'true' }, '✳')));
    const photos = filteredPhotos();
    $('photo-total').textContent = `${photos.length} ${photos.length === 1 ? 'memory' : 'memories'}`;
    content.append(photoGrid(photos));
  }
}

function showPhoto(photo) {
  const annotation = photo.annotation;
  const copy = node('div', { class: 'detail-copy' }, node('span', { class: 'eyebrow' }, state.mode === 'demo' ? 'A MOMENT FROM THE DEMO' : 'A MOMENT FROM YOUR TRIP'), node('h2', { id: 'photo-dialog-title' }, photo.name), node('p', { class: 'detail-meta' }, `${placeName(photo)} · ${dateLabel(photo.capturedAt)}`));
  const tags = [...(annotation?.activities || []), ...(annotation?.vibes || [])];
  copy.append(node('section', { class: 'detail-section' }, node('h3', {}, 'The little details'), tags.length ? node('div', { class: 'detail-tags' }, ...tags.map(t => node('span', { class: 'detail-tag' }, t))) : node('p', {}, 'No activity or mood tags recorded yet.')));
  const people = (annotation?.members || []).map(m => `${memberName(m.memberId)}${m.status !== 'confirmed' ? ` (${m.status})` : ''}`);
  copy.append(node('section', { class: 'detail-section' }, node('h3', {}, 'In the frame'), node('p', {}, people.length ? people.join(', ') : 'No people identified.')));
  copy.append(node('section', { class: 'detail-section' }, node('h3', {}, 'Why this photo?'), node('p', {}, `${annotation?.aesthetic != null ? `Aesthetic rating: ${annotation.aesthetic}/100. ` : 'Aesthetic rating not recorded. '}${annotation?.facesClear === true ? 'Faces assessed as clear. ' : annotation?.facesClear === false ? 'Faces assessed as unclear. ' : 'Face visibility not assessed. '}${annotation?.smilesVisible === true ? 'Visible smiles recorded.' : ''}`)));
  copy.append(node('section', { class: 'detail-section' }, node('h3', {}, 'Source & evidence'), node('p', {}, state.mode === 'demo' ? 'Illustrative sample labels. People, locations, and scores are fictional associations, not findings about the photograph.' : annotation ? `${annotation.provenance === 'user' ? 'Confirmed or edited by a workspace user.' : `Model assessment${annotation.model ? `: ${annotation.model}` : ''}.`} ${annotation.evidence || 'No additional evidence recorded.'}` : 'No analysis has been recorded. This photo is not included in statistics that require annotations.')));
  copy.append(button(state.saved.has(photo.id) ? 'Remove from shortlist' : '♡ Add to the shortlist', { class: 'button-dark', onclick: e => { state.saved.has(photo.id) ? state.saved.delete(photo.id) : state.saved.add(photo.id); persistSaved(); e.currentTarget.textContent = state.saved.has(photo.id) ? 'Remove from shortlist' : '♡ Add to the shortlist'; render(); } }));
  if (state.mode === 'live') copy.append(annotationEditor(photo));
  if (photo.credit) copy.append(node('p', { class: 'detail-credit' }, photo.credit));
  $('photo-dialog-content').replaceChildren(node('div', { class: 'photo-detail-layout' }, node('div', { class: 'detail-photo' }, photoImage(photo, { loading: 'eager' })), copy));
  $('photo-dialog').showModal();
}
function annotationEditor(photo) {
  const existing = photo.annotation;
  const details = node('details', { class: 'annotation-editor detail-section' }, node('summary', {}, 'Correct or add an annotation'));
  const form = node('form');
  const scene = node('select', { name: 'scene' }, ...[['', 'Not assessed'], ['people', 'People'], ['scenery', 'Scenery'], ['food', 'Food'], ['other', 'Other']].map(([value, label]) => node('option', { value }, label)));
  scene.value = existing?.scene || '';
  const aesthetic = node('input', { name: 'aesthetic', type: 'number', min: '0', max: '100', step: '1', value: existing?.aesthetic ?? '', placeholder: 'Not assessed' });
  const faces = node('select', { name: 'faces' }, node('option', { value: '' }, 'Not assessed'), node('option', { value: 'yes' }, 'Clear faces visible'), node('option', { value: 'no' }, 'Faces not clear'));
  faces.value = existing?.facesClear === true ? 'yes' : existing?.facesClear === false ? 'no' : '';
  const activities = node('input', { name: 'activities', value: existing?.activities?.join(', ') || '', maxlength: '1000', placeholder: 'Walking, dinner…' });
  const personInputs = members().map(m => ({ member: m, input: node('input', { type: 'checkbox', checked: confirmedMembers(photo).includes(m.id), value: m.id }) }));
  form.append(node('label', {}, 'Scene', scene), node('label', {}, 'Your aesthetic rating (0–100)', aesthetic), node('label', {}, 'Face visibility', faces), node('label', {}, 'Activities (comma separated)', activities));
  if (personInputs.length) form.append(node('fieldset', {}, node('legend', {}, 'I confirm these people are in this photo'), ...personInputs.map(({ member, input }) => node('label', { class: 'person-confirm' }, input, member.name))));
  const error = node('p', { class: 'form-error', role: 'alert' });
  const save = button('Save my correction', { type: 'submit', class: 'button-outline' });
  form.append(node('p', { class: 'editor-note' }, 'This saves your assessment as a user annotation and replaces the displayed model assessment for this photo.'), error, save);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; error.textContent = '';
    const chosen = new Set(personInputs.filter(x => x.input.checked).map(x => x.member.id));
    const pending = (existing?.members || []).filter(m => m.status !== 'confirmed' && !chosen.has(m.memberId));
    try {
      await api(`/api/studio/trips/${encodeURIComponent(state.trip.id)}/annotations`, { annotations: [{ photoId: photo.id, revision: existing?.revision ?? 0, provenance: 'user', evidence: 'Reviewed and edited in photo details by a workspace user.', scene: scene.value || null, aesthetic: aesthetic.value === '' ? null : Number(aesthetic.value), facesClear: faces.value === '' ? null : faces.value === 'yes', smilesVisible: existing?.smilesVisible ?? null, activities: activities.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20), vibes: existing?.vibes || [], members: [...chosen].map(memberId => ({ memberId, status: 'confirmed' })).concat(pending) }] });
      $('photo-dialog').close(); resetFilters(); await loadTrip(state.trip.id); announce('Correction saved. The trip’s counts and picks now use your annotation.');
    } catch (e) { error.textContent = e.message; } finally { save.disabled = false; }
  });
  details.append(form); return details;
}

function renderTripList(content) {
  if (!state.trips.length) { content.append(empty('The next trip starts here.', 'Create a collection from photos in your workspace. Your original photo search and saved embeddings are still available.', button('＋ Create your first trip', { class: 'button-dark', onclick: openCreateTrip }))); return; }
  content.append(node('div', { class: 'trip-list' }, ...state.trips.map(trip => button([node('span', { class: 'eyebrow' }, trip.place || 'YOUR LOCAL COLLECTION'), node('h3', {}, trip.title), node('p', {}, `${trip.photoCount} photos · ${trip.members?.length || 0} friends${trip.startDate ? ` · ${dateLabel(trip.startDate)}` : ''}`), node('span', { 'aria-hidden': 'true' }, '↗')], { class: 'trip-list-card', onclick: () => loadTrip(trip.id) }))));
}
async function loadLiveTrips() {
  const generation = ++loadGeneration;
  state.loading = true; render();
  try { const data = await api('/api/studio/trips'); if (state.mode !== 'live' || generation !== loadGeneration) return; state.trips = data.trips || []; state.loading = false; persistWorkspaceView(); render(); }
  catch (e) { if (generation !== loadGeneration) return; state.loading = false; render(); $('view-content').prepend(node('div', { class: 'error-inline', role: 'alert' }, e.message)); }
}
async function loadTrip(id, { checkJobs = true } = {}) {
  const generation = ++loadGeneration;
  const changedTrip = state.trip?.id !== id;
  if (changedTrip) { resetFilters(); state.analysisJob = null; state.analysisError = null; state.analysisChecked = false; state.analyzing = false; state.pendingAnalysis = null; }
  state.loading = true; render();
  try {
    const data = await api(`/api/studio/trips/${encodeURIComponent(id)}`);
    if (state.mode !== 'live' || generation !== loadGeneration) return;
    state.trip = data.trip; state.photos = data.photos || []; state.coverage = data.coverage; state.loading = false; state.selected = new Set([...state.selected].filter(id => state.photos.some(p => p.id === id))); loadSaved(); persistWorkspaceView(); render();
    state.pendingAnalysis = readPendingAnalysis();
    if (checkJobs) await checkAnalysisJobs({ refreshPhotos: false });
  } catch (e) { if (generation !== loadGeneration) return; state.loading = false; render(); $('view-content').prepend(node('div', { class: 'error-inline', role: 'alert' }, e.message)); }
}
async function changeMode(mode) {
  if (state.mode === mode) return;
  loadGeneration++;
  if ($('photo-dialog').open) $('photo-dialog').close();
  state.mode = mode; state.view = 'memories'; state.sort = 'recent'; $('photo-sort').value = 'recent'; resetFilters(); state.selected.clear(); state.analyzing = false; state.analysisJob = null; state.analysisError = null; state.analysisChecked = false; state.pendingAnalysis = null;
  if (mode === 'demo') { state.trip = demoTrip; state.photos = demoPhotos; state.loading = false; loadSaved(); persistWorkspaceView(); render(); }
  else { state.trip = null; state.photos = []; state.saved.clear(); await Promise.all([loadLiveTrips(), refreshAIStatus()]); }
}
async function analyzeTrip() {
  if (state.analyzing || !state.trip || state.mode !== 'live') return;
  const tripId = state.trip.id;
  if (!await refreshAIStatus()) return;
  if (!state.ai?.configured) { await openAIConnection(); return; }
  await checkAnalysisJobs();
  if (state.mode !== 'live' || state.trip?.id !== tripId || !state.analysisChecked || state.analyzing) return;
  if (state.ai.analyzing || state.ai.indexing || state.ai.searching) { announce('Another model request is running. Let it finish before preparing this trip.'); return; }
  const pending = state.pendingAnalysis;
  const candidates = pending ? state.photos.filter(photo => pending.photoIds.includes(photo.id)) : preparationCandidates().slice(0, 12);
  if (!candidates.length) { announce('These photos already have current image embeddings and scene notes. Your edits are preserved.'); return; }
  const embeddingCount = candidates.filter(photo => !photo.indexed).length;
  const sceneCount = candidates.filter(photo => !observationCurrent(photo)).length;
  const accepted = window.confirm(`${pending ? 'Retry the same preparation request' : `Prepare ${candidates.length} photos`}?\n\n${embeddingCount} missing image embeddings and ${sceneCount} scene assessments are currently needed. This can make up to ${embeddingCount} image embedding calls and ${sceneCount ? '1' : '0'} vision calls to ${state.ai.providerLabel || state.ai.provider}. Saved work and your corrections are reused. Provider billing and quota apply. ${pending ? 'The previous outcome is unconfirmed; the same request ID will be reused so an existing job is not run twice.' : 'Photos are sent only to your selected provider, never to friends.'}`);
  if (!accepted) return;
  const request = pending || { requestId: crypto.randomUUID(), photoIds: candidates.map(p => p.id) };
  const storageKey = analysisStorageKey(), identity = providerIdentity();
  writePendingAnalysis(request, storageKey);
  state.analyzing = true; state.analysisError = null; render();
  try {
    const data = await api(`/api/studio/trips/${encodeURIComponent(tripId)}/analyze`, request);
    if (state.mode !== 'live' || state.trip?.id !== tripId || identity !== providerIdentity()) return;
    if (!data.job) throw new Error('No preparation result was returned. Check its saved status before retrying.');
    state.analysisJob = data.job; state.analyzing = data.job.status === 'running';
    if (!state.analyzing) writePendingAnalysis(null, storageKey);
    await loadTrip(tripId, { checkJobs: false });
    announce(data.job.message || 'Preparation status updated.');
  } catch (error) {
    if (state.mode === 'live' && state.trip?.id === tripId && identity === providerIdentity()) {
      state.analysisError = `The response was interrupted: ${error.message} Checking the saved job before allowing another request.`;
      await checkAnalysisJobs();
      await loadTrip(tripId, { checkJobs: false });
    }
  } finally {
    if (state.mode === 'live' && state.trip?.id === tripId && identity === providerIdentity()) { state.analyzing = state.analysisJob?.status === 'running'; render(); }
    await refreshAIStatus();
  }
}
async function searchPhotos(bindings = {}) {
  const query = $('photo-query').value.trim();
  if (state.searching) return;
  if (!query) { resetFilters(); render(); return; }
  if (state.mode === 'demo') { state.query = query; render(); return; }
  if (!state.trip || !state.photos.length) { announce('Add photos to a trip first.'); return; }
  if (!state.ai?.configured || state.aiError) { state.query = query; state.searchResults = null; state.searchError = 'Connect your provider to search this trip.'; state.selected.clear(); render(); await openAIConnection(); return; }
  if (!state.photos.some(photo => photo.indexed)) { state.query = query; state.searchResults = null; state.searchError = 'These photos need image embeddings for this provider. Use Prepare photos below to make them searchable.'; state.selected.clear(); render(); return; }
  const tripId = state.trip.id;
  const identity = providerIdentity(), generation = ++searchGeneration;
  state.searching = true; state.query = query; state.searchResults = null; state.searchError = null; state.searchClarification = null; state.searchBindings = bindings; state.selected.clear(); render();
  try {
    const result = await api('/search', { query, photoIds: state.photos.map(p => p.id), studioTripId: tripId, context: true, verify: true, bindings });
    if (state.mode === 'live' && state.trip?.id === tripId && state.query === query && identity === providerIdentity() && generation === searchGeneration) { if (result.needsClarification) state.searchClarification = result; else state.searchResults = result; state.sort = 'recent'; $('photo-sort').value = 'recent'; }
  } catch (e) { if (state.trip?.id === tripId && state.query === query && generation === searchGeneration) { state.searchError = e.message; state.searchResults = null; announce(e.message); } }
  finally { if (generation === searchGeneration) { state.searching = false; render(); } }
}
async function openCreateTrip() {
  $('trip-error').textContent = ''; $('trip-form').reset(); state.importSelected.clear(); state.importPhotos = []; state.importLimit = 60;
  $('import-count').textContent = 'Loading workspace…'; $('import-photos').replaceChildren(); $('trip-dialog').showModal();
  try { const data = await api('/state'); state.importPhotos = data.photos || []; renderImport(); }
  catch (e) { $('trip-error').textContent = e.message; $('import-count').textContent = 'Workspace unavailable'; }
}
function renderImport() {
  $('import-count').textContent = `${state.importSelected.size} selected · ${state.importPhotos.length} available`;
  const visible = state.importPhotos.slice(0, state.importLimit);
  $('import-photos').replaceChildren(...visible.map(p => {
    const input = node('input', { type: 'checkbox', checked: state.importSelected.has(p.id), 'aria-label': `Include ${p.name}`, onchange: e => { e.target.checked ? state.importSelected.add(p.id) : state.importSelected.delete(p.id); $('import-count').textContent = `${state.importSelected.size} selected · ${state.importPhotos.length} available`; } });
    return node('div', { class: 'import-photo' }, node('label', {}, input, photoImage(p, { alt: p.name })));
  }));
  if (!visible.length) $('import-photos').append(node('p', { class: 'import-help' }, 'No workspace photos found. Add some in the image search workspace first.'));
  $('import-more').hidden = visible.length >= state.importPhotos.length;
}
function exportSelection() {
  const selected = state.photos.filter(p => state.selected.has(p.id));
  if (!selected.length) return;
  const manifest = { format: 'afterglow-selection-v1', createdAt: new Date().toISOString(), illustrativeDemo: state.mode === 'demo', trip: { id: state.trip.id, title: state.trip.title }, notes: 'Selection manifest only. Does not include original image files or send messages. Demo identity and location labels are fictional.', photos: selected.map(p => ({ id: p.id, name: p.name, image: safeImage(p.image), confirmedMemberNames: confirmedMembers(p).map(memberName), annotationSource: p.annotation?.provenance || null })) };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = node('a', { href: url, download: 'afterglow-selection.json' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  announce('Selection manifest downloaded. No photos were sent to anyone.');
}

document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => changeMode(b.dataset.mode)));
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
document.querySelectorAll('[data-query]').forEach(b => b.addEventListener('click', () => { state.query = b.dataset.query; $('photo-query').value = state.query; render(); }));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { const r = dialog.getBoundingClientRect(); if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close(); }));
$('search-form').addEventListener('submit', e => { e.preventDefault(); searchPhotos(); });
$('ai-connect').addEventListener('click', openAIConnection);
$('ai-provider').addEventListener('change', updateProviderNote);
$('ai-dialog').addEventListener('close', () => { $('ai-key').value = ''; });
$('ai-form').addEventListener('submit', async event => {
  event.preventDefault();
  const key = $('ai-key').value.trim(), provider = $('ai-provider').value;
  if (!key) return;
  $('ai-submit').disabled = true; $('ai-disconnect').disabled = true; $('ai-error').textContent = ''; $('ai-key').value = '';
  try {
    await api('/connect', { key, provider });
    await refreshAIStatus();
    if (state.aiError) throw new Error('The key was submitted, but the workspace status could not be confirmed. Check the connection status before using it.');
    $('ai-dialog').close(); render(); announce(`${state.ai.providerLabel || provider} key loaded. No model call has been made to validate it.`);
    if (state.mode === 'live' && state.trip) await checkAnalysisJobs();
  } catch (error) { $('ai-error').textContent = error.message; }
  finally { $('ai-key').value = ''; $('ai-submit').disabled = false; $('ai-disconnect').disabled = false; }
});
$('ai-disconnect').addEventListener('click', async () => {
  $('ai-submit').disabled = true; $('ai-disconnect').disabled = true; $('ai-key').value = ''; $('ai-error').textContent = '';
  try { await api('/disconnect', {}); await refreshAIStatus(); $('ai-dialog').close(); render(); announce('API key cleared from server memory. Saved photo analysis stays available.'); }
  catch (error) { $('ai-error').textContent = error.message; }
  finally { $('ai-submit').disabled = false; $('ai-disconnect').disabled = false; }
});
$('photo-sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
$('select-all').addEventListener('click', () => { const photos = filteredPhotos(); if (photos.length && photos.every(p => state.selected.has(p.id))) photos.forEach(p => state.selected.delete(p.id)); else photos.forEach(p => state.selected.add(p.id)); updateSelection(); });
$('clear-selection').addEventListener('click', () => { state.selected.clear(); updateSelection(); });
$('save-selection').addEventListener('click', () => { state.selected.forEach(id => state.saved.add(id)); persistSaved(); announce(`${state.selected.size} moments added to your shortlist.`); state.selected.clear(); render(); });
$('export-selection').addEventListener('click', exportSelection);
$('create-trip').addEventListener('click', openCreateTrip);
$('trip-switch').addEventListener('click', () => { if (state.mode === 'demo') { state.view = 'memories'; resetFilters(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } else { state.trip = null; state.photos = []; resetFilters(); state.selected.clear(); loadLiveTrips(); } });
$('import-more').addEventListener('click', () => { state.importLimit += 60; renderImport(); });
$('trip-form').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.currentTarget; const submit = form.querySelector('[type=submit]'); submit.disabled = true; $('trip-error').textContent = '';
  const data = new FormData(form);
  const names = [...new Set(String(data.get('members') || '').split(',').map(s => s.trim()).filter(Boolean))];
  try {
    const result = await api('/api/studio/trips', { title: String(data.get('title')).trim(), place: String(data.get('place') || '').trim(), startDate: data.get('startDate') || undefined, endDate: data.get('endDate') || undefined, members: names.map(name => ({ name })), photoIds: [...state.importSelected] });
    $('trip-dialog').close(); state.mode = 'live'; state.trip = null; state.view = 'memories'; resetFilters(); state.selected.clear(); await refreshAIStatus(); await loadTrip(result.trip.id); announce('Your trip is saved. Open a photo to add context, or prepare your first set.');
  } catch (error) { $('trip-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 180); });
async function pollWorkspace() {
  if (state.mode !== 'live' || document.visibilityState !== 'visible') return;
  await refreshAIStatus();
  if (state.mode === 'live' && state.trip) await checkAnalysisJobs();
}
setInterval(pollWorkspace, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollWorkspace(); });
async function initialize() {
  let previous;
  try { previous = JSON.parse(sessionStorage.getItem('afterglow-view') || 'null'); } catch { /* Start with the demo if browser storage is unavailable. */ }
  if (previous?.mode === 'live') {
    state.mode = 'live'; state.trip = null; state.photos = []; state.loading = true; render();
    await refreshAIStatus();
    await loadLiveTrips();
    if (state.mode === 'live' && previous.datasetId === state.ai?.datasetId && state.trips.some(trip => trip.id === previous.tripId)) await loadTrip(previous.tripId);
  } else { loadSaved(); render(); }
}
initialize();
