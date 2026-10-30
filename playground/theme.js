// Applies the saved theme before the first paint. Served as its own file because the page's CSP forbids inline scripts.
try { const theme = localStorage.getItem('captured-theme'); if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; } catch {}
