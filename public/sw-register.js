(function() {
  if (!('serviceWorker' in navigator)) return;

  // Register SW and force update check on every page load
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    // Immediately check for a newer SW file — picks up new deploys fast
    reg.update().catch(function() {});
  }).catch(function() {});

  // If SW detects stale assets (404), it sends CACHE_BUSTED — auto-reload
  navigator.serviceWorker.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'CACHE_BUSTED' && !window.__reloading) {
      window.__reloading = true;
      location.reload();
    }
  });

  // Safety net: if critical JS/CSS fails to load (404), nuke caches and reload once
  window.addEventListener('error', function(e) {
    if (window.__reloading) return;
    var t = e.target;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK') && !sessionStorage.getItem('reload-attempted')) {
      sessionStorage.setItem('reload-attempted', '1');
      window.__reloading = true;
      // Clear all SW caches before reloading to guarantee fresh content
      if (caches) {
        caches.keys().then(function(keys) {
          return Promise.all(keys.map(function(k) { return caches.delete(k); }));
        }).then(function() { location.reload(); }).catch(function() { location.reload(); });
      } else {
        location.reload();
      }
    }
  }, true);

  // Clear the reload guard on successful load so future deploys can self-heal too
  window.addEventListener('load', function() { sessionStorage.removeItem('reload-attempted'); });
})();
