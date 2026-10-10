/**
 * شکل‌دهی متن فارسی برای رندر PDF (و هر خروجی که شکل‌دهی مرورگر ندارد).
 *
 * خط لوله:
 *   ۱. shapeLogical: متن منطقی (logical order) را با استفاده از جدول فرم‌های فارسی
 *      (persian-forms.json — تولیدشده و تأییدشده با HarfBuzz) به «presentation forms» تبدیل می‌کند.
 *   2. toVisualOrder: با bidi-js (UAX#9) ترتیب دیداری (visual order) را می‌سازد.
 *   3. shapeRtl: هر دو مرحله را برای متن فارسی (پایه RTL) انجام می‌دهد.
 *
 * نکته: جدول فرم‌ها در زمان build توسط scripts/spike-pdf.ts با HarfBuzz (مرجع industry)
 * تولید و با تست‌های snapshot در برابر harfbuzz تأیید می‌شود.
 */
import bidiFactory from 'bidi-js';
import table from './persian-forms.json';

export interface LetterForms {
  /** کد Unicode فرم تنها (isolated) */
  isolated: number;
  /** فرم پایانی (final) — وقتی به حرف قبلی متصل است */
  final: number;
  /** فرم آغازی (initial) — وقتی به حرف بعدی متصل است */
  initial: number;
  /** فرم میانی (medial) — وقتی به هر دو طرف متصل است */
  medial: number;
  /** آیا حرف به حرف بعدی هم متصل می‌شود (dual-joining) */
  dual: boolean;
}

interface LamAlefLigature {
  isolated: number;
  final: number;
}

interface FormsTable {
  version: number;
  /** کلید: codepoint حرف به صورت رشته عددی (decimal) */
  letters: Record<string, LetterForms>;
  /** نگاشت ligature «لا»: کلید = codepoint الف (ا أ إ آ) ← فرم‌های isolated/final */
  lamAlef: Record<string, LamAlefLigature>;
  zwnj: number;
  /** codepointهایی که حذف می‌شوند (harakat، tatweel) */
  marks: number[];
}

const T = table as unknown as FormsTable;

const LAM = 0x0644;

const letters: Record<number, LetterForms> = {};
for (const [k, v] of Object.entries(T.letters)) letters[Number(k)] = v;

const lamAlef: Record<number, LamAlefLigature> = {};
for (const [k, v] of Object.entries(T.lamAlef)) lamAlef[Number(k)] = v;

const markSet = new Set<number>(T.marks);
const isMark = (cp: number): boolean => markSet.has(cp);

/**
 * تبدیل متن منطقی فارسی به «presentation forms» (ترتیب منطقی حفظ می‌شود).
 * harakat حذف می‌شوند؛ ZWNJ (نیم‌فاصله) cucina obtiene relatório.
 */
export function shapeLogical(text: string): string {
  const cps = Array.from(text, (c) => c.codePointAt(0) as number);
  const out: number[] = [];
  let prevConnectsForward = false;
  let i = 0;
  while (i < cps.length) {
    const cp = cps[i];
    if (isMark(cp)) {
      i++;
      continue;
    }
    if (cp === T.zwnj) {
      out.push(cp);
      prevConnectsForward = false;
      i++;
      continue;
    }
    const L = letters[cp];
    if (!L) {
      out.push(cp);
      prevConnectsForward = false;
      i++;
      continue;
    }
    // ligature «لا» (و miércoles alef)
    if (cp === LAM) {
      let j = i + 1;
      while (j < cps.length && isMark(cps[j])) j++;
      const ncp = cps[j];
      const lig = ncp !== undefined ? lamAlef[ncp] : undefined;
      if (lig) {
        out.push(prevConnectsForward ? lig.final : lig.isolated);
        prevConnectsForward = false;
        i = j + 1;
        continue;
      }
    }
    // جستجوی حرف بعدی متصل‌شونده (با رد کردن harakat)
    let j = i + 1;
    while (j < cps.length && isMark(cps[j])) j++;
    const ncp = cps[j];
    const nextJoins = ncp !== undefined && ncp !== T.zwnj && letters[ncp] !== undefined;
    const joinsPrev = prevConnectsForward;
    const joinsNext = L.dual && nextJoins;
    let form: number;
    if (joinsPrev && joinsNext) form = L.medial;
    else if (joinsPrev) form = L.final;
    else if (joinsNext) form = L.initial;
    else form = L.isolated;
    out.push(form);
    prevConnectsForward = L.dual && joinsNext;
    i++;
  }
  return String.fromCodePoint(...out);
}

const bidi = bidiFactory();

/** تبدیل ترتیب منطقی به ترتیب دیداری با الگوریتم UAX#9 (bidi-js). */
export function toVisualOrder(logical: string, baseDirection: 'rtl' | 'ltr' = 'rtl'): string {
  const levels = bidi.getEmbeddingLevels(logical, baseDirection);
  return bidi.getReorderedString(logical, levels);
}

/** شکل‌دهی + ترتیب دیداری برای متن فارسی (پایه RTL). خروجی برای drawText چپ‌به‌راست است. */
export function shapeRtl(text: string, baseDirection: 'rtl' | 'ltr' = 'rtl'): string {
  return toVisualOrder(shapeLogical(text), baseDirection);
}

/** تبدیل codepointهای خروجی به رشته hex برای muqâbele در تست‌ها. */
export function toHex(cps: number[]): string {
  return cps.map((c) => c.toString(16).toUpperCase().padStart(4, '0')).join(' ');
}

export function stringToCps(s: string): number[] {
  return Array.from(s, (c) => c.codePointAt(0) as number);
}
