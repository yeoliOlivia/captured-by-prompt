import { thresholdValue, visibleMatches } from './search-utils.js';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="playground-session"]').content;
let state, uploading = false, searching = false, showingResults = false, signature = '', lastError = '';
async function request(path, body, extra = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'x-playground-session': token, 'content-type': 'application/json', ...extra.headers }, body: JSON.stringify(body), ...extra });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Request failed.');
  return result;
}
function notice(text, error = false) { $('notice').textContent = text; $('notice').hidden = !text; $('notice').dataset.error = String(error); }
let galleryPhotos = [], galleryRanked = false, visiblePhotos = 60;
function gallery(photos, ranked = false, keepPage = false) {
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
async function refresh() {
  const response = await fetch('/state'); if (!response.ok) throw new Error('Could not load collection.'); state = await response.json();
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
  if (!showingResults && next !== signature) { gallery(state.photos,false,true); signature = next; }
  if (!showingResults) $('results-subtitle').textContent = `${state.total} saved photos · ${state.indexed} searchable`;
}
$('key-form').onsubmit = async e => { e.preventDefault(); $('connect').disabled = true; try { await request('/connect', { key: $('key').value, provider: $('provider').value }); $('key').value = ''; showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; $('requirements').hidden = true; notice('Key loaded. Analyze your photos to make them searchable.'); await refresh(); $('key-panel').open = false; } catch(e) { notice(e.message,true); } finally { $('connect').disabled = false; } };
$('disconnect').onclick = async () => { try { await request('/disconnect',{}); await refresh(); $('key-panel').open = true; notice('Key forgotten. Saved photos and embeddings are still here.'); } catch(e) { notice(e.message,true); } };
$('index').onclick = async () => { $('index').disabled = true; try { await request('/index',{}); notice('Analyzing images with the selected provider. Completed photos are saved as we go.'); await refresh(); } catch(e) { notice(e.message,true); } };
$('pause').onclick = async () => { try { await request('/pause',{}); notice('Pausing after the current photo finishes.'); } catch(e) { notice(e.message,true); } };
let lastSearch = null, pendingSearch = null, memories = [], editingMemory = null, editingTerm = null, selectedPhotos = new Set(), pickerLimit = 60;
try { $('threshold').value = thresholdValue(localStorage.getItem('captured-threshold')); } catch {}
function renderMatches() {
  const threshold = thresholdValue($('threshold').value);
  $('threshold-value').textContent = threshold.toFixed(2);
  if (!lastSearch || !showingResults) return;
  const filtered = visibleMatches(lastSearch.results,threshold,$('uncertain').checked);
  gallery(filtered,true);
  $('results-subtitle').textContent = lastSearch.verified
    ? `${filtered.length} shown · ${lastSearch.checked} of ${lastSearch.totalCandidates} candidates visually checked. Other matches may exist.`
    : `${filtered.length} matches · ${lastSearch.results.length-filtered.length} below the similarity cutoff`;
}
$('threshold').oninput = () => { try {localStorage.setItem('captured-threshold',$('threshold').value);} catch {} renderMatches(); };
$('threshold-reset').onclick = () => { $('threshold').value = 0.5; $('threshold').oninput(); };
$('uncertain').onchange = renderMatches;
renderMatches();
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
      button.disabled = true;
      try {
        if (!question.choices.length) { await request('/context/save',{...memory,isMe:question.term==='me' ? true : memory.isMe,aliases:question.term==='me' ? memory.aliases : [...new Set([...memory.aliases,question.term])]}); await loadMemories(); }
        pendingSearch.bindings[question.term] = memory.id; await runSearch(pendingSearch);
      } catch(e) { notice(e.message,true); } finally {button.disabled = false;}
    };
    $('context-choices').append(button);
  }
  $('new-context').onclick = () => openMemory(null,question);
}
async function runSearch(payload) {
  if (searching) return;
  searching = true; $('search').disabled = true; $('search').textContent = 'Searching…'; $('clarification').hidden = true;
  try {
    const result = await request('/search',payload);
    if (result.needsClarification) { pendingSearch = payload; showQuestion(result.questions[0]); notice('A little context is needed before this search can continue.'); return; }
    cancelClarification(); lastSearch = result; showingResults = true;
    $('results-title').textContent = result.verified ? 'Checked matches' : 'Matching photos';
    $('requirements').hidden = !result.verified;
    $('requirements').textContent = result.verified ? result.requirements.map((r,i)=>`${i+1}. ${r}`).join(' • ') : '';
    $('context-used').hidden = !result.contextUsed?.length;
    $('context-used').textContent = result.contextUsed?.length ? 'Using reference context (similarity to query or reference photos): '+result.contextUsed.map(m=>`${m.name}${m.qualifier ? ' ('+m.qualifier+')' : ''}`).join(', ') : '';
    renderMatches();
    notice(result.verified ? 'Showing matches above your cutoff. You can include uncertain assessments; failed checks stay hidden. Personal reference similarity helps select candidates, but does not establish identity.' : 'Showing photos above your similarity cutoff. Broaden the slider to see more.');
  } catch(e) { notice(e.message,true); if (pendingSearch) $('clarification').hidden = false; }
  finally { searching = false; $('search').textContent = 'Search'; await refresh().catch(e=>notice(e.message,true)); }
}
$('search-form').onsubmit = e => { e.preventDefault(); if ($('search').disabled) return; cancelClarification(); $('memory-form').hidden = true; runSearch({query:$('prompt').value,verify:$('verify').checked,context:$('use-context').checked,bindings:{}}); };
$('skip-context').onclick = () => { if (!pendingSearch) return; const payload = {...pendingSearch,context:false,bindings:{}}; cancelClarification(); runSearch(payload); };
$('cancel-context').onclick = () => { cancelClarification(); $('memory-form').hidden = true; notice('Search canceled.'); };
$('reset').onclick = () => { cancelClarification(); lastSearch = null; $('context-used').hidden = true; showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; $('prompt').value = ''; $('requirements').hidden = true; notice(''); refresh().catch(e=>notice(e.message,true)); };
async function upload(files) {
  if (uploading || state?.indexing || state?.searching) { notice('Wait for the current operation to finish.',true); return; }
  uploading = true; await refresh(); let added = 0, duplicates = 0; const failures = [];
  try {
    for (const [i,file] of [...files].entries()) {
      $('upload-status').textContent = `Saving ${i+1} of ${files.length}: ${file.name}`;
      if (file.size > 25*1024*1024) { failures.push(`${file.name}: larger than 25 MB`); continue; }
      try { const response = await fetch('/upload',{method:'POST',headers:{'content-type':'application/octet-stream','x-playground-session':token,'x-file-name':encodeURIComponent(file.name)},body:file}); const result = await response.json(); if (!response.ok) throw new Error(result.message); result.duplicate ? duplicates++ : added++; }
      catch(e) { failures.push(`${file.name}: ${e.message}`); }
    }
    showingResults = false; signature = ''; $('results-title').textContent = 'Your collection';
    notice(failures.length ? failures.join(' • ') : `${added} photos saved${duplicates ? `; ${duplicates} duplicates skipped` : ''}. ${state.configured ? 'Click Analyze photos to index them.' : 'Add your provider key when you’re ready to analyze them.'}`,!!failures.length);
  } finally { uploading = false; $('files').value = ''; $('upload-status').textContent = `${added} saved · ${duplicates} duplicates · ${failures.length} failed`; await refresh(); }
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
    showingResults = false; signature = ''; $('results-title').textContent = 'Your collection';
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
  e.preventDefault(); $('save-memory').disabled = true; $('context-error').textContent = '';
  try {
    const payload = {kind:$('memory-kind').value,name:$('memory-name').value,qualifier:$('memory-qualifier').value,aliases:$('memory-aliases').value.split(',').map(s=>s.trim()).filter(Boolean),notes:$('memory-notes').value,photoIds:[...selectedPhotos],isMe:$('memory-me').checked,startDate:$('memory-start').value,endDate:$('memory-end').value};
    if (editingMemory) {payload.id = editingMemory.id; payload.revision = editingMemory.revision;}
    const {memory} = await request('/context/save',payload);
    await loadMemories(); $('memory-form').hidden = true;
    lastSearch = null; showingResults = false; signature = ''; $('context-used').hidden = true; $('requirements').hidden = true; $('results-title').textContent = 'Your collection';
    if (pendingSearch) {
      if (editingTerm) pendingSearch.bindings[editingTerm] = memory.id;
      await runSearch(pendingSearch);
    } else { notice('Memory saved on this Mac. Future personal searches can use it.'); await refresh(); }
  } catch(e) { $('context-error').textContent = e.message; }
  finally { $('save-memory').disabled = false; }
};
$('delete-memory').onclick = async () => {
  if (!editingMemory) return;
  if ($('delete-memory').textContent !== 'Confirm delete') { $('delete-memory').textContent = 'Confirm delete'; return; }
  try {
    await request('/context/delete',{id:editingMemory.id,revision:editingMemory.revision});
    $('memory-form').hidden = true; cancelClarification(); lastSearch = null; showingResults = false; signature = ''; $('context-used').hidden = true; $('requirements').hidden = true; $('results-title').textContent = 'Your collection';
    await loadMemories(); await refresh(); notice('Memory deleted. Photos and their embeddings remain saved.');
  } catch(e) { $('context-error').textContent = e.message; }
};
loadMemories().catch(e=>notice(e.message,true));
