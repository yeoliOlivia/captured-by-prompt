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
  if (!photos.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = ranked ? 'No candidates available to check.' : 'Add some photos to start your collection.'; $('gallery').append(empty); }
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
  $('calls').textContent = `${state.model} · ${state.dimensions.toLocaleString()} dimensions · Requests this session: ${state.imageCalls} image / ${state.queryCalls} search / ${state.verificationCalls} visual check`;
  if (state.error && state.error !== lastError) notice(state.error, true); lastError = state.error;
  const next = JSON.stringify(state.photos);
  if (!showingResults && next !== signature) { gallery(state.photos,false,true); signature = next; }
  if (!showingResults) $('results-subtitle').textContent = `${state.total} saved photos · ${state.indexed} searchable`;
}
$('key-form').onsubmit = async e => { e.preventDefault(); $('connect').disabled = true; try { await request('/connect', { key: $('key').value, provider: $('provider').value }); $('key').value = ''; showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; $('requirements').hidden = true; notice('Key loaded. Analyze your photos to make them searchable.'); await refresh(); $('key-panel').open = false; } catch(e) { notice(e.message,true); } finally { $('connect').disabled = false; } };
$('disconnect').onclick = async () => { try { await request('/disconnect',{}); await refresh(); $('key-panel').open = true; notice('Key forgotten. Saved photos and embeddings are still here.'); } catch(e) { notice(e.message,true); } };
$('index').onclick = async () => { $('index').disabled = true; try { await request('/index',{}); notice('Analyzing images with the selected provider. Completed photos are saved as we go.'); await refresh(); } catch(e) { notice(e.message,true); } };
$('pause').onclick = async () => { try { await request('/pause',{}); notice('Pausing after the current photo finishes.'); } catch(e) { notice(e.message,true); } };
$('search-form').onsubmit = async e => { e.preventDefault(); if ($('search').disabled) return; searching = true; $('search').disabled = true; $('search').textContent = 'Searching…'; try { const result = await request('/search',{query:$('prompt').value,verify:$('verify').checked}); showingResults = true; gallery(result.results,true); $('results-title').textContent = result.verified ? 'Visually checked candidates' : 'Closest photos';
    $('requirements').hidden = !result.verified;
    $('requirements').textContent = result.verified ? result.requirements.map((r,i)=>`${i+1}. ${r}`).join(' • ') : '';
    $('results-subtitle').textContent = result.verified ? `${result.checked} of ${result.totalCandidates} candidates checked by ${result.verificationModel}` : `${result.results.length} photos ranked by image similarity`;
    notice(result.verified ? `Matches first, then uncertain and nonmatching candidates. Only the top ${result.checked} embedding candidates were checked; other matches may exist. ${result.verificationCached ? 'Reused the saved visual check for this session.' : 'AI judgments can be wrong; open a photo’s assessment to see each check.'}` : result.cached ? 'Reused this query embedding. No additional API call.' : 'Ranked by embedding similarity. Enable double-check to assess individual requirements.'); } catch(e) { notice(e.message,true); } finally { searching = false; $('search').textContent = 'Search'; await refresh().catch(e=>notice(e.message,true)); } };
$('reset').onclick = () => { showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; $('prompt').value = ''; $('requirements').hidden = true; notice(''); refresh().catch(e=>notice(e.message,true)); };
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
