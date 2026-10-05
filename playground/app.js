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
function gallery(photos, ranked = false) {
  $('gallery').replaceChildren();
  if (!photos.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Add some photos to start your collection.'; $('gallery').append(empty); }
  photos.forEach((photo, index) => {
    const figure = document.createElement('figure'); figure.className = 'photo';
    const wrap = document.createElement('div'); wrap.className = 'photo-image';
    const img = document.createElement('img'); img.src = photo.image; img.alt = `Photo ${index + 1}`; img.loading = 'lazy'; wrap.append(img);
    const badge = document.createElement('span'); badge.className = 'rank'; badge.textContent = ranked ? `#${index + 1}` : photo.indexed ? 'Ready' : 'Not analyzed'; wrap.append(badge);
    const caption = document.createElement('figcaption'); caption.textContent = photo.name;
    figure.append(wrap, caption); $('gallery').append(figure);
  });
}
async function refresh() {
  const response = await fetch('/state'); if (!response.ok) throw new Error('Could not load collection.'); state = await response.json();
  $('connection-status').textContent = state.configured ? 'Gemini key loaded' : 'Gemini key not loaded';
  $('key-form').hidden = state.configured; $('connected-controls').hidden = !state.configured;
  $('index-status').textContent = `${state.indexed} of ${state.total} photos ready`;
  $('index-detail').textContent = state.indexing ? `Analyzing ${state.current}…` : 'Gemini reads the image pixels. No captions or filename matching.';
  $('progress').max = Math.max(1,state.total); $('progress').value = state.indexed;
  $('index').disabled = !state.configured || state.indexing || state.searching || uploading || state.indexed === state.total;
  $('index').textContent = state.indexed ? 'Analyze remaining' : 'Analyze photos';
  $('pause').hidden = !state.indexing;
  $('search').disabled = !state.configured || !state.indexed || state.indexing || state.searching || searching || uploading;
  $('files').disabled = uploading || state.indexing || state.searching;
  $('disconnect').disabled = state.indexing || state.searching;
  $('folder').textContent = state.datasetDir;
  $('calls').textContent = `${state.model} · Gemini requests this session: ${state.imageCalls} image / ${state.queryCalls} search`;
  if (state.error && state.error !== lastError) notice(state.error, true); lastError = state.error;
  const next = JSON.stringify(state.photos);
  if (!showingResults && next !== signature) { gallery(state.photos); signature = next; }
  if (!showingResults) $('results-subtitle').textContent = `${state.total} saved photos · ${state.indexed} searchable`;
}
$('key-form').onsubmit = async e => { e.preventDefault(); $('connect').disabled = true; try { await request('/connect', { key: $('key').value }); $('key').value = ''; notice('Key loaded. Analyze your photos to make them searchable.'); await refresh(); $('key-panel').open = false; } catch(e) { notice(e.message,true); } finally { $('connect').disabled = false; } };
$('disconnect').onclick = async () => { try { await request('/disconnect',{}); await refresh(); $('key-panel').open = true; notice('Key forgotten. Saved photos and embeddings are still here.'); } catch(e) { notice(e.message,true); } };
$('index').onclick = async () => { $('index').disabled = true; try { await request('/index',{}); notice('Analyzing images with Gemini. Completed photos are saved as we go.'); await refresh(); } catch(e) { notice(e.message,true); } };
$('pause').onclick = async () => { try { await request('/pause',{}); notice('Pausing after the current photo finishes.'); } catch(e) { notice(e.message,true); } };
$('search-form').onsubmit = async e => { e.preventDefault(); if ($('search').disabled) return; searching = true; $('search').disabled = true; $('search').textContent = 'Searching…'; try { const result = await request('/search',{query:$('prompt').value}); showingResults = true; gallery(result.results,true); $('results-title').textContent = 'Closest photos'; $('results-subtitle').textContent = `${result.results.length} photos ranked by image similarity`; notice(result.cached ? 'Reused this search’s Gemini embedding. No additional API call.' : 'Ranked using a real Gemini query embedding. These are relative matches, not guaranteed matches.'); } catch(e) { notice(e.message,true); } finally { searching = false; $('search').textContent = 'Search'; await refresh().catch(e=>notice(e.message,true)); } };
$('reset').onclick = () => { showingResults = false; signature = ''; $('results-title').textContent = 'Your collection'; $('prompt').value = ''; notice(''); refresh().catch(e=>notice(e.message,true)); };
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
    notice(failures.length ? failures.join(' • ') : `${added} photos saved${duplicates ? `; ${duplicates} duplicates skipped` : ''}. ${state.configured ? 'Click Analyze photos to index them.' : 'Add your Gemini key when you’re ready to analyze them.'}`,!!failures.length);
  } finally { uploading = false; $('files').value = ''; $('upload-status').textContent = `${added} saved · ${duplicates} duplicates · ${failures.length} failed`; await refresh(); }
}
$('files').onchange = e => upload(e.target.files).catch(e=>notice(e.message,true));
$('drop').ondragover = e => { e.preventDefault(); $('drop').classList.add('drag'); };
$('drop').ondragleave = () => $('drop').classList.remove('drag');
$('drop').ondrop = e => { e.preventDefault(); $('drop').classList.remove('drag'); upload(e.dataTransfer.files).catch(e=>notice(e.message,true)); };
refresh().catch(e=>notice(e.message,true));
setInterval(()=>refresh().catch(()=>notice('Server unavailable. Restart it and reload this page.',true)),1500);
