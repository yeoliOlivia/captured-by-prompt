// Public demo search. Everything runs in the browser on precomputed data:
//   data/state.json      the sample photos (scripts/build-demo.mjs)
//   data/embeddings.bin  one int8 Gemini image embedding per photo, in state.json order
//   data/prompts.json    Gemini query embeddings for the example searches (scripts/embed-demo-prompts.mjs)
// Ranking is the same as the app's: cosine similarity, then the shared strictness cutoff (strictness.js).
import { DEFAULT_STRICTNESS, strictnessValue, visibleMatches } from './strictness.js';

const $ = id => document.getElementById(id);
const PAGE = 60;
const KEY = 'captured-demo-strictness';
let photos = [], vectors = null, dimensions = 0, prompts = new Map();
let results = null, query = '', shown = PAGE;

function decode(base64) { const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); return new Int8Array(bytes.buffer); }
function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
const normal = text => text.trim().toLocaleLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
function notice(text) { $('notice').hidden = !text; $('notice').textContent = text ?? ''; }

function render(keepPage = false) {
  if (!keepPage) shown = PAGE;
  const list = results ? visibleMatches(results, strictnessValue($('threshold').value), false, results) : photos;
  $('gallery').replaceChildren();
  if (!list.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No close matches. Move the slider toward Broader.'; $('gallery').append(empty); }
  list.slice(0, shown).forEach((photo, index) => {
    const figure = document.createElement('figure'); figure.className = 'photo';
    const link = document.createElement('a'); link.className = 'photo-image'; link.href = photo.image; link.target = '_blank'; link.rel = 'noreferrer'; link.setAttribute('aria-label', `Open ${photo.name}`);
    const img = document.createElement('img'); img.src = photo.image; img.alt = results ? `Match ${index + 1}` : `Sample photo ${index + 1}`; img.loading = 'lazy'; link.append(img);
    if (results) { const badge = document.createElement('span'); badge.className = 'rank'; badge.textContent = `#${index + 1}`; link.append(badge); }
    const caption = document.createElement('figcaption'); caption.textContent = photo.name;
    figure.append(link, caption); $('gallery').append(figure);
  });
  $('more').hidden = shown >= list.length;
  $('more').textContent = `Show more (${Math.min(shown, list.length)} of ${list.length})`;
  $('results-title').textContent = results ? `Results for “${query}”` : 'Sample collection';
  $('results-subtitle').textContent = results ? `${list.length} of ${photos.length} photos at this strictness` : `${photos.length} public sample photos`;
  $('reset').hidden = !results;
}

function search(text) {
  const prompt = prompts.get(normal(text));
  if (!prompt) {
    notice(prompts.size
      ? 'This demo can only run the example searches below for now. Live search for anything you type is coming next.'
      : 'Example searches are not ready yet. Run scripts/embed-demo-prompts.mjs to add them.');
    return;
  }
  notice('');
  query = prompt.text;
  results = photos.map((photo, i) => ({ ...photo, similarity: cosine(prompt.vector, vectors.subarray(i * dimensions, (i + 1) * dimensions)) }))
    .sort((a, b) => b.similarity - a.similarity);
  render();
}

function examples() {
  $('examples').replaceChildren(...[...prompts.values()].map(p => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'example'; button.textContent = p.text;
    button.onclick = () => { $('prompt').value = p.text; search(p.text); };
    return button;
  }));
}

$('search-form').addEventListener('submit', e => { e.preventDefault(); search($('prompt').value); });
$('threshold').oninput = () => { try { localStorage.setItem(KEY, $('threshold').value); } catch {} if (results) render(); };
$('threshold-reset').onclick = () => { $('threshold').value = String(DEFAULT_STRICTNESS); $('threshold').oninput(); };
$('reset').onclick = () => { results = null; query = ''; $('prompt').value = ''; notice(''); render(); };
$('more').onclick = () => { shown += PAGE; render(true); };
$('theme-toggle').onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('captured-theme', document.documentElement.dataset.theme); } catch {}
};
try { const saved = localStorage.getItem(KEY); if (saved !== null) $('threshold').value = String(strictnessValue(saved)); } catch {}

try {
  const [state, bin, list] = await Promise.all([
    fetch('data/state.json').then(r => { if (!r.ok) throw new Error('state'); return r.json(); }),
    fetch('data/embeddings.bin').then(r => { if (!r.ok) throw new Error('embeddings'); return r.arrayBuffer(); }),
    fetch('data/prompts.json').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  photos = state.photos; dimensions = state.dimensions; vectors = new Int8Array(bin);
  if (vectors.length !== photos.length * dimensions) throw new Error('size');
  for (const p of list?.dimensions === dimensions ? list.prompts : []) prompts.set(normal(p.text), { text: p.text, vector: decode(p.embedding) });
  $('demo-count').textContent = String(photos.length);
  examples(); render();
} catch {
  notice('The demo photos could not be loaded. Try reloading the page.');
}
