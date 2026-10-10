/* Bell badge poller — fetches /notifications/unread-count every 60s (same-origin, CSP-safe). */
(function () {
  var badge = document.getElementById('notif-badge');
  if (!badge) return;
  function refresh() {
    fetch('/notifications/unread-count', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var count = j && j.data ? Number(j.data.count) : 0;
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      })
      .catch(function () { /* silent — badge stays as-is */ });
  }
  refresh();
  setInterval(refresh, 60000);
})();
