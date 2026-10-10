/* Progressive enhancement only: every feature works without JavaScript. */
(function () {
  'use strict';
  var root = document.documentElement;
  var body = document.body;

  // Sidebar toggle (collapsible on desktop, drawer on mobile). Preference is stored locally.
  var toggle = document.querySelector('[data-toggle-sidebar]');
  if (toggle) {
    if (localStorage.getItem('sidebar') === 'collapsed' && window.innerWidth > 960) body.classList.add('is-collapsed');
    toggle.addEventListener('click', function () {
      if (window.innerWidth <= 960) {
        body.classList.toggle('is-open');
      } else {
        var collapsed = body.classList.toggle('is-collapsed');
        localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'expanded');
      }
    });
  }

  // Confirmation for destructive or sensitive actions. Source: data-confirm on the submit button or form.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var submitter = event.submitter;
    var message = (submitter && submitter.getAttribute('data-confirm')) || form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });

  // Prevent double submission of forms.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form.dataset.submitting === '1') { event.preventDefault(); return; }
    form.dataset.submitting = '1';
    setTimeout(function () { form.dataset.submitting = '0'; }, 4000);
  });

  // Brand colour comes from the server as data-brand (inline <style> is blocked by the CSP).
  // Only a strict #RRGGBB value is applied.
  var brand = root.getAttribute('data-brand');
  if (brand && /^#[0-9a-fA-F]{6}$/.test(brand)) root.style.setProperty('--brand', brand);

  root.setAttribute('data-js', '1');
})();
