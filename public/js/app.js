/* =====================================================================
   مای‌کلس - اسکریپت‌های سمت کاربر (بدون اسکریپت درون‌خطی، سازگار با CSP)
   ===================================================================== */
(function () {
  'use strict';
  var d = document;
  var $ = function (s, el) { return (el || d).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || d).querySelectorAll(s)); };
  var FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  var cfgEl = $('#app-config');
  var CFG = cfgEl ? JSON.parse(cfgEl.textContent || '{}') : {};
  var faDigits = CFG.faDigits !== false;
  function fa(v) { v = String(v === null || v === undefined ? '' : v); return faDigits ? v.replace(/[0-9]/g, function (c) { return FA[c]; }) : v; }
  function en(v) { return String(v || '').replace(/[۰-۹]/g, function (c) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(c); }).replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); }); }
  function num(n) { return fa(Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')); }
  function icon(name, cls) { return '<svg class="icon ' + (cls || '') + '"><use href="' + (CFG.icons || '') + '#' + name + '"></use></svg>'; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  window.MC = { fa: fa, en: en, num: num, icon: icon, esc: esc, cfg: CFG };

  /* ------------------------------ تم ------------------------------ */
  var root = d.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('mc-theme'); } catch (e) { /* */ }
  if (saved) root.setAttribute('data-theme', saved);
  d.addEventListener('click', function (e) {
    var t = e.target.closest('[data-theme-toggle]');
    if (!t) return;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('mc-theme', next); } catch (err) { /* */ }
    renderCharts(true);
  });

  /* ------------------------------ منوی موبایل ------------------------------ */
  d.addEventListener('click', function (e) {
    if (e.target.closest('[data-sidebar-toggle]')) { d.body.classList.toggle('sidebar-open'); return; }
    if (e.target.classList.contains('backdrop')) d.body.classList.remove('sidebar-open');
  });

  /* ------------------------------ منوی کشویی ------------------------------ */
  d.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-dropdown]');
    $$('.dropdown.open').forEach(function (dd) { if (!toggle || dd !== toggle.closest('.dropdown')) dd.classList.remove('open'); });
    if (toggle) { e.preventDefault(); toggle.closest('.dropdown').classList.toggle('open'); }
  });

  /* ------------------------------ اعلان‌ها (Toast) ------------------------------ */
  var toastBox = null;
  function toast(message, type) {
    if (!toastBox) { toastBox = d.createElement('div'); toastBox.className = 'toasts'; d.body.appendChild(toastBox); }
    type = type || 'info';
    var ic = { success: 'check-circle-2', error: 'x-circle', warning: 'alert-triangle', info: 'info' }[type] || 'info';
    var el = d.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', 'alert');
    el.innerHTML = icon(ic) + '<div>' + esc(message) + '</div><button class="close" type="button" aria-label="بستن">' + icon('x', 'icon-sm') + '</button>';
    toastBox.appendChild(el);
    var close = function () { el.classList.add('hide'); setTimeout(function () { el.remove(); }, 260); };
    el.querySelector('.close').addEventListener('click', close);
    setTimeout(close, type === 'error' ? 9000 : 5500);
  }
  window.MC.toast = toast;
  var fl = $('#flash-data');
  if (fl) { try { JSON.parse(fl.textContent).forEach(function (f) { toast(fa(f.message), f.type); }); } catch (e) { /* */ } }

  /* ------------------------------ تأیید عملیات ------------------------------ */
  function confirmModal(opts) {
    return new Promise(function (resolve) {
      var bd = d.createElement('div');
      bd.className = 'modal-backdrop';
      var danger = opts.danger !== false;
      bd.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div class="m-icon ' + (danger ? '' : 'primary') + '">' + icon(danger ? 'alert-triangle' : 'circle-help') + '</div><h3>' + esc(opts.title || 'تأیید عملیات') + '</h3></div>' +
        '<div class="modal-body">' + esc(opts.message || 'آیا از انجام این عملیات اطمینان دارید؟') + (opts.input ? '<div class="field mt-3"><label class="label">' + esc(opts.input) + '</label><textarea class="input" rows="3" data-modal-input></textarea></div>' : '') + '</div>' +
        '<div class="modal-foot"><button type="button" class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-ok>' + esc(opts.ok || 'بله، انجام شود') + '</button><button type="button" class="btn btn-ghost" data-cancel>انصراف</button></div></div>';
      d.body.appendChild(bd);
      var inp = bd.querySelector('[data-modal-input]');
      (inp || bd.querySelector('[data-ok]')).focus();
      var done = function (v) { bd.remove(); d.removeEventListener('keydown', onKey); resolve(v); };
      var onKey = function (e) { if (e.key === 'Escape') done(false); };
      d.addEventListener('keydown', onKey);
      bd.addEventListener('click', function (e) {
        if (e.target === bd || e.target.closest('[data-cancel]')) done(false);
        if (e.target.closest('[data-ok]')) done(inp ? { value: inp.value } : true);
      });
    });
  }
  window.MC.confirm = confirmModal;

  d.addEventListener('submit', function (e) {
    var form = e.target;
    var sub = e.submitter && e.submitter !== form ? e.submitter : null;
    var src = sub && sub.hasAttribute('data-confirm') ? sub : form;
    var msg = src.getAttribute('data-confirm');
    if (msg && !form._confirmed) {
      e.preventDefault();
      confirmModal({ message: msg, title: src.getAttribute('data-confirm-title'), ok: src.getAttribute('data-confirm-ok'), danger: src.getAttribute('data-confirm-danger') !== 'false', input: src.getAttribute('data-confirm-input') }).then(function (ok) {
        if (!ok) return;
        if (ok.value !== undefined) {
          var name = src.getAttribute('data-confirm-name') || 'reason';
          var h = form.querySelector('input[name="' + name + '"]') || d.createElement('input');
          h.type = 'hidden'; h.name = name; h.value = ok.value; form.appendChild(h);
        }
        form._confirmed = true;
        if (form.requestSubmit) { if (sub) form.requestSubmit(sub); else form.requestSubmit(); } else form.submit();
        setTimeout(function () { form._confirmed = false; }, 500);
      });
      return;
    }
    // تبدیل مبالغ و اعداد فارسی پیش از ارسال
    $$('[data-money]', form).forEach(function (i) { i.value = en(i.value).replace(/[^\d.-]/g, ''); });
    var btn = sub || form.querySelector('button[type="submit"]:not([formnovalidate])');
    if (btn && !form.hasAttribute('data-no-loading') && !form.target) {
      setTimeout(function () { btn.disabled = true; btn.insertAdjacentHTML('afterbegin', icon('loader-2', 'spin icon-sm')); }, 10);
    }
  }, true);

  d.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-confirm]');
    if (!a) return;
    e.preventDefault();
    confirmModal({ message: a.getAttribute('data-confirm'), danger: a.getAttribute('data-confirm-danger') !== 'false' }).then(function (ok) { if (ok) location.href = a.href; });
  });

  /* ------------------------------ ورودی مبلغ ------------------------------ */
  function fmtMoneyInput(i) {
    var raw = en(i.value).replace(/[^\d]/g, '');
    i.value = raw ? Number(raw).toLocaleString('en-US') : '';
    var hint = i.parentElement && i.parentElement.parentElement ? i.closest('.field') : null;
    var h = hint ? hint.querySelector('[data-money-words]') : null;
    if (h) h.textContent = raw ? fa(Number(raw).toLocaleString('en-US')) + ' ' + (CFG.currency || '') : '';
  }
  d.addEventListener('input', function (e) {
    if (e.target.matches('[data-money]')) fmtMoneyInput(e.target);
    if (e.target.matches('[data-en-digits]')) { var p = e.target.selectionStart; e.target.value = en(e.target.value); try { e.target.setSelectionRange(p, p); } catch (err) { /* */ } }
  });
  $$('[data-money]').forEach(fmtMoneyInput);

  /* ------------------------------ انتخاب همه ------------------------------ */
  d.addEventListener('change', function (e) {
    var all = e.target.closest('[data-checkall]');
    if (all) {
      $$(all.getAttribute('data-checkall')).forEach(function (c) { if (!c.disabled) c.checked = all.checked; });
      updateBulk();
    }
    if (e.target.matches('[data-bulk-item]')) updateBulk();
    if (e.target.matches('[data-autosubmit]') || e.target.closest('form[data-autosubmit]')) {
      var f = e.target.form || e.target.closest('form');
      if (f && !e.target.matches('[data-no-autosubmit]')) f.submit();
    }
  });
  function updateBulk() {
    $$('[data-bulk-count]').forEach(function (el) {
      var n = $$(el.getAttribute('data-bulk-count') + ':checked').length;
      el.textContent = fa(n);
      var bar = el.closest('[data-bulk-bar]');
      if (bar) bar.classList.toggle('hidden', n === 0);
    });
  }

  /* ------------------------------ کپی ------------------------------ */
  d.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault();
    var text = b.getAttribute('data-copy');
    var done = function () { toast('کپی شد.', 'success'); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  });
  function fallbackCopy(t) { var ta = d.createElement('textarea'); ta.value = t; d.body.appendChild(ta); ta.select(); try { d.execCommand('copy'); } catch (e) { /* */ } ta.remove(); }

  /* ------------------------------ چاپ ------------------------------ */
  d.addEventListener('click', function (e) { if (e.target.closest('[data-print]')) { e.preventDefault(); window.print(); } });
  if (d.body.hasAttribute('data-autoprint')) setTimeout(function () { window.print(); }, 600);

  /* ------------------------------ نمایش/مخفی‌سازی وابسته ------------------------------ */
  function applyToggles() {
    $$('[data-show-when]').forEach(function (el) {
      var spec = el.getAttribute('data-show-when'); // name=value1|value2
      var parts = spec.split('=');
      var name = parts[0]; var vals = (parts[1] || '').split('|');
      var inputs = $$('[name="' + name + '"]');
      var val = null;
      inputs.forEach(function (i) {
        if (i.type === 'checkbox') { if (i.checked) val = i.value || '1'; else if (val === null) val = '0'; } else if (i.type === 'radio') { if (i.checked) val = i.value; } else val = i.value;
      });
      var show = vals.indexOf(String(val)) !== -1;
      el.classList.toggle('hidden', !show);
      $$('input,select,textarea', el).forEach(function (x) { if (x.hasAttribute('data-req-when-shown')) x.required = show; });
    });
  }
  d.addEventListener('change', applyToggles);
  applyToggles();

  /* ------------------------------ تکرارشونده (Repeater) ------------------------------ */
  function reindex(box) {
    var key = box.getAttribute('data-repeater');
    $$('[data-repeater-item]', box).forEach(function (row, i) {
      $$('[data-name]', row).forEach(function (inp) { inp.name = inp.getAttribute('data-name').replace('__i__', i); });
      var idx = row.querySelector('[data-index]');
      if (idx) idx.textContent = fa(i + 1);
    });
    box.dispatchEvent(new CustomEvent('repeater:change', { bubbles: true, detail: { key: key } }));
  }
  d.addEventListener('click', function (e) {
    var add = e.target.closest('[data-repeater-add]');
    if (add) {
      e.preventDefault();
      var box = d.getElementById(add.getAttribute('data-repeater-add'));
      var tpl = d.getElementById(box.getAttribute('data-template'));
      var max = Number(box.getAttribute('data-max') || 100);
      if ($$('[data-repeater-item]', box).length >= max) { toast('حداکثر تعداد ردیف‌ها: ' + fa(max), 'warning'); return; }
      var holder = d.createElement('div');
      holder.innerHTML = tpl.innerHTML.trim();
      var row = holder.firstElementChild;
      (box.querySelector('[data-repeater-list]') || box).appendChild(row);
      reindex(box);
      var first = row.querySelector('input,select,textarea'); if (first) first.focus();
      return;
    }
    var rm = e.target.closest('[data-repeater-remove]');
    if (rm) {
      e.preventDefault();
      var b = rm.closest('[data-repeater]');
      rm.closest('[data-repeater-item]').remove();
      reindex(b);
    }
  });
  $$('[data-repeater]').forEach(reindex);

  /* ------------------------------ تقویم شمسی ------------------------------ */
  function initDatepicker() {
    if (!window.jalaliDatepicker) return;
    window.jalaliDatepicker.startWatch({
      selector: 'input[data-jdp]', persianDigits: faDigits, showTodayBtn: true, showEmptyBtn: true, autoReadOnlyInput: false,
      time: false, hasSecond: false, minDate: 'attr', maxDate: 'attr', zIndex: 2000, separatorChars: { date: '/' },
    });
  }
  initDatepicker();
  d.addEventListener('input', function (e) { if (e.target.matches('input[data-jdp]')) { var v = en(e.target.value); if (v !== e.target.value) e.target.value = v; } });

  /* ------------------------------ نمودارها ------------------------------ */
  var charts = [];
  function chartColors() {
    var cs = getComputedStyle(root);
    return {
      primary: cs.getPropertyValue('--primary').trim() || '#4f46e5', text: cs.getPropertyValue('--text-2').trim(), muted: cs.getPropertyValue('--muted').trim(),
      border: cs.getPropertyValue('--border').trim(), dark: root.getAttribute('data-theme') === 'dark',
    };
  }
  function deepMerge(a, b) {
    Object.keys(b || {}).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]);
      else a[k] = b[k];
    });
    return a;
  }
  function buildChart(el) {
    var src = d.getElementById(el.getAttribute('data-chart'));
    if (!src) return null;
    var spec = JSON.parse(src.textContent || '{}');
    var c = chartColors();
    var type = spec.type || 'area';
    var moneyFmt = spec.money ? function (v) { return num(v) + (spec.unit ? ' ' + spec.unit : ''); } : function (v) { return fa(Math.round(v * 100) / 100) + (spec.suffix || ''); };
    var shortFmt = function (v) {
      if (!spec.money) return fa(Math.round(v)) + (spec.suffix || '');
      var a = Math.abs(v);
      if (a >= 1e9) return fa((v / 1e9).toFixed(1).replace(/\.0$/, '')) + ' میلیارد';
      if (a >= 1e6) return fa((v / 1e6).toFixed(1).replace(/\.0$/, '')) + ' میلیون';
      if (a >= 1e3) return fa(Math.round(v / 1e3)) + ' هزار';
      return fa(v);
    };
    var palette = spec.colors || [c.primary, '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#64748b'];
    var opts = {
      chart: { type: type, height: spec.height || 300, fontFamily: 'Vazirmatn, Tahoma, sans-serif', toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent', foreColor: c.muted, animations: { enabled: true, speed: 500 }, sparkline: { enabled: !!spec.sparkline }, stacked: !!spec.stacked },
      theme: { mode: c.dark ? 'dark' : 'light' },
      colors: palette,
      series: spec.series || [],
      dataLabels: { enabled: !!spec.dataLabels, formatter: function (v) { return type === 'donut' || type === 'pie' ? fa(Math.round(v)) + '٪' : shortFmt(v); }, style: { fontFamily: 'Vazirmatn' } },
      stroke: { curve: 'smooth', width: type === 'bar' || type === 'donut' || type === 'pie' ? (type === 'bar' ? 0 : 2) : 3, colors: type === 'donut' || type === 'pie' ? [c.dark ? '#121a2b' : '#fff'] : undefined },
      grid: { borderColor: c.border, strokeDashArray: 4, padding: { left: 8, right: 8 }, xaxis: { lines: { show: false } } },
      xaxis: { categories: spec.labels || [], labels: { style: { colors: c.muted, fontFamily: 'Vazirmatn' }, formatter: function (v) { return fa(v); } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: c.muted, fontFamily: 'Vazirmatn' }, formatter: shortFmt }, opposite: true, max: spec.max, min: spec.min },
      tooltip: { theme: c.dark ? 'dark' : 'light', y: { formatter: moneyFmt }, style: { fontFamily: 'Vazirmatn' } },
      legend: { show: spec.legend !== false, position: spec.legendPosition || 'bottom', fontFamily: 'Vazirmatn', labels: { colors: c.text }, markers: { offsetX: 4 }, itemMargin: { horizontal: 10 } },
      fill: type === 'area' ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: .38, opacityTo: .02, stops: [0, 95, 100] } } : { opacity: 1 },
      plotOptions: {
        bar: { borderRadius: 6, columnWidth: spec.columnWidth || '45%', horizontal: !!spec.horizontal, borderRadiusApplication: 'end', distributed: !!spec.distributed },
        pie: { donut: { size: '70%', labels: { show: type === 'donut', name: { fontFamily: 'Vazirmatn' }, value: { fontFamily: 'Vazirmatn', fontWeight: 800, formatter: function (v) { return spec.money ? shortFmt(Number(v)) : fa(v); } }, total: { show: true, label: spec.totalLabel || 'مجموع', fontFamily: 'Vazirmatn', color: c.muted, formatter: function (w) { var t = w.globals.seriesTotals.reduce(function (a, b) { return a + b; }, 0); return spec.money ? shortFmt(t) : fa(t); } } } } },
        radialBar: { hollow: { size: '62%' }, track: { background: c.border }, dataLabels: { name: { fontFamily: 'Vazirmatn', color: c.muted, offsetY: 22 }, value: { fontFamily: 'Vazirmatn', fontSize: '26px', fontWeight: 800, color: c.dark ? '#fff' : '#0f172a', offsetY: -12, formatter: function (v) { return fa(Math.round(v)) + '٪'; } } } },
      },
      markers: { size: type === 'line' ? 4 : 0, strokeWidth: 2, hover: { size: 6 } },
      noData: { text: 'داده‌ای برای نمایش وجود ندارد', style: { fontFamily: 'Vazirmatn', color: c.muted } },
    };
    if (type === 'donut' || type === 'pie' || type === 'radialBar') { opts.labels = spec.labels || []; delete opts.xaxis; delete opts.yaxis; delete opts.grid; }
    if (spec.horizontal) { opts.yaxis = { labels: { style: { colors: c.muted, fontFamily: 'Vazirmatn' }, maxWidth: 180 } }; opts.xaxis.labels.formatter = shortFmt; }
    deepMerge(opts, spec.options || {});
    el.innerHTML = '';
    var chart = new window.ApexCharts(el, opts);
    chart.render();
    return chart;
  }
  function renderCharts(rerender) {
    if (!window.ApexCharts) return;
    if (rerender) { charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* */ } }); charts = []; }
    $$('[data-chart]').forEach(function (el) { var c = buildChart(el); if (c) charts.push(c); });
  }
  renderCharts();
  window.MC.renderCharts = renderCharts;

  /* ------------------------------ تب‌های سمت کاربر ------------------------------ */
  d.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (!t) return;
    e.preventDefault();
    var group = t.closest('[data-tabs]');
    var target = t.getAttribute('data-tab');
    $$('[data-tab]', group).forEach(function (x) { x.classList.toggle('active', x === t); });
    var scope = d.getElementById(group.getAttribute('data-tabs')) || d;
    $$('[data-pane]', scope).forEach(function (p) { p.classList.toggle('hidden', p.getAttribute('data-pane') !== target); });
    if (history.replaceState) history.replaceState(null, '', '#' + target);
  });
  if (location.hash) { var ht = $('[data-tab="' + location.hash.slice(1) + '"]'); if (ht) ht.click(); }

  /* ------------------------------ حضور و غیاب ------------------------------ */
  d.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mark-all]');
    if (!b) return;
    e.preventDefault();
    var st = b.getAttribute('data-mark-all');
    $$('input[type="radio"][value="' + st + '"]').forEach(function (r) { if (!r.disabled && r.name.indexOf('status') === 0) r.checked = true; });
    updateAttCounts();
  });
  function updateAttCounts() {
    var box = $('[data-att-counts]');
    if (!box) return;
    var c = { present: 0, absent: 0, late: 0, excused: 0 };
    $$('.att-options input:checked').forEach(function (r) { c[r.value] = (c[r.value] || 0) + 1; });
    Object.keys(c).forEach(function (k) { var el = box.querySelector('[data-c="' + k + '"]'); if (el) el.textContent = fa(c[k]); });
  }
  d.addEventListener('change', function (e) { if (e.target.closest('.att-options')) updateAttCounts(); });
  updateAttCounts();

  /* ------------------------------ جستجوی زنده در لیست ------------------------------ */
  d.addEventListener('input', function (e) {
    var i = e.target.closest('[data-filter-list]');
    if (!i) return;
    var q = en(i.value).trim().toLowerCase();
    $$(i.getAttribute('data-filter-list')).forEach(function (row) { row.classList.toggle('hidden', q && row.textContent.toLowerCase().indexOf(q) === -1); });
  });

  /* ------------------------------ درج توکن در متغیرها ------------------------------ */
  var lastField = null;
  d.addEventListener('focusin', function (e) { if (e.target.matches('[data-token-target]')) lastField = e.target; });
  d.addEventListener('click', function (e) {
    var t = e.target.closest('[data-insert-token]');
    if (!t) return;
    e.preventDefault();
    var f = lastField || $('[data-token-target]');
    if (!f) return;
    var tok = '{' + t.getAttribute('data-insert-token') + '}';
    var s = f.selectionStart || f.value.length;
    f.value = f.value.slice(0, s) + tok + f.value.slice(f.selectionEnd || s);
    f.focus();
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* ------------------------------ درخواست AJAX ------------------------------ */
  function csrf() { var m = $('meta[name="csrf-token"]'); return m ? m.content : ''; }
  function api(url, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    var body = opts.body;
    if (body && !(body instanceof FormData) && typeof body === 'object') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = csrf();
    return fetch(url, { method: opts.method || 'GET', headers: headers, body: body, credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  window.MC.api = api;

  /* ------------------------------ اعتبار پیامک ------------------------------ */
  $$('[data-sms-credit]').forEach(function (el) {
    api(el.getAttribute('data-sms-credit')).then(function (r) {
      if (r.ok) el.innerHTML = r.test ? '<span class="text-muted text-sm">حالت آزمایشی</span>' : num(r.credit) + ' <small>' + esc(el.getAttribute('data-unit') || 'ریال') + '</small>';
      else el.innerHTML = '<span class="text-danger text-sm" title="' + esc(r.error) + '">' + icon('alert-triangle', 'icon-sm') + ' خطا در دریافت</span>';
    }).catch(function () { el.textContent = '—'; });
  });

  /* ------------------------------ دریافت پترن از IPPanel ------------------------------ */
  d.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fetch-pattern]');
    if (!b) return;
    e.preventDefault();
    var codeInput = $(b.getAttribute('data-code-input'));
    var code = codeInput ? codeInput.value.trim() : '';
    if (!code) { toast('ابتدا کد پترن را وارد کنید.', 'warning'); return; }
    b.disabled = true;
    api(b.getAttribute('data-fetch-pattern') + '?code=' + encodeURIComponent(code)).then(function (r) {
      b.disabled = false;
      if (!r.ok) { toast(r.error || 'خطا', 'error'); return; }
      var p = (r.data || []).filter(function (x) { return x.code === code; })[0] || (r.data || [])[0];
      if (!p) { toast('پترنی با این کد یافت نشد.', 'warning'); return; }
      var box = $('#pattern-message');
      if (box) { box.classList.remove('hidden'); box.querySelector('[data-msg]').textContent = p.message || ''; box.querySelector('[data-status]').textContent = p.status_fa || p.status || ''; }
      var rep = $('#vars');
      var tpl = d.getElementById(rep.getAttribute('data-template'));
      var existing = {};
      $$('[data-repeater-item]', rep).forEach(function (row) { var n = row.querySelector('[data-name*="[name]"]'); if (n && n.value) existing[n.value] = row; });
      (p.variables || []).forEach(function (v) {
        if (existing[v.name]) return;
        var h = d.createElement('div'); h.innerHTML = tpl.innerHTML.trim();
        var row = h.firstElementChild;
        row.querySelector('[data-name*="[name]"]').value = v.name;
        var guess = row.querySelector('[data-name*="[value]"]');
        if (guess) guess.value = '{' + v.name + '}';
        (rep.querySelector('[data-repeater-list]') || rep).appendChild(row);
      });
      reindex(rep);
      toast('متغیرهای پترن دریافت شد (' + fa((p.variables || []).length) + ' متغیر). مقدار هر متغیر را بررسی کنید.', 'success');
    }).catch(function () { b.disabled = false; toast('خطا در ارتباط با سرور', 'error'); });
  });

  /* ------------------------------ پیش‌نمایش گیرندگان پیامک ------------------------------ */
  var smsForm = $('#sms-send-form');
  if (smsForm) {
    var prevBtn = $('[data-preview-recipients]');
    if (prevBtn) prevBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var fd = new FormData(smsForm);
      var obj = {};
      fd.forEach(function (v, k) { if (k.slice(-2) === '[]') { k = k.slice(0, -2); (obj[k] = obj[k] || []).push(v); } else if (obj[k] !== undefined) { obj[k] = [].concat(obj[k], v); } else obj[k] = v; });
      api(prevBtn.getAttribute('data-preview-recipients'), { method: 'POST', body: obj }).then(function (r) {
        var out = $('#recipients-preview');
        out.classList.remove('hidden');
        out.innerHTML = '<b>' + fa(r.count) + ' گیرنده</b>' + (r.sample && r.sample.length ? '<div class="chips mt-2">' + r.sample.map(function (s) { return '<span class="chip">' + esc(s.name) + ' <span class="ltr text-muted">' + fa(s.mobile) + '</span></span>'; }).join('') + (r.count > r.sample.length ? '<span class="chip">و ' + fa(r.count - r.sample.length) + ' نفر دیگر</span>' : '') + '</div>' : '');
      });
    });
    var msg = $('#sms-message');
    if (msg) {
      var counter = $('#sms-counter');
      var upd = function () {
        var len = msg.value.length;
        var unicode = /[^\u0000-\u007f]/.test(msg.value);
        var per = unicode ? (len > 70 ? 67 : 70) : (len > 160 ? 153 : 160);
        var parts = Math.max(1, Math.ceil(len / per));
        counter.textContent = fa(len) + ' کاراکتر - ' + fa(parts) + ' پیامک';
      };
      msg.addEventListener('input', upd); upd();
    }
  }

  /* ------------------------------ تست اتصال پایگاه داده (نصب) ------------------------------ */
  var testBtn = $('[data-test-db]');
  if (testBtn) testBtn.addEventListener('click', function (e) {
    e.preventDefault();
    var form = testBtn.closest('form');
    var fd = new URLSearchParams(new FormData(form));
    var out = $('#db-test-result');
    testBtn.disabled = true;
    out.className = 'alert alert-info'; out.innerHTML = icon('loader-2', 'spin') + '<div>در حال بررسی اتصال...</div>';
    fetch(testBtn.getAttribute('data-test-db'), { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (r) { testBtn.disabled = false; out.className = 'alert ' + (r.ok ? 'alert-success' : 'alert-danger'); out.innerHTML = icon(r.ok ? 'check-circle-2' : 'x-circle') + '<div>' + esc(r.ok ? r.message : r.error) + '</div>'; })
      .catch(function () { testBtn.disabled = false; out.className = 'alert alert-danger'; out.textContent = 'خطا در ارتباط با سرور'; });
  });

  /* ------------------------------ مراحل نصب ------------------------------ */
  var wizard = $('[data-wizard]');
  if (wizard) {
    var panes = $$('[data-step]', wizard);
    var stepsNav = $$('.steps .step');
    var cur = 0;
    var errStep = panes.findIndex(function (p) { return p.querySelector('.has-error'); });
    if (errStep >= 0) cur = errStep;
    var show = function (i) {
      cur = i;
      panes.forEach(function (p, k) { p.classList.toggle('hidden', k !== i); });
      stepsNav.forEach(function (s, k) { s.classList.toggle('active', k === i); s.classList.toggle('done', k < i); });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    wizard.addEventListener('click', function (e) {
      if (e.target.closest('[data-next]')) {
        e.preventDefault();
        var invalid = $$('input,select', panes[cur]).filter(function (x) { return !x.checkValidity(); })[0];
        if (invalid) { invalid.reportValidity(); return; }
        show(Math.min(cur + 1, panes.length - 1));
      }
      if (e.target.closest('[data-prev]')) { e.preventDefault(); show(Math.max(cur - 1, 0)); }
    });
    show(cur);
  }

  /* ------------------------------ پیش‌نمایش اقساط ------------------------------ */
  var instForm = $('[data-installment-calc]');
  if (instForm) {
    var calc = function () {
      var amount = Number(en(($('[name="amount"]', instForm) || {}).value || '').replace(/[^\d]/g, '')) || 0;
      var discount = Number(en(($('[name="discount"]', instForm) || {}).value || '').replace(/[^\d]/g, '')) || 0;
      var total = Math.max(0, amount - discount);
      var t = $('[data-total]', instForm); if (t) t.textContent = num(total) + ' ' + (CFG.currency || '');
      var typeEl = $('[name="payment_type"]:checked', instForm) || $('[name="payment_type"]', instForm);
      var type = typeEl ? typeEl.value : 'cash';
      var out = $('[data-schedule-preview]', instForm);
      if (!out) return;
      if (type !== 'installment' || !total) { out.innerHTML = ''; return; }
      var count = Math.max(2, Number(en(($('[name="installments_count"]', instForm) || {}).value || '2')) || 2);
      var down = Number(en(($('[name="down_payment"]', instForm) || {}).value || '').replace(/[^\d]/g, '')) || 0;
      var round = Number(CFG.roundTo || 1000);
      var rows = [];
      var rest = total;
      if (down > 0) { rows.push(Math.min(down, total)); rest -= Math.min(down, total); count -= 1; }
      var each = Math.floor(rest / count / round) * round || Math.floor(rest / count);
      for (var i = 0; i < count; i++) rows.push(i === count - 1 ? rest - each * (count - 1) : each);
      out.innerHTML = '<div class="chips">' + rows.map(function (r, i) { return '<span class="chip">' + (i === 0 && down > 0 ? 'پیش‌پرداخت' : 'قسط ' + fa(i + (down > 0 ? 0 : 1))) + ': <b>' + num(r) + '</b></span>'; }).join('') + '</div>';
    };
    instForm.addEventListener('input', calc);
    instForm.addEventListener('change', calc);
    calc();
  }

  /* ------------------------------ اعتبارسنجی برنامه اقساط سفارشی ------------------------------ */
  d.addEventListener('repeater:change', function () { sumSchedule(); });
  d.addEventListener('input', function (e) { if (e.target.closest('#schedule')) sumSchedule(); });
  function sumSchedule() {
    var box = $('#schedule'); if (!box) return;
    var s = 0;
    $$('[data-name*="[amount]"]', box).forEach(function (i) { s += Number(en(i.value).replace(/[^\d]/g, '')) || 0; });
    var out = $('[data-schedule-sum]'); if (out) out.textContent = num(s);
  }
  sumSchedule();

  /* ------------------------------ پیش‌نمایش تصویر ------------------------------ */
  d.addEventListener('change', function (e) {
    var i = e.target;
    if (!i.matches('input[type="file"][data-preview]')) return;
    var img = d.getElementById(i.getAttribute('data-preview'));
    if (img && i.files && i.files[0] && /^image\//.test(i.files[0].type)) { img.src = URL.createObjectURL(i.files[0]); img.classList.remove('hidden'); }
  });

  /* ------------------------------ رنگ قالب مدرک ------------------------------ */
  $$('input[type="color"][data-sync]').forEach(function (c) {
    var t = d.getElementById(c.getAttribute('data-sync'));
    if (!t) return;
    c.addEventListener('input', function () { t.value = c.value; });
    t.addEventListener('input', function () { if (/^#[0-9a-f]{6}$/i.test(t.value)) c.value = t.value; });
  });

  /* ------------------------------ مودال‌های صفحه ------------------------------ */
  function openModal(el) { if (!el) return; el.classList.remove('hidden'); var f = el.querySelector('input:not([type=hidden]),select,textarea'); if (f) setTimeout(function () { f.focus(); }, 50); }
  function closeModal(el) { if (el) el.classList.add('hidden'); }
  d.addEventListener('click', function (e) {
    var o = e.target.closest('[data-modal-open]');
    if (o) {
      e.preventDefault();
      var m = $(o.getAttribute('data-modal-open'));
      if (m && o.hasAttribute('data-fill')) {
        try {
          var data = JSON.parse(o.getAttribute('data-fill'));
          Object.keys(data).forEach(function (k) {
            if (k === '_action') { var fm = m.querySelector('form'); if (fm) fm.action = data[k]; return; }
            var inp = m.querySelector('[name="' + k + '"]');
            if (!inp) return;
            if (inp.type === 'checkbox') inp.checked = !!data[k]; else inp.value = data[k] === null ? '' : data[k];
          });
        } catch (err) { /* ignore */ }
      }
      openModal(m);
      return;
    }
    if (e.target.closest('[data-modal-close]')) { closeModal(e.target.closest('.modal-backdrop')); return; }
    if (e.target.classList && e.target.classList.contains('modal-backdrop') && e.target.hasAttribute('data-page-modal')) closeModal(e.target);
  });
  d.addEventListener('keydown', function (e) { if (e.key === 'Escape') $$('.modal-backdrop[data-page-modal]:not(.hidden)').forEach(closeModal); });

  /* ------------------------------ انتخاب‌گر کاربر (جستجوی زنده) ------------------------------ */
  $$('[data-user-picker]').forEach(function (box) {
    var input = box.querySelector('input[type=search],input[type=text]');
    var list = d.createElement('div'); list.className = 'picker-results hidden'; box.appendChild(list);
    var chosen = box.querySelector('[data-picked]');
    var name = box.getAttribute('data-name') || 'user_ids';
    var single = box.hasAttribute('data-single');
    var timer = null; var last = '';
    function render(items) {
      if (!items.length) { list.innerHTML = '<div class="picker-empty">موردی یافت نشد</div>'; list.classList.remove('hidden'); return; }
      list.innerHTML = items.map(function (it) { return '<button type="button" class="picker-item" data-id="' + it.id + '" data-text="' + esc(it.text) + '"><b>' + esc(it.text) + '</b><small>' + esc(fa(it.sub || '')) + '</small></button>'; }).join('');
      list.classList.remove('hidden');
    }
    function search() {
      var q = input.value.trim();
      if (q.length < 2) { list.classList.add('hidden'); return; }
      if (q === last) { list.classList.remove('hidden'); return; }
      last = q;
      var u = box.getAttribute('data-user-picker'); u += (u.indexOf('?') > -1 ? '&' : '?') + 'q=' + encodeURIComponent(en(q));
      fetch(u, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(render).catch(function () {});
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(search, 250); });
    input.addEventListener('focus', function () { if (list.innerHTML) list.classList.remove('hidden'); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    d.addEventListener('click', function (e) { if (!box.contains(e.target)) list.classList.add('hidden'); });
    list.addEventListener('click', function (e) {
      var b = e.target.closest('.picker-item'); if (!b) return;
      var id = b.getAttribute('data-id');
      if (single) chosen.innerHTML = '';
      if (chosen.querySelector('input[value="' + id + '"]')) return;
      var chip = d.createElement('span'); chip.className = 'chip chip-removable';
      chip.innerHTML = esc(b.getAttribute('data-text')) + '<input type="hidden" name="' + esc(name) + '" value="' + esc(id) + '"><button type="button" aria-label="حذف">×</button>';
      chosen.appendChild(chip);
      input.value = ''; last = ''; list.classList.add('hidden');
      box.dispatchEvent(new CustomEvent('picker:change', { bubbles: true }));
    });
    chosen.addEventListener('click', function (e) { if (e.target.closest('button')) { e.target.closest('.chip').remove(); box.dispatchEvent(new CustomEvent('picker:change', { bubbles: true })); } });
  });

  /* ------------------------------ پر کردن خودکار مبلغ از کلاس ------------------------------ */
  $$('select[data-fill-amount]').forEach(function (sel) {
    var target = $(sel.getAttribute('data-fill-amount'));
    if (!target) return;
    var apply = function (force) {
      var o = sel.options[sel.selectedIndex];
      var p = o ? o.getAttribute('data-price') : '';
      if (p && Number(p) > 0 && (force || !en(target.value).replace(/[^\d]/g, ''))) {
        target.value = num(Number(p));
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    sel.addEventListener('change', function () { apply(true); });
    apply(false);
  });
})();

/* ------------------------------ فیلتر دسته‌بندی دوره‌ها (صفحه اصلی) ------------------------------ */
(function () {
  var box = document.getElementById('cat-pills');
  if (!box) return;
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]');
    if (!b) return;
    Array.prototype.forEach.call(box.querySelectorAll('.pill'), function (p) { p.classList.toggle('active', p === b); });
    var cat = b.getAttribute('data-cat');
    Array.prototype.forEach.call(document.querySelectorAll('#courses > [data-course]'), function (c) {
      c.style.display = !cat || c.getAttribute('data-cat') === cat ? '' : 'none';
    });
  });
})();
