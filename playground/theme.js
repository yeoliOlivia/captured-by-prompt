// Applies the saved theme before the first paint. Served as its own file because the page's CSP forbids inline scripts.
try { const theme = localStorage.getItem('captured-theme'); if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; } catch {}
// TEMPORARY: intro background choice from the top bar's Intro button (landing.js).
try { if (localStorage.getItem('captured-night') === 'royal') document.documentElement.dataset.night = 'royal'; } catch {}
