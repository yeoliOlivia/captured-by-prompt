// Search screen intro: drives the scroll story in index.html (#story) from scroll progress, fills it with the user's
// photos and saved context, and keeps search fast: it plays fully once per browser session, the brand and the Search tab
// jump straight to the search bar, and with reduced motion it is hidden by CSS and never runs.
const $ = id => document.getElementById(id);
const root = document.documentElement;
const story = $('story'), screen = document.querySelector('[data-screen="search"]'), hero = screen.querySelector('.hero');
const intro = $('landing-intro'), wrap = $('wheel-wrap'), wheel = $('wheel'), count = $('landing-count'), album = $('album');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SEEN = 'captured-intro-seen';
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = t => 1 - Math.pow(1 - t, 3);
const storyEnd = () => story.getBoundingClientRect().top + scrollY + story.offsetHeight - innerHeight;
let radius = 0;

// Photo wheel: up to 24 library photos on a ring; fewer than 12 are repeated so the ring stays closed.
function buildWheel(photos) {
  wheel.replaceChildren();
  if (!photos.length) { wrap.hidden = true; return; }
  let ring = photos.slice(0, 24);
  while (ring.length < 12) ring = ring.concat(photos).slice(0, 12);
  for (const photo of ring) { const card = document.createElement('div'); card.className = 'wheel-card'; const img = document.createElement('img'); img.src = photo.image; img.alt = ''; img.decoding = 'async'; card.append(img); wheel.append(card); }
  layoutWheel();
}
function layoutWheel() {
  const cards = [...wheel.children]; if (!cards.length) return;
  const cw = Math.max(96, Math.min(200, innerWidth * .17)), step = 360 / cards.length;
  radius = (cw * 1.08) / (2 * Math.tan(Math.PI / cards.length));
  wheel.style.setProperty('--cw', `${cw}px`);
  cards.forEach((card, i) => card.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`);
}
function setCount(state) {
  count.replaceChildren();
  if (!state.total) { count.textContent = 'Your library is empty. Add photos in Library to fill this album.'; return; }
  const b = document.createElement('b'); b.textContent = `${state.total.toLocaleString()} photos`;
  count.append(b, state.indexed === state.total ? ' in your library, and every one is searchable.' : ` in your library, ${state.indexed.toLocaleString()} ready to search.`);
}

// Album captions, written like notes under album photos, from saved trips and people. Empty captions show as a pencil line.
const SEASONS = ['winter','winter','spring','spring','spring','summer','summer','summer','fall','fall','fall','winter'];
function monthYear(day) { const d = new Date(`${day}T12:00:00`); return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function whenAgo(day) {
  const d = new Date(`${day}T12:00:00`), now = new Date(), season = SEASONS[d.getMonth()];
  const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
  if (months < 3) return `this ${season}`;
  if (months < 15) return `last ${season}`;
  return `${season} ${d.getFullYear()}`;
}
const names = list => list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
function setCaptions(memories) {
  const byId = new Map(memories.map(m => [m.id, m]));
  const trips = memories.filter(m => m.kind === 'event').sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const dated = trips.find(t => t.startDate);
  const left = dated ? `${dated.name}, ${monthYear(dated.startDate)}` : trips[0]?.name ?? '';
  const group = trips.find(t => t !== dated && t.memberIds?.length >= 2) ?? trips.find(t => t.memberIds?.length >= 2);
  let right = '';
  if (group) { const people = group.memberIds.map(id => byId.get(id)?.name).filter(Boolean).slice(0, 2); if (people.length) right = group.startDate ? `${names(people)}, ${whenAgo(group.startDate)}` : names(people); }
  if (!right) { const people = memories.filter(m => m.kind === 'person' && !m.isMe).slice(0, 2).map(m => m.name); if (people.length) right = names(people); }
  $('caption-left').textContent = left; $('caption-right').textContent = right;
}

// Timeline over the story (0..1): 0-.16 headline, 0-.45 wheel turns, .36-.55 album floats in tilted,
// .55-.85 album rotates flat and fills the screen, .8-.92 corners, captions and spine fade, then the hero rises onto the page.
function frame() {
  if (reduce) return;
  if (screen.hidden) { root.classList.remove('intro-dark'); delete root.dataset.intro; return; }
  const total = story.offsetHeight - innerHeight;
  const p = clamp(-story.getBoundingClientRect().top / total);
  intro.style.opacity = 1 - seg(p, .04, .16);
  intro.style.transform = `translateY(${-40 * seg(p, 0, .16)}px)`;
  intro.style.visibility = p > .17 ? 'hidden' : '';
  const wIn = ease(seg(p, 0, .14)), wOut = seg(p, .36, .5);
  wrap.style.opacity = wIn * (1 - wOut);
  wrap.style.transform = `translateY(${(1 - wIn) * 120 - seg(p, .1, .3) * innerHeight * .14}px) translateZ(${-radius - 120 - wOut * 400}px) rotateX(-6deg)`;
  wheel.style.transform = `rotateY(${-p * 300}deg)`;
  count.style.opacity = seg(p, .16, .24) * (1 - seg(p, .34, .42));
  const enter = ease(seg(p, .36, .55)), flat = ease(seg(p, .55, .85));
  album.style.opacity = p < .34 ? 0 : 1;
  // While floating, the album is small (about a quarter of the screen) and tilted at a jaunty angle: it flies in rotated one way and
  // swings past level to lean the other way, then straightens as it grows to fill the screen.
  const tiltZ = -28 * (1 - enter) + 9 * enter;
  album.style.transform = `translateY(${(1 - enter) * innerHeight * .9}px) scale(${(.238 + .07 * enter) * (1 - flat) + flat}) rotateX(${48 * (1 - flat)}deg) rotateY(${10 * (1 - flat)}deg) rotateZ(${tiltZ * (1 - flat)}deg)`;
  album.style.setProperty('--mounts', 1 - seg(p, .8, .9));
  album.style.setProperty('--grain', 1 - seg(p, .82, .92));
  const ui = ease(seg(p, .86, .97));
  hero.style.opacity = ui; hero.style.pointerEvents = ui > .5 ? '' : 'none';
  root.classList.toggle('intro-dark', p < .8);
  if (p > .97) { root.dataset.intro = 'done'; try { sessionStorage.setItem(SEEN, '1'); } catch {} } else root.dataset.intro = 'playing';
}
let pending = 0;
const schedule = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; frame(); }); };

const jump = (smooth = false) => { if (!screen.hidden) scrollTo({ top: storyEnd(), behavior: smooth ? 'smooth' : 'auto' }); };
if (!reduce) {
  root.dataset.intro = 'playing';
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => { layoutWheel(); schedule(); });
  new MutationObserver(() => { schedule(); }).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  $('landing-skip').onclick = () => jump(true);
  // The top bar's brand and Search tab call showScreen, which scrolls to the top; land on the search bar instead.
  for (const button of document.querySelectorAll('[data-go="search"]')) button.addEventListener('click', () => requestAnimationFrame(() => jump()));
  // Typing anywhere on the intro, or pressing /, goes to the search box.
  addEventListener('keydown', e => {
    if (screen.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input,textarea,select,dialog')) return;
    if (e.key === '/' || (root.dataset.intro === 'playing' && e.key.length === 1)) { jump(); $('prompt').focus(); if (e.key === '/') e.preventDefault(); }
  });
  let seen = false; try { seen = sessionStorage.getItem(SEEN) === '1'; } catch {}
  if (seen) requestAnimationFrame(() => { jump(); frame(); });
  frame();
} else delete root.dataset.intro;

// After a search, bring the search bar to the top so the first results are in view.
$('search-form').addEventListener('submit', () => { if (!reduce && !screen.hidden) scrollTo({ top: $('search-form').getBoundingClientRect().top + scrollY - 96, behavior: 'smooth' }); });
// TEMPORARY: switch the intro background between black and royal purple; theme.js applies the saved choice before first paint.
const nightLabel = () => { $('night-toggle').textContent = root.dataset.night === 'royal' ? 'Intro: royal' : 'Intro: black'; };
$('night-toggle').onclick = () => { if (root.dataset.night === 'royal') delete root.dataset.night; else root.dataset.night = 'royal'; try { localStorage.setItem('captured-night', root.dataset.night ?? 'black'); } catch {} nightLabel(); };
nightLabel();
$('threshold-toggle').onclick = () => { const row = $('threshold-row'); row.hidden = !row.hidden; $('threshold-toggle').setAttribute('aria-expanded', String(!row.hidden)); $('threshold-toggle').textContent = row.hidden ? 'Adjust strictness' : 'Hide strictness'; };

fetch('/state').then(r => r.ok ? r.json() : null).then(state => { if (state) { buildWheel(state.photos); setCount(state); schedule(); } }).catch(() => {});
fetch('/context').then(r => r.ok ? r.json() : null).then(data => { if (data) setCaptions(data.memories); }).catch(() => {});
