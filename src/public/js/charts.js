/* ═══════════════════════════════════════════════════════
   MyClass Platform — Charts (Chart.js + برچسب‌های فارسی)
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (typeof Chart === 'undefined') return;

  Chart.defaults.font.family = "'Vazirmatn', Tahoma, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#5b6178';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Chart.defaults.plugins.tooltip.rtl = true;
  Chart.defaults.plugins.tooltip.textDirection = 'rtl';
  Chart.defaults.plugins.tooltip.titleFont = { family: "'Vazirmatn', Tahoma, sans-serif", weight: '700' };
  Chart.defaults.plugins.tooltip.bodyFont = { family: "'Vazirmatn', Tahoma, sans-serif" };
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;

  var PALETTE = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];

  function faNum(n) {
    return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[+d]; });
  }

  function gradient(ctx, c1, c2) {
    var g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    return g;
  }

  window.MyCharts = {
    palette: PALETTE,
    faNum: faNum,

    /** نمودار خطی درآمد */
    incomeLine: function (canvasId, labels, values) {
      var el = document.getElementById(canvasId);
      if (!el) return;
      var ctx = el.getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'درآمد (تومان)',
            data: values,
            borderColor: '#6366f1',
            backgroundColor: gradient(ctx, 'rgba(99,102,241,0.28)', 'rgba(99,102,241,0.01)'),
            fill: true,
            tension: 0.38,
            pointBackgroundColor: '#6366f1',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (c) {
                  return ' درآمد: ' + faNum(c.parsed.y.toLocaleString('en-US')) + ' تومان';
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(120,130,160,0.12)' },
              ticks: {
                callback: function (v) {
                  return faNum(v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000) + 'K' : v);
                }
              }
            },
            x: { grid: { display: false } }
          }
        }
      });
    },

    /** نمودار میله‌ای ظرفیت کلاس‌ها */
    classFill: function (canvasId, items) {
      var el = document.getElementById(canvasId);
      if (!el) return;
      new Chart(el, {
        type: 'bar',
        data: {
          labels: items.map(function (i) { return i.label; }),
          datasets: [
            {
              label: 'ثبت‌نام‌شده',
              data: items.map(function (i) { return i.value; }),
              backgroundColor: '#6366f1',
              borderRadius: 8,
              barPercentage: 0.62
            },
            {
              label: 'ظرفیت خالی',
              data: items.map(function (i) { return Math.max(0, (i.max || 0) - i.value); }),
              backgroundColor: 'rgba(99,102,241,0.16)',
              borderRadius: 8,
              barPercentage: 0.62
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: function (c) { return ' ' + c.dataset.label + ': ' + faNum(c.parsed.y); }
              }
            }
          },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: {
              stacked: true,
              beginAtZero: true,
              grid: { color: 'rgba(120,130,160,0.12)' },
              ticks: { callback: function (v) { return faNum(v); } }
            }
          }
        }
      });
    },

    /** نمودار دایره‌ای توزیع */
    donut: function (canvasId, labels, values, colors) {
      var el = document.getElementById(canvasId);
      if (!el) return;
      new Chart(el, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            backgroundColor: colors || PALETTE,
            borderWidth: 0,
            hoverOffset: 10
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: function (c) { return ' ' + c.label + ': ' + faNum(c.parsed); }
              }
            }
          }
        }
      });
    },

    /** نمودار ترکیبی حضور و غیاب */
    attendanceBars: function (canvasId, rows) {
      var el = document.getElementById(canvasId);
      if (!el) return;
      new Chart(el, {
        type: 'bar',
        data: {
          labels: rows.map(function (r) { return r.title; }),
          datasets: [
            { label: 'حاضر', data: rows.map(function (r) { return Number(r.present || 0); }), backgroundColor: '#10b981', borderRadius: 6 },
            { label: 'غایب', data: rows.map(function (r) { return Number(r.absent || 0); }), backgroundColor: '#ef4444', borderRadius: 6 },
            { label: 'تاخیر', data: rows.map(function (r) { return Number(r.late || 0); }), backgroundColor: '#f59e0b', borderRadius: 6 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: function (c) { return ' ' + c.dataset.label + ': ' + faNum(c.parsed.y); }
              }
            }
          },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: {
              stacked: true,
              beginAtZero: true,
              grid: { color: 'rgba(120,130,160,0.12)' },
              ticks: { callback: function (v) { return faNum(v); } }
            }
          }
        }
      });
    },

    /** نمودار چندخطی / Radar */
    radar: function (canvasId, labels, values, label) {
      var el = document.getElementById(canvasId);
      if (!el) return;
      new Chart(el, {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [{
            label: label || 'امتیاز',
            data: values,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139,92,246,0.22)',
            pointBackgroundColor: '#8b5cf6'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            r: {
              beginAtZero: true,
              ticks: { stepSize: 25, backdropColor: 'transparent' },
              grid: { color: 'rgba(120,130,160,0.18)' },
              angleLines: { color: 'rgba(120,130,160,0.18)' },
              pointLabels: { font: { family: "'Vazirmatn', Tahoma", size: 11 } }
            }
          }
        }
      });
    }
  };
})();
