(function() {
  if (!('serviceWorker' in navigator)) return;

  // Register SW and force update check on every page load
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    // Immediately check for a newer SW file — picks up new deploys fast
    reg.update().catch(function() {});

    // If a new SW is waiting, activate it immediately so stale cache is purged
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    reg.addEventListener('updatefound', function() {
      var newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', function() {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          // New SW installed while old one was active — activate it now
          newSW.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }).catch(function() {});

  // When a new SW replaces an existing one, reload to pick up fresh assets.
  // Only reload if there was already a controller — on first visit the SW
  // claims control for the first time and a reload is unnecessary.
  var hadController = !!navigator.serviceWorker.controller;
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!hadController || refreshing || window.__reloading) return;
    refreshing = true;
    location.reload();
  });

  // If SW detects stale assets (404), it sends CACHE_BUSTED — auto-reload
  navigator.serviceWorker.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'CACHE_BUSTED' && !window.__reloading) {
      window.__reloading = true;
      location.reload();
    }
  });

  // Safety net: if critical JS/CSS fails to load (404), nuke caches, unregister SW, and reload.
  // Uses a counter instead of a boolean so a second deploy doesn't get locked out.
  window.addEventListener('error', function(e) {
    if (window.__reloading) return;
    var t = e.target;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
      var attempts = parseInt(sessionStorage.getItem('reload-attempted') || '0', 10);
      if (attempts >= 2) return; // Give up after 2 attempts to avoid infinite loop
      sessionStorage.setItem('reload-attempted', String(attempts + 1));
      window.__reloading = true;

      // Unregister SW + clear all caches before reloading
      var tasks = [];
      if (caches) {
        tasks.push(caches.keys().then(function(keys) {
          return Promise.all(keys.map(function(k) { return caches.delete(k); }));
        }));
      }
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        regs.forEach(function(r) { tasks.push(r.unregister()); });
        return Promise.all(tasks);
      }).then(function() { location.reload(); }).catch(function() { location.reload(); });
    }
  }, true);

  // Clear the reload guard on successful load so future deploys can self-heal too
  window.addEventListener('load', function() { sessionStorage.removeItem('reload-attempted'); });
})();
