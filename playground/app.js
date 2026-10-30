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
    const wrap = document.createElement('div'); wrap.className = 'photo-image';
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
  $('index-status').textContent = `${state.indexed} of ${state.total} photos ready`;
  $('index-detail').textContent = state.indexing ? `Analyzing ${state.current}…` : `${state.providerLabel} reads the image pixels. No captions or filename matching.`;
  $('progress').max = Math.max(1,state.total); $('progress').value = state.indexed;
  $('index').disabled = !state.configured || state.indexing || state.searching || uploading || state.indexed === state.total;
  $('index').textContent = state.indexed ? 'Analyze remaining' : 'Analyze photos';
  $('pause').hidden = !state.indexing;
  $('search').disabled = !state.configured || !state.indexed || state.indexing || state.searching || searching || uploading;
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
$('key-form').onsubmit = async e => { e.preventDefault(); $('connect').disabled = true; try { await request('/connect', { key: $('key').value, provider: $('provider').value }); $('key').value = ''; if (searchActive) emptySearch('Run your search again with the connected provider.'); if (!searchActive) { showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; } $('requirements').hidden = true; notice('Key loaded. Analyze your photos to make them searchable.'); await refresh(); $('key-panel').open = false; } catch(e) { notice(e.message,true); } finally { $('connect').disabled = false; } };
$('disconnect').onclick = async () => { try { await request('/disconnect',{}); await refresh(); $('key-panel').open = true; notice('Key forgotten. Saved photos and embeddings are still here.'); } catch(e) { notice(e.message,true); } };
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
    $('context-used').textContent = result.contextUsed?.length ? 'Using reference context (similarity to query or reference photos): '+result.contextUsed.map(m=>`${m.name}${m.qualifier ? ' ('+m.qualifier+')' : ''}`).join(', ') : '';
    renderMatches();
    notice(result.verified ? 'Showing matches at your chosen strictness. You can include uncertain assessments; failed checks stay hidden. Personal reference similarity helps select candidates, but does not establish identity.' : 'Showing matches at your chosen strictness. Broaden the slider to see more.');
  } catch(e) { if (sequence === searchSequence) { emptySearch('Search did not finish. Try again; no unfiltered photos are shown.'); notice(e.message,true); if (pendingSearch) $('clarification').hidden = false; } }
  finally { searching = false; $('search').textContent = 'Search'; await refresh().catch(e=>notice(e.message,true)); }
}
$('search-form').onsubmit = e => { e.preventDefault(); if ($('search').disabled) return; cancelClarification(); $('memory-form').hidden = true; runSearch({query:$('prompt').value,verify:$('verify').checked,context:$('use-context').checked,bindings:{}}); };
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

$('provider').onchange = () => {
  $('key').value = '';
  $('provider-note').textContent = $('provider').value === 'qwen'
    ? 'Requires an Alibaba Model Studio Beijing-region key. Photos are sent to that region. Hosted qwen3-vl-embedding is not the open Qwen3-VL-Embedding-8B checkpoint. Qwen requires its own image index; your Gemini index stays saved.'
    : 'Google AI Studio key. Your existing Gemini index stays saved when switching providers.';
};

async function loadMemories() {
  const response = await fetch('/context'); if (!response.ok) throw new Error('Could not load personal context.');
  memories = (await response.json()).memories;
  renderTripChoices();
  $('memory-list').replaceChildren();
  if (!memories.length) { const p = document.createElement('p'); p.textContent = 'No saved context yet. Add it here or when a search asks.'; $('memory-list').append(p); }
  for (const m of memories) {
    const row = document.createElement('div'); row.className = 'memory-row';
    const text = document.createElement('div'); text.textContent = `${m.name}${m.qualifier ? ' · '+m.qualifier : ''}${m.isMe ? ' (me)' : ''}`;
    const sub = document.createElement('small'); sub.textContent = `${m.kind} · ${m.photoIds.length} reference photos · confirmed by you · ${new Date(m.updatedAt).toLocaleDateString()}`; text.append(sub);
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'textbutton'; edit.textContent = 'Review / edit'; edit.onclick = ()=>{cancelClarification(); openMemory(m);};
    row.append(text,edit); $('memory-list').append(row);
  }
}
function openMemory(memory, question = null) {
  editingMemory = memory; editingTerm = question?.term ?? null; selectedPhotos = new Set(memory?.photoIds ?? []);
  $('memory-panel').open = true; $('memory-form').hidden = false; $('photo-picker').hidden = true; $('context-error').textContent = '';
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
  updateSelection(); $('memory-name').focus();
}
function updateSelection() {
  $('selection-count').textContent = ` ${selectedPhotos.size} selected (up to 24)`;
  $('memory-preview').replaceChildren();
  for (const id of selectedPhotos) { const img = document.createElement('img'); img.src = `/photos/${id}`; img.alt = 'Selected reference'; $('memory-preview').append(img); }
}
function renderPicker() {
  const photos = $('picker-results').checked ? galleryPhotos : state?.photos ?? [];
  $('picker-grid').replaceChildren();
  for (const photo of photos.slice(0,pickerLimit)) {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed',String(selectedPhotos.has(photo.id))); button.setAttribute('aria-label',`Select ${photo.name}`);
    const img = document.createElement('img'); img.src = photo.image; img.loading = 'lazy'; img.alt = '';
    const name = document.createElement('span'); name.textContent = photo.name;
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
  $('memory-members').replaceChildren();
  const people = memories.filter(m=>m.kind==='person');
  if (!people.length) { const p = document.createElement('span'); p.textContent = 'No saved people yet.'; $('memory-members').append(p); }
  for (const person of people) {
    const label = document.createElement('label'); label.className = 'check';
    const box = document.createElement('input'); box.type = 'checkbox'; box.value = person.id; box.checked = selected.includes(person.id);
    const text = document.createElement('span'); text.textContent = `${person.name}${person.qualifier ? ' · '+person.qualifier : ''}${person.isMe ? ' (me)' : ''}`;
    label.append(box,text); $('memory-members').append(label);
  }
  $('memory-members-field').hidden = $('memory-kind').value !== 'event';
}
$('memory-kind').addEventListener('change',()=>{ $('memory-members-field').hidden = $('memory-kind').value !== 'event'; });

// Trip photo pooling
let tripTimer = null;
function renderTripChoices() {
  const trips = memories.filter(m=>m.kind==='event' && m.memberIds?.length);
  const current = $('trip-select').value;
  $('trip-select').replaceChildren();
  for (const trip of trips) { const option = document.createElement('option'); option.value = trip.id; option.textContent = `${trip.name}${trip.qualifier ? ' · '+trip.qualifier : ''} (${trip.startDate} to ${trip.endDate})`; $('trip-select').append(option); }
  if (trips.some(t=>t.id===current)) $('trip-select').value = current;
  $('trip-tag').disabled = !trips.length;
  if (!trips.length) { $('trip-summary').textContent = 'No trips with members yet. Add a trip or event with dates and members under My context.'; $('trip-members').replaceChildren(); }
  else if ($('trip-panel').open) loadTrip().catch(e=>notice(e.message,true));
}
async function loadTrip() {
  const id = $('trip-select').value; if (!id) return;
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
    const heading = document.createElement('strong'); heading.textContent = `${member.name}${member.qualifier ? ' · '+member.qualifier : ''}`;
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
