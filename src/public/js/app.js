/* ═══════════════════════════════════════════════════════
   MyClass Platform — Client Scripts (vanilla JS)
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── تم تیره / روشن ──────────────────────────────────
  var themeToggle = document.getElementById('themeToggle');
  var savedTheme = localStorage.getItem('myclass-theme') || 'light';
  document.body.setAttribute('data-theme', savedTheme);
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var cur = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', cur);
      localStorage.setItem('myclass-theme', cur);
    });
  }

  // ── سایدبار موبایل ──────────────────────────────────
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  var openBtn = document.getElementById('sidebarOpen');
  var closeBtn = document.getElementById('sidebarClose');
  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
  }
  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }
  if (openBtn) openBtn.addEventListener('click', openSidebar);
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  // ── تقویم شمسی (Datepicker) ─────────────────────────
  var FA_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var FA_DOW = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

  function toFa(n) {
    return String(n).replace(/[0-9]/g, function (d) { return FA_DIGITS[+d]; });
  }
  function toEn(str) {
    return String(str || '')
      .replace(/[۰-۹]/g, function (d) { return String(FA_DIGITS.indexOf(d)); })
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
  }

  var JL = window.jalaali;

  function jalYearLen(jy) {
    try {
      return JL.isLeapJalaaliYear(jy) ? 366 : 365;
    } catch (e) {
      return 365;
    }
  }

  function fmtJalali(date) {
    var j = JL.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return toFa(j.jy) + '/' + toFa(('0' + j.jm).slice(-2)) + '/' + toFa(('0' + j.jd).slice(-2));
  }

  function parseJalaliInput(str) {
    var s = toEn(str).replace(/-/g, '/').trim();
    var parts = s.split('/');
    if (parts.length < 3) return null;
    var jy = parseInt(parts[0], 10), jm = parseInt(parts[1], 10), jd = parseInt(parts[2], 10);
    if (isNaN(jy) || isNaN(jm) || isNaN(jd)) return null;
    if (jy > 1700) return new Date(jy, jm - 1, jd);
    if (!JL.isValidJalaaliDate(jy, jm, jd)) return null;
    var g = JL.toGregorian(jy, jm, jd);
    return new Date(g.gy, g.gm - 1, g.gd);
  }

  function buildDatepicker(input) {
    var wrap = document.createElement('div');
    wrap.className = 'jdp';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('jdp-input');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', '۱۴۰۳/۰۷/۰۱');

    var pop = document.createElement('div');
    pop.className = 'jdp-pop';
    wrap.appendChild(pop);

    var state = parseJalaliInput(input.value) || new Date();
    var jState = JL.toJalaali(state.getFullYear(), state.getMonth() + 1, state.getDate());

    function render() {
      var jy = jState.jy, jm = jState.jm;
      var daysInMonth = JL.jalaaliMonthLength(jy, jm);
      var firstG = JL.toGregorian(jy, jm, 1);
      var firstDay = new Date(firstG.gy, firstG.gm - 1, firstG.gd);
      var startDow = (firstDay.getDay() + 1) % 7; // شنبه=0

      var html = '<div class="jdp-head">';
      html += '<button type="button" data-nav="next">‹</button>';
      html += '<span class="jdp-title">' + FA_MONTHS[jm - 1] + ' ' + toFa(jy) + '</span>';
      html += '<button type="button" data-nav="prev">›</button>';
      html += '</div><div class="jdp-grid">';
      for (var d = 0; d < 7; d++) html += '<div class="dow">' + FA_DOW[d] + '</div>';
      for (var e = 0; e < startDow; e++) html += '<button type="button" class="day empty"></button>';
      var now = new Date();
      var todayJ = JL.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
      for (var day = 1; day <= daysInMonth; day++) {
        var cls = 'day';
        if (jState.jd === day && jState.jm === jm && jState.jy === jy) cls += ' selected';
        if (todayJ.jy === jy && todayJ.jm === jm && todayJ.jd === day) cls += ' today';
        html += '<button type="button" class="' + cls + '" data-day="' + day + '">' + toFa(day) + '</button>';
      }
      html += '</div>';
      pop.innerHTML = html;

      pop.querySelectorAll('[data-nav]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (btn.getAttribute('data-nav') === 'prev') {
            jState.jm -= 1;
            if (jState.jm < 1) { jState.jm = 12; jState.jy -= 1; }
          } else {
            jState.jm += 1;
            if (jState.jm > 12) { jState.jm = 1; jState.jy += 1; }
          }
          render();
        });
      });
      pop.querySelectorAll('.day[data-day]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var day = parseInt(btn.getAttribute('data-day'), 10);
          var g = JL.toGregorian(jState.jy, jState.jm, day);
          input.value = fmtJalali(new Date(g.gy, g.gm - 1, g.gd));
          input.dispatchEvent(new Event('change'));
          pop.classList.remove('open');
        });
      });
    }

    input.addEventListener('click', function (ev) {
      ev.stopPropagation();
      document.querySelectorAll('.jdp-pop.open').forEach(function (p) { if (p !== pop) p.classList.remove('open'); });
      if (!pop.classList.contains('open')) {
        var parsed = parseJalaliInput(input.value);
        if (parsed) {
          jState = JL.toJalaali(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
        }
        render();
      }
      pop.classList.toggle('open');
    });
    pop.addEventListener('click', function (ev) { ev.stopPropagation(); });

    // نرمال‌سازی هنگام تایپ
    input.addEventListener('blur', function () {
      if (input.value.trim() === '') return;
      var parsed = parseJalaliInput(input.value);
      if (parsed) {
        input.value = fmtJalali(parsed);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input[data-jdp]').forEach(buildDatepicker);
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.jdp-pop.open').forEach(function (p) { p.classList.remove('open'); });
  });

  // ── تایید حذف ───────────────────────────────────────
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.hasAttribute('data-confirm')) {
      if (!window.confirm(form.getAttribute('data-confirm') || 'آیا مطمئن هستید؟')) {
        e.preventDefault();
      }
    }
  });

  // ── جستجوی دانش‌آموز (افزودن به کلاس) ─────────────
  var stuSearch = document.getElementById('studentSearch');
  if (stuSearch) {
    var resultsBox = document.getElementById('studentResults');
    var classId = stuSearch.getAttribute('data-class-id');
    var timer = null;
    stuSearch.addEventListener('input', function () {
      clearTimeout(timer);
      var q = stuSearch.value.trim();
      if (q.length < 1) { resultsBox.innerHTML = ''; return; }
      timer = setTimeout(function () {
        fetch('/panel/classes/' + classId + '/available-students?q=' + encodeURIComponent(q), {
          headers: { 'x-csrf-token': document.querySelector('meta[name="csrf-token"]').content }
        })
          .then(function (r) { return r.json(); })
          .then(function (rows) {
            var html = '';
            rows.forEach(function (s) {
              html += '<button type="button" class="list-row stu-pick" data-id="' + s.id + '" style="width:100%;text-align:right;background:none;border:0;cursor:pointer;">';
              html += '<span class="main"><strong>' + s.first_name + ' ' + s.last_name + '</strong>';
              html += '<small class="text-muted">' + (s.phone || '') + '</small></span>';
              html += '<span class="side"><span class="badge badge-accent">افزودن</span></span></button>';
            });
            resultsBox.innerHTML = html || '<p class="text-muted" style="padding:10px">موردی یافت نشد</p>';
            resultsBox.querySelectorAll('.stu-pick').forEach(function (btn) {
              btn.addEventListener('click', function () {
                document.getElementById('student_id_input').value = btn.getAttribute('data-id');
                document.getElementById('addStudentForm').submit();
              });
            });
          });
      }, 300);
    });
  }

  // ── چک‌باکس‌های حضور و غیاب ─────────────────────────
  document.querySelectorAll('.att-group').forEach(function (group) {
    group.querySelectorAll('.att-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        group.querySelectorAll('.att-btn').forEach(function (b) {
          b.className = 'att-btn';
        });
        var val = btn.getAttribute('data-value');
        btn.classList.add('on-' + val);
        var input = group.querySelector('input[type="hidden"]');
        if (input) input.value = val;
      });
    });
  });

  // ── هدایت با تغییر فیلتر ────────────────────────────
  document.querySelectorAll('select[data-auto-submit], input[data-auto-submit]').forEach(function (el) {
    el.addEventListener('change', function () {
      var form = el.closest('form');
      if (form) form.submit();
    });
  });

  // ── نمایش/مخفی‌سازی رمز عبور ────────────────────────
  document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-toggle-password'));
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // ── تولید رمز عبور ─────────────────────────────────
  document.querySelectorAll('[data-gen-password]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-gen-password'));
      if (!input) return;
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      var pass = '';
      var arr = new Uint8Array(12);
      crypto.getRandomValues(arr);
      for (var i = 0; i < 12; i++) pass += chars[arr[i] % chars.length];
      input.value = pass;
    });
  });

  // ── افزودن ردیف کارت بانکی در تنظیمات ──────────────
  var addCardBtn = document.getElementById('addCardBtn');
  if (addCardBtn) {
    addCardBtn.addEventListener('click', function () {
      var box = document.getElementById('cardsBox');
      var idx = box.querySelectorAll('.card-row').length;
      var div = document.createElement('div');
      div.className = 'form-row-3 card-row mb-2';
      div.innerHTML =
        '<input class="form-control" name="card_bank" placeholder="نام بانک">' +
        '<input class="form-control" name="card_holder" placeholder="نام صاحب حساب">' +
        '<div class="input-group"><input class="form-control" name="card_number" placeholder="شماره کارت">' +
        '<button type="button" class="btn btn-danger btn-sm remove-card">حذف</button></div>';
      box.appendChild(div);
      div.querySelector('.remove-card').addEventListener('click', function () { div.remove(); });
    });
    document.querySelectorAll('.remove-card').forEach(function (btn) {
      btn.addEventListener('click', function () { btn.closest('.card-row').remove(); });
    });
  }

  // ── افزودن ردیف نگاشت متغیر پیامک ──────────────────
  var addMapBtn = document.getElementById('addMapRow');
  if (addMapBtn) {
    addMapBtn.addEventListener('click', function () {
      var box = document.getElementById('mapBox');
      var div = document.createElement('div');
      div.className = 'form-row mb-2 map-row';
      div.innerHTML =
        '<input class="form-control" name="map_key" placeholder="کلید در پترن (مثال: name)">' +
        '<div class="input-group"><select class="form-select" name="map_val">' +
        (window.SYSTEM_VARS_OPTIONS || '') +
        '</select><button type="button" class="btn btn-danger btn-sm remove-map">حذف</button></div>';
      box.appendChild(div);
      div.querySelector('.remove-map').addEventListener('click', function () { div.remove(); });
    });
  }

  // ── تایید فرم‌های حساس ─────────────────────────────
  // (با data-confirm روی فرم)

  // ── نمایش مبلغ با اعداد فارسی هنگام تایپ ──────────
  document.querySelectorAll('input[data-money-preview]').forEach(function (input) {
    input.addEventListener('input', function () {
      var out = document.getElementById(input.getAttribute('data-money-preview'));
      if (!out) return;
      var v = toEn(input.value).replace(/[^\d]/g, '');
      out.textContent = v ? toFa(v.replace(/\B(?=(\d{3})+(?!\d))/g, '،')) : '—';
    });
  });
})();
