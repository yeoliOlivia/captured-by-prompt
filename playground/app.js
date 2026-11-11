import { strictnessValue, visibleMatches } from './search-utils.js';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="playground-session"]').content;
let searchActive = false, searchSequence = 0;
try { const saved = sessionStorage.getItem('captured-active-query'); if (saved) { searchActive = true; $('prompt').value = saved; } } catch {}
let state, uploading = false, searching = false, showingResults = false, signature = '', lastError = '', stateIdentity = '', contextVersion = '', savingContext = false, refreshSequence = 0;
async function request(path, body, extra = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'x-playground-session': token, 'content-type': 'application/json', ...extra.headers }, body: JSON.stringify(body), ...extra });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Request failed.');
  return result;
}
function notice(text, error = false) { $('notice').textContent = text; $('notice').hidden = !text; $('notice').dataset.error = String(error); }
let galleryPhotos = [], galleryRanked = false, visiblePhotos = 60;
function gallery(photos, ranked = false, keepPage = false) {
  if (searchActive && !ranked) return;
  if (ranked) photos = visibleMatches(photos,strictnessValue($('threshold').value),$('uncertain').checked,lastSearch?.results ?? photos);
  if (!keepPage) visiblePhotos = 60;
  galleryPhotos = photos; galleryRanked = ranked;
  $('gallery').replaceChildren();
  if (!photos.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = ranked ? 'No close matches. Move the slider toward Broader, or include uncertain assessments after a visual check.' : 'Add some photos to start your collection.'; $('gallery').append(empty); }
  photos.slice(0,visiblePhotos).forEach((photo, index) => {
    const figure = document.createElement('figure'); figure.className = 'photo';
    const wrap = document.createElement('button'); wrap.type = 'button'; wrap.className = 'photo-image'; wrap.setAttribute('aria-label',`Open ${photo.name}`); wrap.onclick = () => openPhoto(photo);
    const img = document.createElement('img'); img.src = photo.image; img.alt = `Photo ${index + 1}`; img.loading = 'lazy'; wrap.append(img);
    const badge = document.createElement('span'); badge.className = 'rank'; badge.textContent = ranked ? `#${index + 1}` : photo.indexed ? 'Ready' : 'Not analyzed'; wrap.append(badge);
    const caption = document.createElement('figcaption'); caption.textContent = photo.name;
    figure.append(wrap, caption);
    if (photo.verification) {
      const details = document.createElement('details'); details.className = 'details';
      const summary = document.createElement('summary');
      summary.textContent = {match:'All requirements matched (AI assessment)',uncertain:'Uncertain match',mismatch:'Does not meet every requirement'}[photo.verification.verdict];
      details.append(summary);
      photo.verification.checks.forEach((check,i)=>{ const line = document.createElement('p'); line.textContent = `${i+1}. ${check.status}: ${check.evidence}`; details.append(line); });
      figure.append(details);
    }
    $('gallery').append(figure);
  });
  $('more').hidden = visiblePhotos >= photos.length;
  $('more').textContent = `Show more (${Math.min(visiblePhotos,photos.length)} of ${photos.length})`;
}
async function refresh(preserveClarification = false) {
  const sequence = ++refreshSequence;
  const response = await fetch('/state'); if (!response.ok) throw new Error('Could not load collection.');
  const nextState = await response.json();
  if (sequence !== refreshSequence) return;
  const wasConfigured = state?.configured;
  state = nextState;
  // Loading or forgetting a key changes whether trip photos can be checked; the trip panel must not stay stale.
  if (state.configured !== wasConfigured && $('trip-panel').open) loadTrip().catch(()=>{});
  const nextIdentity = JSON.stringify([state.datasetId,state.provider,state.model,state.dimensions]);
  const changed = stateIdentity && (stateIdentity !== nextIdentity || contextVersion !== state.contextVersion);
  if (stateIdentity && (stateIdentity !== nextIdentity || (contextVersion !== state.contextVersion && !preserveClarification && !savingContext))) {
    searchSequence++; cancelClarification(); signature = '';
    if (searchActive) emptySearch('The workspace model or saved context changed. Run your search again.');
  }
  stateIdentity = nextIdentity;
  contextVersion = state.contextVersion;
  $('connection-status').textContent = state.configured ? `${state.providerLabel} key loaded` : 'API key not loaded';
  $('key-form').hidden = state.configured; $('connected-controls').hidden = !state.configured;
  // Modal without a Gemini key has embeddings only: personal context and visual checks need a vision model.
  const vision = !state.configured || state.visionAvailable !== false;
  for (const id of ['use-context','verify']) {
    const box = $(id);
    if (!vision && !box.disabled) { box.dataset.wasChecked = String(box.checked); box.checked = false; }
    if (vision && box.disabled) box.checked = box.dataset.wasChecked === 'true';
    box.disabled = !vision; box.title = vision ? '' : 'Needs a Gemini key alongside Modal (Model connection).';
  }
  $('index-status').textContent = `${state.indexed} of ${state.total} photos ready`;
  $('index-detail').textContent = state.indexing ? `Analyzing ${state.current}…` : `${state.providerLabel} reads the image pixels. No captions or filename matching.`;
  $('progress').max = Math.max(1,state.total); $('progress').value = state.indexed;
  $('index').disabled = !state.configured || state.indexing || state.searching || uploading || state.indexed === state.total;
  $('index').textContent = state.indexed ? 'Analyze remaining' : 'Analyze photos';
  $('pause').hidden = !state.indexing;
  // Without a key the button stays clickable and opens the connection sheet, so it never looks broken.
  $('search').disabled = (state.configured && !state.indexed) || state.indexing || state.searching || searching || uploading;
  $('search').title = state.configured ? '' : 'Load a model key first';
  $('files').disabled = uploading || state.indexing || state.searching;
  $('disconnect').disabled = state.indexing || state.searching;
  $('folder').textContent = state.datasetDir;
  $('calls').textContent = `${state.model} · ${state.dimensions.toLocaleString()} dimensions · Requests this session: ${state.imageCalls} image / ${state.queryCalls} search / ${state.verificationCalls} visual check / ${state.contextCalls} context`;
  if (state.error && state.error !== lastError) notice(state.error, true); lastError = state.error;
  const next = JSON.stringify(state.photos);
  if (!searchActive && next !== signature) { gallery(state.photos,false,true); signature = next; }
  if (!searchActive) $('results-subtitle').textContent = `${state.total} saved photos · ${state.indexed} searchable`;
  if (changed) await loadMemories();
}
$('key-form').onsubmit = async e => { e.preventDefault(); $('connect').disabled = true; try { const modal = $('provider').value === 'modal'; await request('/connect', { key: $('key').value, provider: $('provider').value, ...(modal ? { endpoint: $('modal-endpoint').value.trim() || undefined, visionKey: $('vision-key').value.trim() || undefined } : {}) }); $('key').value = ''; $('vision-key').value = ''; if (searchActive) emptySearch('Run your search again with the connected provider.'); if (!searchActive) { showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; } $('requirements').hidden = true; notice('Key loaded. Analyze your photos to make them searchable.'); await refresh(); $('settings').close(); } catch(e) { notice(e.message,true); } finally { $('connect').disabled = false; } };
$('disconnect').onclick = async () => { try { await request('/disconnect',{}); await refresh(); notice('Key forgotten. Saved photos and embeddings are still here.'); } catch(e) { notice(e.message,true); } };
$('index').onclick = async () => { $('index').disabled = true; try { await request('/index',{}); notice('Analyzing images with the selected provider. Completed photos are saved as we go.'); await refresh(); } catch(e) { notice(e.message,true); } };
$('pause').onclick = async () => { try { await request('/pause',{}); notice('Pausing after the current photo finishes.'); } catch(e) { notice(e.message,true); } };
let lastSearch = null, pendingSearch = null, memories = [], editingMemory = null, editingTerm = null, selectedPhotos = new Set(), pickerLimit = 60;
try { $('threshold').value = strictnessValue(localStorage.getItem('captured-search-strictness-v1')); } catch {}
function renderMatches() {
  const threshold = strictnessValue($('threshold').value);
  $('threshold').setAttribute('aria-valuetext',threshold === 0 ? 'Broadest' : threshold === 1 ? 'Strictest' : threshold < 0.5 ? 'Broader matches' : threshold > 0.5 ? 'Stricter matches' : 'Balanced');
  $('threshold').disabled = !lastSearch || !showingResults;
  $('threshold-reset').disabled = !lastSearch || !showingResults;
  $('threshold-help').textContent = lastSearch && showingResults ? 'Adjusts to this search: broader shows more, stricter keeps the closest matches.' : 'Search to filter photos by similarity. Browse collection shows all photos without a similarity filter.';
  if (!lastSearch || !showingResults) return;
  const filtered = visibleMatches(lastSearch.results,threshold,$('uncertain').checked);
  gallery(filtered,true);
  $('results-subtitle').textContent = lastSearch.verified
    ? `${filtered.length} shown · ${lastSearch.checked} of ${lastSearch.totalCandidates} candidates visually checked. Other matches may exist.`
    : `${filtered.length} matches · ${lastSearch.results.length-filtered.length} hidden by the search filter`;
}
$('threshold').oninput = () => { try {localStorage.setItem('captured-search-strictness-v1',$('threshold').value);} catch {} renderMatches(); };
$('threshold-reset').onclick = () => { $('threshold').value = 0.5; $('threshold').oninput(); };
$('uncertain').onchange = renderMatches;
renderMatches();
function emptySearch(message) {
  lastSearch = null; showingResults = true; $('requirements').hidden = true; $('context-used').hidden = true;
  gallery([],true); $('gallery').querySelector('.empty').textContent = message;
  $('results-title').textContent = 'Search results'; $('results-subtitle').textContent = ''; renderMatches();
}
if (searchActive) emptySearch('Run your search again to load matching photos, or choose Browse collection.');
function cancelClarification() { pendingSearch = null; $('clarification').hidden = true; }
function showQuestion(question) {
  $('clarification').hidden = false;
  $('clarification-title').textContent = question.choices.length ? `Which “${question.term}” do you mean?` : `What does “${question.term}” mean to you?`;
  $('clarification-detail').textContent = question.choices.length ? 'Choose a saved memory. This choice applies to this search; an ambiguous name will still ask next time.' : 'Add a name, a distinguishing label if helpful, and reference photos. Your search will continue after you save.';
  $('context-choices').replaceChildren();
  const choices = question.choices.length ? question.choices : memories.filter(m=>m.kind===question.kind);
  if (!question.choices.length && choices.length) $('clarification-detail').textContent = 'Choose a saved memory to remember this phrase as another name, or add a new memory. Your search will then continue.';
  for (const memory of choices) {
    const button = document.createElement('button'); button.className = 'secondary'; button.type = 'button';
    button.textContent = `${memory.name}${memory.qualifier ? ' · '+memory.qualifier : ''}`;
    if (memory.photoIds[0]) { const img = document.createElement('img'); img.src = `/photos/${memory.photoIds[0]}`; img.alt = ''; img.style.cssText = 'width:44px;height:44px;object-fit:cover;border-radius:7px;vertical-align:middle;margin-right:8px'; button.prepend(img); }
    button.onclick = async () => {
      if (!pendingSearch || searching) return;
      button.disabled = true; savingContext = true;
      try {
        if (!question.choices.length) { await request('/context/save',{...memory,isMe:question.term==='me' ? true : memory.isMe,aliases:question.term==='me' ? memory.aliases : [...new Set([...memory.aliases,question.term])]}); await loadMemories(); await refresh(true); }
        pendingSearch.bindings[question.term] = memory.id; await runSearch(pendingSearch);
      } catch(e) { notice(e.message,true); } finally {button.disabled = false;savingContext = false;}
    };
    $('context-choices').append(button);
  }
  $('new-context').onclick = () => openMemory(null,question);
}
async function runSearch(payload) {
  if (searching) return;
  const sequence = ++searchSequence; searchActive = true;
  try { sessionStorage.setItem('captured-active-query',payload.query); } catch {}
  emptySearch('Searching… Matching photos will appear here when the search finishes.');
  searching = true; $('search').disabled = true; $('search').textContent = 'Searching…'; $('clarification').hidden = true;
  try {
    const result = await request('/search',payload);
    if (sequence !== searchSequence) return;
    if (result.needsClarification) { emptySearch('Answer the context question to continue. No matches are shown yet.'); pendingSearch = payload; showQuestion(result.questions[0]); notice('A little context is needed before this search can continue.'); return; }
    cancelClarification(); lastSearch = result; showingResults = true;
    $('results-title').textContent = result.verified ? 'Checked matches' : 'Matching photos';
    $('requirements').hidden = !result.verified;
    $('requirements').textContent = result.verified ? result.requirements.map((r,i)=>`${i+1}. ${r}`).join(' • ') : '';
    $('context-used').hidden = !result.contextUsed?.length;
    $('context-used').replaceChildren();
    if (result.contextUsed?.length) { $('context-used').append('Using as reference: '); for (const used of result.contextUsed) { const m = memories.find(x=>x.id===used.id) ?? used; const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'chip'; if (m.photoIds?.length) chip.append(avatar(m,22)); chip.append(`${m.name}${m.qualifier ? ' ('+m.qualifier+')' : ''}`); chip.title = 'Review or edit this memory'; chip.onclick = () => { const saved = memories.find(x=>x.id===m.id); if (saved) { cancelClarification(); openMemory(saved); } }; $('context-used').append(chip); } }
    renderMatches();
    notice(result.verified ? 'Showing matches at your chosen strictness. You can include uncertain assessments; failed checks stay hidden. Personal reference similarity helps select candidates, but does not establish identity.' : 'Showing matches at your chosen strictness. Broaden the slider to see more.');
  } catch(e) { if (sequence === searchSequence) { emptySearch('Search did not finish. Try again; no unfiltered photos are shown.'); notice(e.message,true); if (pendingSearch) $('clarification').hidden = false; } }
  finally { searching = false; $('search').textContent = 'Search'; await refresh().catch(e=>notice(e.message,true)); }
}
$('search-form').onsubmit = e => { e.preventDefault(); if ($('search').disabled) return; if (!state?.configured) { notice('Load a Gemini, Qwen or Modal key to search. Your photos and saved analysis are still here.',true); $('settings').showModal(); return; } cancelClarification(); $('memory-form').hidden = true; runSearch({query:$('prompt').value,verify:$('verify').checked,context:$('use-context').checked,bindings:{}}); };
$('skip-context').onclick = () => { if (!pendingSearch) return; const payload = {...pendingSearch,context:false,bindings:{}}; cancelClarification(); runSearch(payload); };
$('cancel-context').onclick = () => { cancelClarification(); emptySearch('Search canceled. Search again or choose Browse collection.'); $('memory-form').hidden = true; notice('Search canceled.'); };
$('reset').onclick = () => { searchSequence++; searchActive = false; try {sessionStorage.removeItem('captured-active-query');} catch {} cancelClarification(); lastSearch = null; $('context-used').hidden = true; if (!searchActive) { showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; } $('prompt').value = ''; $('requirements').hidden = true; renderMatches(); notice(''); refresh().catch(e=>notice(e.message,true)); };
async function upload(files) {
  if (uploading || state?.indexing || state?.searching) { notice('Wait for the current operation to finish.',true); return; }
  uploading = true; let added = 0, duplicates = 0; const failures = [];
  try {
    await refresh();
    for (const [i,file] of [...files].entries()) {
      $('upload-status').textContent = `Saving ${i+1} of ${files.length}: ${file.name}`;
      if (file.size > 25*1024*1024) { failures.push(`${file.name}: larger than 25 MB`); continue; }
      try { const response = await fetch('/upload',{method:'POST',headers:{'content-type':'application/octet-stream','x-playground-session':token,'x-file-name':encodeURIComponent(file.name)},body:file}); const result = await response.json(); if (!response.ok) throw new Error(result.message); result.duplicate ? duplicates++ : added++; }
      catch(e) { failures.push(`${file.name}: ${e.message}`); }
    }
    if (!searchActive) { showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; }
    notice(failures.length ? failures.join(' • ') : `${added} photos saved${duplicates ? `; ${duplicates} duplicates skipped` : ''}. ${state.configured ? 'Click Analyze photos to index them.' : 'Add your provider key when you’re ready to analyze them.'}`,!!failures.length);
  } finally { uploading = false; $('files').value = ''; $('upload-status').textContent = `${added} saved · ${duplicates} duplicates · ${failures.length} failed`; await refresh().catch(e=>notice(e.message,true)); }
}
$('files').onchange = e => upload(e.target.files).catch(e=>notice(e.message,true));
$('drop').ondragover = e => { e.preventDefault(); $('drop').classList.add('drag'); };
$('drop').ondragleave = () => $('drop').classList.remove('drag');
$('drop').ondrop = e => { e.preventDefault(); $('drop').classList.remove('drag'); upload(e.dataTransfer.files).catch(e=>notice(e.message,true)); };
refresh().catch(e=>notice(e.message,true));
setInterval(()=>refresh().catch(()=>notice('Server unavailable. Restart it and reload this page.',true)),1500);

$('scan').onclick = async () => {
  $('scan').disabled = true;
  try {
    const result = await request('/scan',{});
    if (!searchActive) { showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; }
    notice(`${result.added} new photos imported from sample-dataset.${result.skipped.length ? ` ${result.skipped.length} files skipped (unreadable or collection limit).` : ''}`,!!result.skipped.length);
    await refresh();
  } catch(e) { notice(e.message,true); }
  finally { $('scan').disabled = false; }
};

$('more').onclick = () => { visiblePhotos += 60; gallery(galleryPhotos,galleryRanked,true); };

const providerNotes = {
  gemini: 'Google AI Studio key. Your existing Gemini index stays saved when switching providers.',
  qwen: 'Requires an Alibaba Model Studio Beijing-region key. Photos are sent to that region. Hosted qwen3-vl-embedding is not the open Qwen3-VL-Embedding-8B checkpoint. Qwen requires its own image index; your Gemini index stays saved.',
  modal: 'Your own Modal deployment (inference/README.md). Paste its INFERENCE_TOKEN as the key. Photos go only to your Modal account for embedding. The first request after 5 idle minutes waits for the model to start, often a minute or more. Modal needs its own image index; your other indexes stay saved. Add a Gemini key for visual checking, personal context and trip people checks.',
};
$('provider').onchange = () => {
  $('key').value = ''; $('vision-key').value = '';
  const modal = $('provider').value === 'modal';
  $('modal-fields').hidden = !modal;
  $('key').placeholder = modal ? 'Paste your INFERENCE_TOKEN' : 'Paste your API key';
  $('provider-note').textContent = providerNotes[$('provider').value];
};

async function loadMemories() {
  const response = await fetch('/context'); if (!response.ok) throw new Error('Could not load personal context.');
  memories = (await response.json()).memories;
  renderTripChoices();
  renderMemoryList();
}
// The People screen: one tab per kind, a face tile per person, a wide card per trip.
let memoryTab = 'person', memoryFilter = '';
const kindTab = m => m.kind === 'person' || m.kind === 'event' || m.kind === 'place' ? m.kind : 'other';
const memoryTitle = m => `${m.name}${m.qualifier ? ' · '+m.qualifier : ''}`;
function avatar(m, size) {
  if (m.photoIds[0]) { const img = document.createElement('img'); img.src = `/photos/${m.photoIds[0]}`; img.alt = ''; img.className = 'avatar'; img.style.width = img.style.height = `${size}px`; return img; }
  const span = document.createElement('span'); span.className = 'avatar initial'; span.setAttribute('aria-hidden','true');
  span.textContent = (m.name.trim()[0] ?? '?').toUpperCase(); span.style.width = span.style.height = `${size}px`; span.style.fontSize = `${Math.round(size*0.36)}px`; return span;
}
function renderMemoryList() {
  for (const button of document.querySelectorAll('#memory-tabs button')) { button.querySelector('span').textContent = memories.filter(m=>kindTab(m)===button.dataset.tab).length; button.setAttribute('aria-pressed',String(button.dataset.tab===memoryTab)); }
  const shown = memories.filter(m=>kindTab(m)===memoryTab && (!memoryFilter || [m.name,m.qualifier,...m.aliases].some(a=>a.toLowerCase().includes(memoryFilter))));
  const list = $('memory-list'); list.replaceChildren(); list.dataset.tab = memoryTab;
  for (const m of shown) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'memory-row'; card.setAttribute('aria-label',`Review or edit ${memoryTitle(m)}`);
    card.onclick = ()=>{cancelClarification(); openMemory(m);};
    const text = document.createElement('div'); text.className = 'memory-text';
    const name = document.createElement('strong'); name.textContent = memoryTitle(m);
    const sub = document.createElement('small');
    if (m.kind === 'event') {
      const members = m.memberIds.map(id=>memories.find(p=>p.id===id)).filter(Boolean);
      sub.textContent = `${m.startDate && m.endDate ? `${m.startDate} to ${m.endDate}` : 'No dates'} · ${members.length} people`;
      const faces = document.createElement('div'); faces.className = 'faces'; for (const p of members.slice(0,8)) faces.append(avatar(p,32));
      text.append(name,sub,faces); card.append(text);
    } else {
      const trips = memories.filter(t=>t.memberIds?.includes(m.id)).length;
      sub.textContent = `${m.photoIds.length} ${m.photoIds.length === 1 ? 'ref' : 'refs'}${m.kind === 'person' ? ` · ${trips} ${trips === 1 ? 'trip' : 'trips'}` : ` · ${m.kind}`}`;
      if (m.isMe) { const me = document.createElement('span'); me.className = 'me'; me.textContent = 'me'; card.append(me); }
      text.append(name,sub); card.append(avatar(m,88),text);
    }
    list.append(card);
  }
  const add = document.createElement('button'); add.type = 'button'; add.className = 'memory-row add';
  add.textContent = memoryTab === 'person' ? 'Add a person' : memoryTab === 'event' ? 'New trip' : memoryTab === 'place' ? 'Add a place' : 'Add memory';
  add.onclick = () => startMemory(memoryTab === 'other' ? 'object' : memoryTab);
  list.append(add);
}
function startMemory(kind) {
  cancelClarification(); openMemory(null);
  $('memory-kind').value = kind; $('memory-kind').dispatchEvent(new Event('change')); renderMemberChoices([]);
}
function openMemory(memory, question = null) {
  editingMemory = memory; editingTerm = question?.term ?? null; selectedPhotos = new Set(memory?.photoIds ?? []);
  showScreen('people'); $('memory-form').hidden = false; $('photo-picker').hidden = true; $('context-error').textContent = '';
  $('memory-heading').textContent = memory ? 'Edit memory' : 'Add memory';
  $('memory-kind').value = memory?.kind ?? question?.kind ?? 'person';
  $('memory-name').value = memory?.name ?? (question?.term === 'me' ? '' : question?.term ?? '');
  $('memory-qualifier').value = memory?.qualifier ?? '';
  $('memory-aliases').value = memory?.aliases.join(', ') ?? (question && question.term !== 'me' ? question.term : '');
  $('memory-notes').value = memory?.notes ?? '';
  $('memory-start').value = memory?.startDate ?? ''; $('memory-end').value = memory?.endDate ?? '';
  $('memory-me').checked = memory?.isMe ?? question?.term === 'me';
  $('memory-kind').disabled = !!question;
  renderMemberChoices(memory?.memberIds ?? []);
  $('delete-memory').hidden = !memory;
  $('delete-memory').textContent = 'Delete memory';
  $('save-memory').textContent = pendingSearch ? 'Save and continue search' : 'Save memory';
  updateSelection(); previewDates(); $('memory-name').focus();
}
function updateSelection() {
  $('selection-count').textContent = ` ${selectedPhotos.size} selected (up to 24)`;
  $('memory-preview').replaceChildren();
  for (const id of selectedPhotos) { const img = document.createElement('img'); img.src = `/photos/${id}`; img.alt = 'Selected reference'; $('memory-preview').append(img); }
}
function renderPicker() {
  // Filter by file or folder name without any model call; search results keep their ranking, the collection is newest first.
  const query = $('picker-search').value.trim().toLowerCase();
  const source = $('picker-results').checked ? galleryPhotos : [...(state?.photos ?? [])].sort((a,b) => (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''));
  const photos = source.filter(p => !query || `${p.folder ?? ''}/${p.name}`.toLowerCase().includes(query));
  $('picker-grid').replaceChildren();
  if (!photos.length) { const p = document.createElement('p'); p.className = 'mode-note'; p.textContent = query ? 'No photos match that name.' : 'No photos to choose from yet.'; $('picker-grid').append(p); }
  for (const photo of photos.slice(0,pickerLimit)) {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed',String(selectedPhotos.has(photo.id))); button.setAttribute('aria-label',`Select ${photo.name}`);
    const img = document.createElement('img'); img.src = photo.image; img.loading = 'lazy'; img.alt = '';
    const name = document.createElement('span'); name.textContent = `${photo.folder ? photo.folder+'/' : ''}${photo.name}`;
    button.append(img,name); button.onclick = () => {
      if (selectedPhotos.has(photo.id)) selectedPhotos.delete(photo.id);
      else if (selectedPhotos.size < 24) selectedPhotos.add(photo.id);
      else { $('context-error').textContent = 'Choose up to 24 reference photos.'; return; }
      button.setAttribute('aria-pressed',String(selectedPhotos.has(photo.id))); updateSelection();
    }; $('picker-grid').append(button);
  }
  $('picker-more').hidden = pickerLimit >= photos.length;
}
$('pick-photos').onclick = () => { $('photo-picker').hidden = false; pickerLimit = 60; renderPicker(); };
$('picker-more').onclick = () => { pickerLimit += 60; renderPicker(); };
$('picker-results').onchange = () => { pickerLimit = 60; renderPicker(); };
$('picker-search').oninput = () => { pickerLimit = 60; renderPicker(); };
$('picker-done').onclick = () => { $('photo-picker').hidden = true; };
$('add-memory').onclick = () => { cancelClarification(); openMemory(null); };
$('close-memory').onclick = () => { $('memory-form').hidden = true; };
$('memory-panel').addEventListener('toggle',()=>{if ($('memory-panel').open) loadMemories().catch(e=>notice(e.message,true));});
$('memory-form').onsubmit = async e => {
  e.preventDefault(); $('save-memory').disabled = true; $('context-error').textContent = ''; savingContext = true;
  try {
    const payload = {memberIds:$('memory-kind').value==='event' ? [...$('memory-members').querySelectorAll('input:checked')].map(i=>i.value) : [],kind:$('memory-kind').value,name:$('memory-name').value,qualifier:$('memory-qualifier').value,aliases:$('memory-aliases').value.split(',').map(s=>s.trim()).filter(Boolean),notes:$('memory-notes').value,photoIds:[...selectedPhotos],isMe:$('memory-me').checked,startDate:$('memory-start').value,endDate:$('memory-end').value};
    if (editingMemory) {payload.id = editingMemory.id; payload.revision = editingMemory.revision;}
    const {memory} = await request('/context/save',payload);
    await loadMemories(); await refresh(true); $('memory-form').hidden = true;
    if (searchActive) emptySearch('Context changed. Search again to refresh your matches.'); else signature = '';
    if (pendingSearch) {
      if (editingTerm) pendingSearch.bindings[editingTerm] = memory.id;
      await runSearch(pendingSearch);
    } else { notice('Memory saved on this Mac. Future personal searches can use it.'); await refresh(); }
  } catch(e) { $('context-error').textContent = e.message; }
  finally { $('save-memory').disabled = false; savingContext = false; }
};
$('delete-memory').onclick = async () => {
  if (!editingMemory) return;
  const trips = memories.filter(m=>m.memberIds?.includes(editingMemory.id));
  const confirmText = trips.length ? `Delete ${editingMemory.name} and remove them from ${trips.length === 1 ? trips[0].name : `${trips.length} trips`}?` : 'Confirm delete';
  if ($('delete-memory').textContent !== confirmText) { $('delete-memory').textContent = confirmText; return; }
  try {
    const result = await request('/context/delete',{id:editingMemory.id,revision:editingMemory.revision});
    $('memory-form').hidden = true; cancelClarification(); if (searchActive) emptySearch('Context changed. Search again to refresh your matches.'); else signature = '';
    await loadMemories(); await refresh(); notice(result.trips?.length ? `Memory deleted and removed from ${result.trips.join(', ')}. Photos and their embeddings remain saved.` : 'Memory deleted. Photos and their embeddings remain saved.');
  } catch(e) { $('context-error').textContent = e.message; }
};
loadMemories().catch(e=>notice(e.message,true));

function renderMemberChoices(selected) {
  // Face tiles in two rows; the + or − badge moves a person between them. Hidden checkboxes carry the value.
  const people = memories.filter(m=>m.kind==='person');
  const on = $('members-on'), off = $('members-off'); on.replaceChildren(); off.replaceChildren();
  if (!people.length) { const p = document.createElement('span'); p.className = 'mode-note'; p.textContent = 'No saved people yet. Add each person first, with clear reference photos.'; off.append(p); }
  for (const person of people) {
    const checked = selected.includes(person.id);
    const tile = document.createElement('label'); tile.className = 'member-tile';
    const box = document.createElement('input'); box.type = 'checkbox'; box.value = person.id; box.checked = checked;
    box.setAttribute('aria-label',checked ? `Remove ${person.name} from this trip` : `Add ${person.name} to this trip`);
    box.onchange = () => renderMemberChoices([...$('memory-members').querySelectorAll('input:checked')].map(i=>i.value));
    const badge = document.createElement('span'); badge.className = 'badge'; badge.setAttribute('aria-hidden','true');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = `${memoryTitle(person)}${person.isMe ? ' (me)' : ''}`;
    tile.append(box,avatar(person,64),badge,name); (checked ? on : off).append(tile);
  }
  $('members-on-empty').hidden = !!on.children.length;
  $('members-off-label').hidden = !off.children.length;
  $('memory-members-field').hidden = $('memory-kind').value !== 'event';
  $('memory-me').closest('label').hidden = $('memory-kind').value !== 'person';
}
$('memory-kind').addEventListener('change',()=>{ $('memory-members-field').hidden = $('memory-kind').value !== 'event'; $('memory-me').closest('label').hidden = $('memory-kind').value !== 'person'; });

// Trip photo pooling
let tripTimer = null;
function renderTripChoices() {
  const trips = memories.filter(m=>m.kind==='event' && m.memberIds?.length);
  const current = $('trip-select').value;
  $('trip-select').replaceChildren();
  for (const trip of trips) { const option = document.createElement('option'); option.value = trip.id; option.textContent = `${trip.name}${trip.qualifier ? ' · '+trip.qualifier : ''} (${trip.startDate} to ${trip.endDate})`; $('trip-select').append(option); }
  if (trips.some(t=>t.id===current)) $('trip-select').value = current;
  $('trip-tag').disabled = $('trip-edit').disabled = !trips.length;
  renderTripStrip().catch(()=>{});
  if (!trips.length) { $('trip-summary').textContent = 'No trips with members yet. Add a trip or event with dates and members under My context.'; $('trip-members').replaceChildren(); }
  else if ($('trip-panel').open) loadTrip().catch(e=>notice(e.message,true));
}
async function loadTrip() {
  const id = $('trip-select').value; if (!id) return;
  for (const card of $('trip-strip').children) card.setAttribute('aria-pressed',String(card.dataset.id === id));
  const response = await fetch(`/trips/${id}`); const trip = await response.json();
  if (!response.ok) throw new Error(trip.message || 'Could not load trip.');
  const progress = trip.tagging ? ` Checking ${trip.tagging.done} of ${trip.tagging.total}…` : '';
  // Say why the button is off: a greyed button with no reason reads as a page that is still loading.
  const needsKey = !!trip.pending && !trip.tagging && !state?.configured;
  $('trip-summary').textContent = `${trip.photos} trip photos from ${trip.contributors.length ? trip.contributors.join(', ') : 'unknown phones'} · ${trip.pending} not yet checked · ${trip.undated} photos in the collection have no capture date.${progress}${trip.error ? ' '+trip.error : ''}${needsKey ? ' Load a provider key under Model connection to check who is in them.' : ''}`;
  $('trip-tag').disabled = !!trip.tagging || !trip.pending || !state?.configured;
  $('trip-tag').textContent = trip.tagging ? 'Checking…' : needsKey ? 'Load a model key to find people' : trip.pending ? `Find people in ${trip.pending} photos (${Math.ceil(trip.pending/12)} requests)` : 'All trip photos checked';
  clearTimeout(tripTimer); if (trip.tagging) tripTimer = setTimeout(()=>loadTrip().catch(()=>{}),1500);
  const includeUncertain = $('trip-uncertain').checked;
  $('trip-members').replaceChildren();
  for (const member of trip.members) {
    const section = document.createElement('div'); section.className = 'trip-member';
    const heading = document.createElement('div'); heading.className = 'trip-head';
    const title = document.createElement('strong'); title.textContent = `${member.name}${member.qualifier ? ' · '+member.qualifier : ''}`;
    const saved = memories.find(m=>m.id===member.id); heading.append(saved ? avatar(saved,40) : '', title);
    const sub = document.createElement('p'); sub.className = 'mode-note'; sub.textContent = `${member.suggested.length} photos from others' phones include them · ${member.uncertain.length} uncertain`;
    const thumbs = document.createElement('div'); thumbs.className = 'trip-thumbs';
    for (const photo of [...member.suggested, ...(includeUncertain ? member.uncertain : [])]) {
      const img = document.createElement('img'); img.src = photo.image; img.loading = 'lazy'; img.alt = photo.name;
      img.title = `${photo.name}${photo.contributor ? ' · from '+photo.contributor : ''} · ${photo.evidence}`;
      if (member.uncertain.includes(photo)) img.className = 'uncertain'; thumbs.append(img);
    }
    const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'secondary'; exportButton.textContent = `Export for ${member.name}`;
    exportButton.disabled = !member.suggested.length && !(includeUncertain && member.uncertain.length);
    exportButton.onclick = async () => {
      exportButton.disabled = true;
      try { const result = await request(`/trips/${trip.trip.id}/export`,{memberId:member.id,includeUncertain}); notice(`${result.written} photos written to ${result.folder} (${result.originals} full-size originals, ${result.copies} resized copies). Location data removed. Review them before sending.`); }
      catch(e) { notice(e.message,true); } finally { exportButton.disabled = false; }
    };
    section.append(heading,sub,thumbs,exportButton); $('trip-members').append(section);
  }
}
$('trip-select').onchange = () => loadTrip().catch(e=>notice(e.message,true));
$('trip-uncertain').onchange = () => loadTrip().catch(e=>notice(e.message,true));
$('trip-panel').addEventListener('toggle',()=>{ if ($('trip-panel').open) loadMemories().catch(e=>notice(e.message,true)); });
$('trip-tag').onclick = async () => {
  $('trip-tag').disabled = true;
  try { const result = await request(`/trips/${$('trip-select').value}/tag`,{}); if (result.tagging) notice(`Checking ${result.photos} trip photos in ${result.requests} visual requests. Results are saved as they finish.`); await loadTrip(); }
  catch(e) { notice(e.message,true); $('trip-tag').disabled = false; }
};

// Screens and theme. The page is one document; the top bar shows one screen at a time.
function showScreen(name) {
  for (const screen of document.querySelectorAll('[data-screen]')) screen.hidden = screen.dataset.screen !== name;
  for (const button of document.querySelectorAll('.nav button')) { if (button.dataset.go === name) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }
  try { sessionStorage.setItem('captured-screen',name); } catch {}
  if (name === 'people' || name === 'trips') loadMemories().catch(e=>notice(e.message,true));
  window.scrollTo({top:0});
}
for (const button of document.querySelectorAll('[data-go]')) button.onclick = () => showScreen(button.dataset.go);
try { const saved = sessionStorage.getItem('captured-screen'); if (saved && document.querySelector(`[data-screen="${saved}"]`)) showScreen(saved); } catch {}
$('theme-toggle').onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('captured-theme',document.documentElement.dataset.theme); } catch {}
};
$('open-settings').onclick = () => $('settings').showModal();
$('close-settings').onclick = () => $('settings').close();
// Without a key nothing can be analyzed or searched, so the connection sheet opens once on load.
let askedForKey = false;
// Waits while the Search screen intro is playing (landing.js sets data-intro), so the sheet does not cover it.
const askForKey = setInterval(() => { if (!state || document.documentElement.dataset.intro === 'playing') return; clearInterval(askForKey); if (!state.configured && !askedForKey) { askedForKey = true; $('settings').showModal(); } },200);

// Trip editing: tabs and filter on the People screen, shortcuts from the Trips screen, and a live count
// of the photos a draft date range would include.
for (const button of document.querySelectorAll('#memory-tabs button')) button.onclick = () => { memoryTab = button.dataset.tab; renderMemoryList(); };
$('memory-filter').oninput = () => { memoryFilter = $('memory-filter').value.trim().toLowerCase(); renderMemoryList(); };
$('trip-edit').onclick = () => { const trip = memories.find(m=>m.id===$('trip-select').value); if (trip) { cancelClarification(); openMemory(trip); } };
$('trip-new').onclick = () => startMemory('event');
async function previewDates() {
  const start = $('memory-start').value, end = $('memory-end').value, line = $('date-count');
  line.hidden = $('memory-kind').value !== 'event' || !start || !end || start > end;
  if (line.hidden) return;
  try { const result = await (await fetch(`/trips/preview?start=${start}&end=${end}`)).json(); line.textContent = `${result.photos} photos fall in these dates · ${result.undated} undated`; }
  catch { line.textContent = ''; }
}
for (const id of ['memory-start','memory-end','memory-kind']) $(id).addEventListener('change',previewDates);

// Trips as a scrollable strip of cards; clicking one selects it for pooling below.
async function renderTripStrip() {
  const trips = memories.filter(m=>m.kind==='event' && m.memberIds?.length);
  const strip = $('trip-strip'); strip.hidden = !trips.length;
  if (!trips.length) { strip.replaceChildren(); return; }
  const summaries = await Promise.all(trips.map(t => fetch(`/trips/${t.id}`).then(r => r.ok ? r.json() : null).catch(() => null)));
  strip.replaceChildren();
  trips.forEach((trip, i) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'trip-card'; card.dataset.id = trip.id;
    card.setAttribute('aria-pressed',String($('trip-select').value === trip.id));
    const cover = document.createElement('div'); cover.className = 'trip-cover';
    const coverId = summaries[i]?.cover ?? trip.photoIds[0];
    if (coverId) { const img = document.createElement('img'); img.src = `/photos/${coverId}`; img.alt = ''; img.loading = 'lazy'; cover.append(img); }
    const body = document.createElement('div'); body.className = 'trip-body';
    const name = document.createElement('strong'); name.textContent = memoryTitle(trip);
    const sub = document.createElement('small'); sub.className = 'mono'; sub.textContent = `${trip.startDate} to ${trip.endDate}${summaries[i] ? ` · ${summaries[i].photos} photos` : ''}`;
    const faces = document.createElement('div'); faces.className = 'faces';
    for (const id of trip.memberIds.slice(0,6)) { const person = memories.find(m=>m.id===id); if (person) faces.append(avatar(person,28)); }
    body.append(name,sub,faces); card.append(cover,body);
    card.onclick = () => { $('trip-select').value = trip.id; loadTrip().catch(e=>notice(e.message,true)); $('trip-panel').scrollIntoView({behavior:'smooth',block:'start'}); };
    strip.append(card);
  });
}

// A photo opened from the grid: what it is, which memories use it, and a way to add it as a reference photo.
let openedPhoto = null;
function openPhoto(photo) {
  openedPhoto = photo;
  $('photo-title').textContent = photo.name; $('photo-large').src = photo.image; $('photo-large').alt = photo.name;
  $('photo-meta').textContent = [photo.folder || null, photo.capturedAt ? photo.capturedAt.slice(0,16).replace('T',' ') : 'no capture date', photo.contributor ? `from ${photo.contributor}'s phone` : null, photo.indexed ? 'analyzed' : 'not analyzed'].filter(Boolean).join(' · ');
  const refs = memories.filter(m=>m.photoIds.includes(photo.id));
  $('photo-refs').replaceChildren(refs.length ? 'Reference photo for: ' : 'Not used as a reference photo yet.');
  for (const m of refs) { const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'chip'; chip.append(avatar(m,22),memoryTitle(m)); chip.onclick = () => { $('photo-dialog').close(); cancelClarification(); openMemory(m); }; $('photo-refs').append(chip); }
  const select = $('photo-person'); select.replaceChildren();
  for (const m of memories.filter(m=>m.kind!=='preference' && !m.photoIds.includes(photo.id))) { const option = document.createElement('option'); option.value = m.id; option.textContent = `${memoryTitle(m)} · ${m.kind}`; select.append(option); }
  $('photo-actions').hidden = !select.children.length; $('photo-error').textContent = '';
  $('photo-dialog').showModal();
}
$('close-photo').onclick = () => $('photo-dialog').close();
$('photo-add-ref').onclick = async () => {
  const m = memories.find(x=>x.id===$('photo-person').value); if (!m || !openedPhoto) return;
  if (m.photoIds.length >= 24) { $('photo-error').textContent = 'That memory already has 24 reference photos.'; return; }
  $('photo-add-ref').disabled = true;
  try {
    await request('/context/save',{...m, photoIds:[...m.photoIds, openedPhoto.id]});
    await loadMemories(); notice(`Added as a reference photo for ${m.name}.`);
    if (searchActive) emptySearch('Context changed. Search again to refresh your matches.'); else signature = '';
    openPhoto(openedPhoto);
  } catch(e) { $('photo-error').textContent = e.message; } finally { $('photo-add-ref').disabled = false; }
};
