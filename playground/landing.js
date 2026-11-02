// Search screen intro: drives the scroll story in index.html (#story) from scroll progress, fills it with the user's
// photos and saved context, and keeps search fast: it plays fully once per browser session, the brand and the Search tab
// jump straight to the search bar, and with reduced motion it is hidden by CSS and never runs.
const $ = id => document.getElementById(id);
const root = document.documentElement;
const story = $('story'), screen = document.querySelector('[data-screen="search"]'), hero = screen.querySelector('.hero');
const intro = $('landing-intro'), wrap = $('wheel-wrap'), wheel = $('wheel'), count = $('landing-count'), album = $('album'), flyLayer = $('fly-layer');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SEEN = 'captured-intro-seen';
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = t => 1 - Math.pow(1 - t, 3);
const heroTop = () => hero.getBoundingClientRect().top + scrollY;
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
// Album pages. Photos fly from the stopped wheel onto three pages, which flip one after another toward the empty spread.
// Each layout entry is [left%, top%, width%, height%, resting rotation in degrees] on a page.
const LAYOUTS = [
  [[10,10,46,40,-4],[50,30,40,34,5],[16,56,40,30,2]],
  [[48,8,42,36,6],[8,26,44,38,-5],[34,60,44,30,-2]],
  [[12,12,40,34,3],[46,44,44,40,-6],[10,58,34,28,4]],
];
const BACKS = [[[14,14,70,40,-2],[22,60,52,28,3]],[[10,10,44,36,4],[48,40,42,40,-3]]];
const SPIN_STOP = -120; // where the wheel comes to rest, in degrees
let flips = [];
function placePhoto([l,t,w,h,rot], src, face) {
  const d = document.createElement('div'); d.className = 'drop'; d.style.cssText = `left:${l}%;top:${t}%;width:${w}%;height:${h}%;transform:rotate(${rot}deg)`;
  const img = document.createElement('img'); img.src = src; img.alt = ''; img.decoding = 'async'; d.append(img); face.append(d);
  return d;
}
function buildFlips(photos) {
  $('flips').replaceChildren(); flyLayer.replaceChildren(); flips = [];
  const cards = [...wheel.children]; if (!cards.length) return;
  // The cards facing the viewer when the wheel stops are the ones that fall, centre first.
  const step = 360 / cards.length, off = i => Math.abs((((i * step + SPIN_STOP) % 360) + 540) % 360 - 180);
  const falling = [...cards.keys()].sort((a, b) => off(a) - off(b)).slice(0, 9);
  let k = 0, b = 9;
  LAYOUTS.forEach((layout, i) => {
    const flip = document.createElement('div'); flip.className = 'flip';
    const front = document.createElement('div'); front.className = 'face front';
    const back = document.createElement('div'); back.className = 'face back';
    const drops = layout.map(L => {
      const card = cards[falling[k++ % falling.length]], src = card.querySelector('img').src;
      const fly = document.createElement('div'); fly.className = 'fly'; const img = document.createElement('img'); img.src = src; img.alt = ''; fly.append(img); flyLayer.append(fly);
      return { el: placePhoto(L, src, front), rot: L[4], card, fly };
    });
    if (i < LAYOUTS.length - 1) BACKS[i].forEach(L => placePhoto(L, photos[b++ % photos.length].image, back));
    else { back.innerHTML = '<i class="spot"></i><i class="mount m1"></i><i class="mount m2"></i><i class="mount m3"></i><i class="mount m4"></i><span class="caption" data-caption="left"></span>'; back.querySelector('.caption').textContent = $('caption-left').textContent; }
    flip.append(front, back); $('flips').append(flip); flips.push({ el: flip, drops });
  });
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
  document.querySelectorAll('[data-caption="left"]').forEach(el => el.textContent = left); $('caption-right').textContent = right;
}

// Ending: a Spotlight-style panel types an example, then a pointer clicks its "Search in Captured" shortcut, which scrolls
// to the real search bar with the example filled in. The demo runs only while the viewer stays put; any scroll cancels it.
const EXAMPLE = 'Photos of Owen and I at the beach';
const spotInput = $('spot-input'), cursor = $('demo-cursor');
let typing = null, autoTyped = false, userTyped = false, demo = [];
spotInput.addEventListener('input', e => { if (e.isTrusted) userTyped = true; });
const later = (ms, fn) => demo.push(setTimeout(fn, ms));
function stopDemo() { demo.forEach(clearTimeout); demo = []; cursor.style.opacity = 0; cursor.classList.remove('down'); $('spot-hit').classList.remove('pressed'); }
function startTyping() {
  if (typing || userTyped || autoTyped) return;
  let n = 0; spotInput.value = '';
  typing = setInterval(() => {
    spotInput.value = EXAMPLE.slice(0, ++n);
    if (n < EXAMPLE.length) return;
    clearInterval(typing); typing = null; autoTyped = true;
    $('spot-hit-title').textContent = `Search \u201c${EXAMPLE}\u201d in Captured`; $('spot-results').classList.add('on');
    clickDemo();
  }, 55);
}
function resetTyping() {
  stopDemo();
  if (userTyped) return;
  clearInterval(typing); typing = null; autoTyped = false; spotInput.value = ''; $('spot-results').classList.remove('on');
}
function clickDemo() {
  const y0 = scrollY, still = () => Math.abs(scrollY - y0) < 4;
  later(700, () => {
    if (!still()) return;
    const panel = $('spotlight').getBoundingClientRect(), hit = $('spot-hit').getBoundingClientRect();
    const from = { x: panel.right - 30, y: panel.bottom + 70 }, to = { x: hit.left + hit.width * .32, y: hit.top + hit.height * .55 };
    cursor.style.transition = 'none'; cursor.style.transform = `translate(${from.x}px, ${from.y}px)`; cursor.style.opacity = 1;
    requestAnimationFrame(() => requestAnimationFrame(() => { cursor.style.transition = 'opacity .2s, transform .9s cubic-bezier(.3,.7,.2,1)'; cursor.style.transform = `translate(${to.x}px, ${to.y}px)`; }));
  });
  later(1750, () => { if (!still()) return stopDemo(); cursor.classList.add('down'); $('spot-hit').classList.add('pressed'); });
  later(1950, () => { cursor.classList.remove('down'); $('spot-hit').classList.remove('pressed'); });
  later(2250, () => { if (!still()) return stopDemo(); goToSearch(spotInput.value.trim() || EXAMPLE); });
}
// Fills the real search box but does not run the search, so the example never spends a model request on its own.
function goToSearch(query) { stopDemo(); $('prompt').value = query; jump(true); $('prompt').focus({ preventScroll: true }); }
$('spot-hit').onclick = () => goToSearch(spotInput.value.trim() || EXAMPLE);
$('spotlight').onsubmit = e => { e.preventDefault(); goToSearch(spotInput.value.trim() || EXAMPLE); };
addEventListener('wheel', () => { if (demo.length) stopDemo(); }, { passive: true });
addEventListener('touchmove', () => { if (demo.length) stopDemo(); }, { passive: true });

// Timeline over the story (0..1): 0-.16 headline, 0-.26 wheel turns and stops, .2-.3 it rises to the top and holds,
// .26-.38 album flies in tilted, .38-.71 photos fly from the wheel onto three pages that each flip over, .72-.8 it settles
// on the empty spread, .8-.93 it recedes while the Spotlight panel rises out of it, then the example types itself.
function frame() {
  if (reduce) return;
  if (screen.hidden) { root.classList.remove('intro-dark'); delete root.dataset.intro; for (const f of flips) for (const d of f.drops) d.fly.style.opacity = 0; stopDemo(); return; }
  const total = story.offsetHeight - innerHeight;
  const p = clamp(-story.getBoundingClientRect().top / total);
  intro.style.opacity = 1 - seg(p, .04, .16);
  intro.style.transform = `translateY(${-40 * seg(p, 0, .16)}px)`;
  intro.style.visibility = p > .17 ? 'hidden' : '';
  const wIn = ease(seg(p, 0, .1)), rise = ease(seg(p, .2, .3)), wOut = seg(p, .66, .72);
  wrap.style.opacity = wIn * (1 - wOut);
  wrap.style.transform = `translateY(${(1 - wIn) * 120 - seg(p, .08, .2) * innerHeight * .08 - rise * innerHeight * .42}px) translateZ(${-radius - 120 - rise * 260}px) rotateX(${-6 - 6 * rise}deg)`;
  wheel.style.transform = `rotateY(${SPIN_STOP * ease(seg(p, 0, .26))}deg)`;
  count.style.opacity = seg(p, .1, .16) * (1 - seg(p, .2, .26));
  const enter = ease(seg(p, .26, .38)), g = ease(seg(p, .38, .71)), hold = ease(seg(p, .72, .8)), rec = ease(seg(p, .8, .93));
  album.style.opacity = p < .25 ? 0 : 1 - seg(p, .86, .93);
  // Floating, the album is small and leans one way, then the other; it grows a little while pages flip, settles, then recedes.
  const tiltZ = (-28 * (1 - enter) + 9 * enter - 4 * g) * (1 - .6 * hold);
  album.style.transform = `translateY(${(1 - enter) * innerHeight * .9 - rec * innerHeight * .06}px) scale(${(.238 + .07 * enter + .1 * g + .05 * hold) * (1 - .86 * rec)}) rotateX(${48 - 16 * g - 10 * hold + 8 * rec}deg) rotateY(${10 * (1 - hold)}deg) rotateZ(${tiltZ}deg)`;
  const narrow = innerWidth <= 720;
  flips.forEach((f, i) => {
    const a = .38 + i * .11;
    f.drops.forEach((d, j) => {
      // Flight in screen space from the wheel card to the photo's spot, falling faster as it goes and turning to rest;
      // the in-album photo fades in as the flying copy lands.
      const t = seg(p, a + j * .014, a + j * .014 + .04);
      d.card.style.opacity = t > 0 ? 0 : '';
      d.el.style.opacity = seg(t, .82, 1);
      if (t <= 0 || t >= 1) { d.fly.style.opacity = 0; return; }
      const from = d.card.getBoundingClientRect(), to = d.el.getBoundingClientRect();
      const ex = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, ey = t * t;
      const w = from.width + (to.width - from.width) * ex, h = from.height + (to.height - from.height) * ex;
      const cx = from.left + from.width / 2 + (to.left + to.width / 2 - from.left - from.width / 2) * ex;
      const cy = from.top + from.height / 2 + (to.top + to.height / 2 - from.top - from.height / 2) * ey - Math.sin(Math.PI * t) * 30;
      Object.assign(d.fly.style, { width: `${w}px`, height: `${h}px`, padding: `${ex * .05 * w}px ${ex * .05 * w}px ${ex * .2 * w}px`, borderRadius: `${10 * (1 - ex)}px`, opacity: 1 - seg(t, .85, 1),
        transform: `translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${(d.rot + 14 * Math.sin(t * Math.PI * 1.5) * (1 - t)) * ex}deg)` });
    });
    // Turn around the spine with a small lift; stacking order flips so the newest turned page lies on top.
    const tt = ease(seg(p, a + .06, a + .11)), z = (flips.length - i) * (1 - tt) + (i + 1) * tt + Math.sin(Math.PI * tt) * 40;
    f.el.style.transform = `translateZ(${z}px) rotateY(${-180 * tt}deg)`;
    f.el.style.opacity = narrow ? 1 - seg(tt, .4, .8) : ''; // one-page phone layout: turned pages leave the screen
  });
  const em = ease(seg(p, .82, .92)), spot = $('spotlight');
  spot.style.opacity = seg(p, .82, .87);
  spot.style.transform = `translate(-50%, ${(1 - em) * innerHeight * .26}px) scale(${.1 + .9 * em})`;
  spot.style.pointerEvents = em > .6 ? 'auto' : 'none';
  $('landing-glow').style.opacity = .55 * seg(p, .84, .96);
  $('landing-down').style.opacity = seg(p, .94, 1);
  if (p >= .93) startTyping(); else if (p < .88) resetTyping();
  // The intro counts as done once the search hero is reached; the key sheet waits until then.
  const heroY = hero.getBoundingClientRect().top;
  root.classList.toggle('intro-dark', heroY > 60);
  if (heroY < innerHeight * .3) { root.dataset.intro = 'done'; try { sessionStorage.setItem(SEEN, '1'); } catch {} } else root.dataset.intro = 'playing';
}
let pending = 0;
const schedule = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; frame(); }); };

function jump(smooth = false) { if (!screen.hidden) scrollTo({ top: heroTop(), behavior: smooth ? 'smooth' : 'auto' }); }
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

function buildGlow(photos) { $('landing-glow').replaceChildren(...photos.slice(0, 12).map(photo => { const img = document.createElement('img'); img.src = photo.image; img.alt = ''; img.decoding = 'async'; return img; })); }
fetch('/state').then(r => r.ok ? r.json() : null).then(state => { if (state) { buildWheel(state.photos); buildFlips(state.photos); buildGlow(state.photos); setCount(state); schedule(); } }).catch(() => {});
fetch('/context').then(r => r.ok ? r.json() : null).then(data => { if (data) setCaptions(data.memories); }).catch(() => {});
