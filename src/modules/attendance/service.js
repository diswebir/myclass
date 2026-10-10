'use strict';
const settings = require('../../core/settings');

/** محاسبه درصد حضور بر اساس تنظیمات (تأخیر و غیبت موجه) */
function rate(c = {}) {
  const present = Number(c.present || 0);
  const late = Number(c.late || 0);
  const absent = Number(c.absent || 0);
  const excused = Number(c.excused || 0);
  const lateAsPresent = settings.get('attendance.late_counts_present', true);
  const excusedMode = settings.get('attendance.excused_mode', 'exclude');
  let attended = present + (lateAsPresent ? late : 0);
  let total = present + late + absent;
  if (excusedMode === 'present') { attended += excused; total += excused; } else if (excusedMode === 'absent') total += excused;
  if (!total) return null;
  return Math.round((attended / total) * 100);
}

module.exports = { rate };
