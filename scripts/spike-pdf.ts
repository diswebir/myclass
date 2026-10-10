/**
 * Spike فاز ۰ — PDF فارسی:
 *  ۱. جدول فرم‌های فارسی (persian-forms.json) را با HarfBuzz (harfbuzzjs، calt خاموش) تولید می‌کند.
 *  ۲. Fixture کلمات را با HarfBuzz تولید می‌کند (tests/fixtures/shaping-cases.json).
 *  ۳. شکل‌دهنده runtime (src/core/text/shape.ts) را در برابر HarfBuzz اعتبارسنجی می‌کند.
 *  ۴. یک گواهی نمونه با pdf-lib + فونت Vazirmatn (embed شده) می‌سازد و ساختار PDF را بررسی می‌کند.
 *
 * اجرا: npx tsx scripts/spike-pdf.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import fontkit from 'fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const ROOT = path.join(__dirname, '..');
const FONT_REGULAR = path.join(ROOT, 'public/fonts/Vazirmatn-Regular.ttf');
const FONT_BOLD = path.join(ROOT, 'public/fonts/Vazirmatn-Bold.ttf');
const OUT_DIR = path.join(ROOT, 'spike-output');
const TABLE_PATH = path.join(ROOT, 'src/core/text/persian-forms.json');
const FIXTURE_PATH = path.join(ROOT, 'tests/fixtures/shaping-cases.json');

// حروف dual-joining فارسی/عربی
const DUAL_LETTERS = [
  0x0628, 0x067e, 0x062a, 0x062b, 0x062c, 0x0686, 0x062d, 0x062e, 0x0633, 0x0634,
  0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063a, 0x0641, 0x0642, 0x0643, 0x06a9,
  0x06af, 0x0644, 0x0645, 0x0646, 0x0647, 0x06cc, 0x0626,
];
// حروف right-joining (فقط به حرف قبلی متصل می‌شوند)
const RIGHT_LETTERS = [
  0x0627, 0x062f, 0x0630, 0x0631, 0x0632, 0x0698, 0x0648, 0x0623, 0x0625, 0x0622,
  0x0621, 0x0629, 0x0624,
];
const ALL_LETTERS = [...DUAL_LETTERS, ...RIGHT_LETTERS];
const ALEF_VARIANTS = [0x0627, 0x0623, 0x0625, 0x0622]; // ا أ إ آ
const PROBE = String.fromCodePoint(0x0628); // «ب» به عنوان حرف probe (dual-joining)
const ZWNJ = 0x200c;
const MARKS = [
  ...Array.from({ length: 0x0652 - 0x064b + 1 }, (_, i) => 0x064b + i), // 064B..0652 harakat
  0x0670, // superscript alef
  0x0653, 0x0654, 0x0655, 0x0656, // hamza marks
  0x0640, // tatweel (kashida — تزئینی، حذف می‌شود)
];

// کد standard Unicode (Arabic Presentation Forms-B/A) برای fallback — فرم‌های contexteual
// ترتیب: [final, initial, medial] برای dual-joining؛ [final] برای right-joining
const STD_FORMS: Record<number, { final?: number; initial?: number; medial?: number }> = {
  0x0628: { final: 0xfe90, initial: 0xfe91, medial: 0xfe92 }, // ب
  0x067e: { final: 0xfb57, initial: 0xfb58, medial: 0xfb59 }, // پ
  0x062a: { final: 0xfe96, initial: 0xfe97, medial: 0xfe98 }, // ت
  0x062b: { final: 0xfe9a, initial: 0xfe9b, medial: 0xfe9c }, // ث
  0x062c: { final: 0xfe9e, initial: 0xfe9f, medial: 0xfea0 }, // ج
  0x0686: { final: 0xfb7b, initial: 0xfb7c, medial: 0xfb7d }, // چ
  0x062d: { final: 0xfea2, initial: 0xfea3, medial: 0xfea4 }, // ح
  0x062e: { final: 0xfea6, initial: 0xfea7, medial: 0xfea8 }, // خ
  0x0633: { final: 0xfeb2, initial: 0xfeb3, medial: 0xfeb4 }, // س
  0x0634: { final: 0xfeb6, initial: 0xfeb7, medial: 0xfeb8 }, // ش
  0x0635: { final: 0xfeba, initial: 0xfebb, medial: 0xfebc }, // ص
  0x0636: { final: 0xfebe, initial: 0xfebf, medial: 0xfec0 }, // ض
  0x0637: { final: 0xfec2, initial: 0xfec3, medial: 0xfec4 }, // ط
  0x0638: { final: 0xfec6, initial: 0xfec7, medial: 0xfec8 }, // ظ
  0x0639: { final: 0xfeca, initial: 0xfecb, medial: 0xfecc }, // ع
  0x063a: { final: 0xfece, initial: 0xfecf, medial: 0xfed0 }, // غ
  0x0641: { final: 0xfed2, initial: 0xfed3, medial: 0xfed4 }, // ف
  0x0642: { final: 0xfed6, initial: 0xfed7, medial: 0xfed8 }, // ق
  0x0643: { final: 0xfeda, initial: 0xfedb, medial: 0xfedc }, // ک
  0x06a9: { final: 0xfeda, initial: 0xfedb, medial: 0xfedc }, // ک (kaf)
  0x06af: { final: 0xfb93, initial: 0xfb94, medial: 0xfb95 }, // گ
  0x0644: { final: 0xfede, initial: 0xfedf, medial: 0xfee0 }, // ل
  0x0645: { final: 0xfee2, initial: 0xfee3, medial: 0xfee4 }, // م
  0x0646: { final: 0xfee6, initial: 0xfee7, medial: 0xfee8 }, // ن
  0x0647: { final: 0xfeea, initial: 0xfeeb, medial: 0xfeec }, // ه
  0x06cc: { final: 0xfbfd, initial: 0xfbfe, medial: 0xfbff }, // ی
  0x0626: { final: 0xfe88, initial: 0xfe89, medial: 0xfe8a }, // ئ
  0x0627: { final: 0xfe8e }, // ا
  0x062f: { final: 0xfeaa }, // د
  0x0630: { final: 0xfeac }, // ذ
  0x0631: { final: 0xfeae }, // ر
  0x0632: { final: 0xfeb0 }, // ز
  0x0698: { final: 0xfb8b }, // ژ
  0x0648: { final: 0xfef0 }, // و
  0x0623: { final: 0xfe82 }, // أ
  0x0625: { final: 0xfe86 }, // إ
  0x0622: { final: 0xfe8c }, // آ
  0x0624: { final: 0xfe84 }, // ؤ
  0x0629: { final: 0xfe94 }, // ة
};
// Ligature «لا» — [isolated, final]
const STD_LAM_ALEF: Record<number, [number, number]> = {
  0x0627: [0xfefb, 0xfefc], // لا
  0x0623: [0xfef7, 0xfef8], // لأ
  0x0625: [0xfef9, 0xfefa], // لإ
  0x0622: [0xfef5, 0xfef6], // لآ
};

const FIXTURE_WORDS = [
  'سلام', 'ایران', 'تهران', 'برنامه‌نویسی', 'مدرسه', 'دانش‌آموز', 'کلاس',
  'CS101', 'کلاس ۱۲۳', 'سلام 123', '123 سلام', 'Hello سلام', 'سلام World 2026',
  'لا', 'بلا', 'لآ', 'بلآ', 'لأ', 'لإ', 'مأ', 'قرأ', 'سؤال', 'مسئول',
];

const isPresentationForm = (cp: number): boolean =>
  (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);

function hex(cps: number[]): string {
  return cps.map((c) => c.toString(16).toUpperCase().padStart(4, '0')).join(' ');
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });

  const hb: any = await import('harfbuzzjs');
  const caltOff = new hb.Feature('calt', 0);
  const fontBytes = fs.readFileSync(FONT_REGULAR);

  // --- نقشه‌های معکوس glyph id -> codepoint ---
  const fkFont: any = fontkit.create(fontBytes);
  const reversePres = new Map<number, number>();
  const reverseBase = new Map<number, number>();
  for (const cp of [...(fkFont.characterSet as number[])].sort((a, b) => a - b)) {
    const g = fkFont.glyphForCodePoint(cp);
    if (!g || g.id === 0) continue;
    if (isPresentationForm(cp)) {
      if (!reversePres.has(g.id)) reversePres.set(g.id, cp);
    } else if (!reverseBase.has(g.id)) {
      reverseBase.set(g.id, cp);
    }
  }
  const glyphToCp = (gid: number): number | undefined => reversePres.get(gid) ?? reverseBase.get(gid);
  const cmapGlyph = (cp: number): number => {
    const g = fkFont.glyphForCodePoint(cp);
    return g ? g.id : 0;
  };

  // --- Face/Font HarfBuzz (calt خاموش — فقط مدل joining) ---
  const blob = new hb.Blob(fontBytes);
  const face = new hb.Face(blob, 0);
  const hfont = new hb.Font(face);
  // خروجی HarfBuzz برای RTL «visual order» است؛ آن را برعکس می‌کنیم تا منطقی شود.
  const shapeInfos = (text: string): Array<{ glyph: number; cluster: number }> => {
    const buf = new hb.Buffer();
    buf.addText(text);
    buf.setDirection(hb.Direction.RTL);
    buf.setScript('Arab');
    buf.setLanguage('fa');
    hb.shape(hfont, buf, [caltOff]);
    return buf.getGlyphInfos().map((g: any) => ({ glyph: g.codepoint as number, cluster: g.cluster as number })).reverse();
  };
  const shapeGlyphs = (text: string): number[] => shapeInfos(text).map((i) => i.glyph);

  // --- ۱. تولید جدول فرم‌ها ---
  const letters: Record<string, any> = {};
  const variantLog: string[] = [];
  for (const cp of ALL_LETTERS) {
    const ch = String.fromCodePoint(cp);
    const isoG = shapeGlyphs(ch)[0];
    const finG = shapeGlyphs(PROBE + ch).pop() as number;
    const iniG = shapeGlyphs(ch + PROBE)[0];
    const medG = shapeGlyphs(PROBE + ch + PROBE)[1];
    const dual = DUAL_LETTERS.includes(cp);
    const std = STD_FORMS[cp] || {};
    const pick = (g: number, stdCp: number | undefined, ctx: string): number => {
      const found = glyphToCp(g);
      if (found !== undefined) {
        if (cmapGlyph(found) !== g) throw new Error(`حرف ${ch} ${ctx}: ناسازگاری نقشه معکوس`);
        if (stdCp !== undefined && found !== stdCp) {
          variantLog.push(`${ch} ${ctx}: glyph ${g} -> U+${found.toString(16)} (standard U+${stdCp.toString(16)}؛ variant فونت)`);
        }
        return found;
      }
      if (stdCp === undefined || cmapGlyph(stdCp) === 0) {
        throw new Error(`حرف ${ch}: فرم ${ctx} (glyph ${g}) — کد codepoint در cmap یافت نشد`);
      }
      variantLog.push(`${ch} ${ctx}: glyph ${g} katalog reachable نیست؛ fallback U+${stdCp.toString(16)}`);
      return stdCp;
    };
    const forms: any = {
      isolated: cp, // فرم تنها = کد پایه (همیشه در cmap؛ همان glyph پیش‌فرض فونت)
      final: pick(finG, std.final, 'final'),
      initial: dual ? pick(iniG, std.initial, 'initial') : cp,
      medial: dual ? pick(medG, std.medial, 'medial') : pick(finG, std.final, 'final'),
      dual,
    };
    if (dual && forms.initial === forms.isolated) {
      throw new Error(`حرف ${ch}: initial باید با isolated متفاوت باشد`);
    }
    letters[String(cp)] = forms;
  }
  const lamAlef: Record<string, any> = {};
  for (const a of ALEF_VARIANTS) {
    const ch = String.fromCodePoint(a);
    const lam = String.fromCodePoint(0x0644);
    const isoG = shapeGlyphs(lam + ch)[0];
    const finG = shapeGlyphs(PROBE + lam + ch).pop() as number;
    const std = STD_LAM_ALEF[a];
    const pickLig = (g: number, stdCp: number): number => {
      const found = glyphToCp(g);
      if (found !== undefined) return found;
      if (cmapGlyph(stdCp) === 0) throw new Error(`ligature لا+${ch}: U+${stdCp.toString(16)} در cmap نیست`);
      variantLog.push(`ligature لا+${ch}: glyph ${g} reachable نیست؛ fallback U+${stdCp.toString(16)}`);
      return stdCp;
    };
    lamAlef[String(a)] = { isolated: pickLig(isoG, std[0]), final: pickLig(finG, std[1]) };
  }
  const table = { version: 1, letters, lamAlef, zwnj: ZWNJ, marks: MARKS };
  fs.writeFileSync(TABLE_PATH, JSON.stringify(table, null, 2) + '\n');
  console.log(`✅ جدول فرم‌ها: ${TABLE_PATH} (${ALL_LETTERS.length} حرف, ${ALEF_VARIANTS.length} ligature)`);
  if (variantLog.length) {
    console.log(`ℹ️ ${variantLog.length} variant فونت (glyph با کد standard فرق دارد؛ رندر مشابه):`);
    for (const v of variantLog.slice(0, 12)) console.log('   -', v);
  }

  // --- ۲. تولید fixture با HarfBuzz (دسته‌بندی context بر اساس cluster) ---
  // برای هر glyph: حرف متناظر (از cluster) → پیدا کردن context با مقایسه با glyphهای probe → کد از جدول
  const probeGlyphs: Record<number, { iso: number; fin: number; ini: number; med: number }> = {};
  for (const cp of ALL_LETTERS) {
    const ch = String.fromCodePoint(cp);
    probeGlyphs[cp] = {
      iso: shapeGlyphs(ch)[0],
      fin: shapeGlyphs(PROBE + ch).pop() as number,
      ini: shapeGlyphs(ch + PROBE)[0],
      med: shapeGlyphs(PROBE + ch + PROBE)[1],
    };
  }
  const ligGlyphs: Record<number, { iso: number; fin: number }> = {};
  for (const a of ALEF_VARIANTS) {
    const lam = String.fromCodePoint(0x0644);
    const ch = String.fromCodePoint(a);
    ligGlyphs[a] = {
      iso: shapeGlyphs(lam + ch)[0],
      fin: shapeGlyphs(PROBE + lam + ch).pop() as number,
    };
  }
  const fixtures: Array<{ input: string; expected: number[] }> = [];
  for (const w of FIXTURE_WORDS) {
    const cps = Array.from(w, (c) => c.codePointAt(0) as number);
    const infos = shapeInfos(w);
    const expected: number[] = [];
    let infoIdx = 0;
    let charIdx = 0;
    while (charIdx < cps.length) {
      const cp = cps[charIdx];
      const info = infos[infoIdx];
      // Ligature «لا»؟
      if (cp === 0x0644) {
        const alef = cps[charIdx + 1];
        const lig = alef !== undefined ? ligGlyphs[alef] : undefined;
        if (lig && (info.glyph === lig.iso || info.glyph === lig.fin)) {
          const prevConnects = charIdx > 0 && DUAL_LETTERS.includes(cps[charIdx - 1]);
          expected.push(prevConnects ? table.lamAlef[String(alef)].final : table.lamAlef[String(alef)].isolated);
          charIdx += 2;
          infoIdx += 1;
          continue;
        }
      }
      const pg = probeGlyphs[cp];
      if (pg) {
        const t = letters[String(cp)];
        let ctx: 'isolated' | 'final' | 'initial' | 'medial';
        if (info.glyph === pg.iso) ctx = 'isolated';
        else if (info.glyph === pg.fin) ctx = 'final';
        else if (info.glyph === pg.ini) ctx = 'initial';
        else if (info.glyph === pg.med) ctx = 'medial';
        else throw new Error(`word ${w}: glyph ${info.glyph} برای حرف ${String.fromCodePoint(cp)} در هیچ context probe نیست`);
        expected.push(ctx === 'isolated' ? t.isolated : t[ctx]);
      } else {
        expected.push(cp); // رقم، لاتین، فاصله، ZWNJ و...
      }
      charIdx += 1;
      infoIdx += 1;
    }
    fixtures.push({ input: w, expected });
  }
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixtures, null, 2) + '\n');
  console.log(`✅ fixture shaping: ${FIXTURE_PATH} (${fixtures.length} نمونه)`);
  console.log('   نمونه — سلام:', hex(fixtures[0].expected));

  // --- ۳. اعتبارسنجی شکل‌دهنده runtime در برابر HarfBuzz ---
  const { shapeLogical, stringToCps } = await import('../src/core/text/shape');
  let mismatches = 0;
  for (const fx of fixtures) {
    const got = stringToCps(shapeLogical(fx.input));
    if (hex(got) !== hex(fx.expected)) {
      mismatches++;
      console.log(`   ❌ mismatch ${fx.input}: got ${hex(got)} expected ${hex(fx.expected)}`);
    }
  }
  if (mismatches > 0) {
    console.log(`❌ شکل‌دهنده runtime با HarfBuzz ${mismatches} mismatch دارد`);
    process.exitCode = 1;
  } else {
    console.log(`✅ شکل‌دهنده runtime با ${fixtures.length}/${fixtures.length} نمونه HarfBuzz تطابق کامل دارد`);
  }

  // --- ۴. گواهی نمونه PDF ---
  const { shapeRtl } = await import('../src/core/text/shape');
  const doc = await PDFDocument.create();
  (doc as any).registerFontkit(fontkit);
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const regular = await doc.embedFont(fs.readFileSync(FONT_REGULAR));
  const bold = await doc.embedFont(fs.readFileSync(FONT_BOLD));
  const { width, height } = page.getSize();

  const drawRtl = (
    text: string,
    rightX: number,
    y: number,
    size: number,
    font: any,
    color = rgb(0.1, 0.1, 0.1),
  ): void => {
    const visual = shapeRtl(text);
    const w = font.widthOfTextAtSize(visual, size);
    page.drawText(visual, { x: rightX - w, y, size, font, color });
  };

  // قاب
  page.drawRectangle({ x: 40, y: 40, width: width - 80, height: height - 80, borderColor: rgb(0.2, 0.35, 0.55), borderWidth: 2 });
  page.drawRectangle({ x: 48, y: 48, width: width - 96, height: height - 96, borderColor: rgb(0.2, 0.35, 0.55), borderWidth: 0.75 });

  drawRtl('مؤسسه آموزشی نمونه', width - 70, height - 110, 15, bold, rgb(0.2, 0.35, 0.55));
  drawRtl('گواهی‌نامه پایان دوره', width - 70, height - 165, 26, bold);
  page.drawLine({ start: { x: 150, y: height - 185 }, end: { x: width - 150, y: height - 185 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });

  drawRtl('گواهی می‌شود که:', width - 70, height - 235, 14, regular);
  drawRtl('سارا محمدی', width - 70, height - 275, 20, bold);
  drawRtl('دوره آموزشی «برنامه‌نویسی وب — Front-End» را با موفقیت به پایان رسانده است.', width - 70, height - 315, 13, regular);
  drawRtl('تاریخ صدور: ۱۴۰۳/۰۷/۱۹', width - 70, height - 355, 13, regular);
  drawRtl('شماره گواهی: MC-1403-00123', width - 70, height - 385, 13, regular);

  // QR کد
  const qrPng = await QRCode.toBuffer('https://myclass.example/verify/MC-1403-00123', { margin: 1, width: 120 });
  const qrImg = await doc.embedPng(qrPng);
  page.drawImage(qrImg, { x: 70, y: 90, width: 90, height: 90 });
  drawRtl('myclass.example/verify/MC-1403-00123', 175, 120, 9, regular, rgb(0.35, 0.35, 0.35));

  // امضا
  page.drawLine({ start: { x: width - 250, y: 140 }, end: { x: width - 90, y: 140 }, thickness: 0.75, color: rgb(0.1, 0.1, 0.1) });
  drawRtl('مسئول صدور', width - 90, 122, 12, regular);

  const pdfBytes = await doc.save({ useObjectStreams: false });
  const pdfPath = path.join(OUT_DIR, 'certificate-sample.pdf');
  fs.writeFileSync(pdfPath, pdfBytes);

  // --- ۵. بررسی ساختاری PDF ---
  const pdfBuf = Buffer.from(pdfBytes);
  const reloaded = await PDFDocument.load(pdfBytes);
  const checks: Array<[string, boolean]> = [
    ['تعداد صفحات = 1', reloaded.getPageCount() === 1],
    ['فونت TrueType embed شده (FontFile2)', pdfBuf.includes('FontFile2')],
    ['نام فونت Vazirmatn در PDF', pdfBuf.includes('Vazirmatn')],
  ];
  // تمام streamها را inflate می‌کنیم: یکی محتوا (دارای Tj/TJ) و یکی فونت subset (TTF)
  const text = pdfBuf.toString('latin1');
  let contentHasTextOps = false;
  const fontStreams: Buffer[] = [];
  let pos = 0;
  while (true) {
    const idx = text.indexOf('stream', pos);
    if (idx === -1) break;
    const end = text.indexOf('endstream', idx);
    if (end === -1) break;
    pos = end + 9;
    let start = idx + 6;
    // رد کردن EOL بعد از «stream»
    if (pdfBuf[start] === 0x0d && pdfBuf[start + 1] === 0x0a) start += 2;
    else if (pdfBuf[start] === 0x0a || pdfBuf[start] === 0x0d) start += 1;
    let stop = end;
    if (pdfBuf[stop - 2] === 0x0d && pdfBuf[stop - 1] === 0x0a) stop -= 2;
    else if (pdfBuf[stop - 1] === 0x0a || pdfBuf[stop - 1] === 0x0d) stop -= 1;
    const raw = pdfBuf.subarray(start, stop);
    let data: Buffer;
    try {
      data = zlib.inflateSync(raw);
    } catch {
      continue; // stream بدون فشرده‌سازی — رد شو
    }
    // stream فونت (TTF) یا محتوا؟
    const head = data.subarray(0, 4).toString('latin1');
    if (head === 'true' || head === 'OTTO' || (data[0] === 0x00 && data[1] === 0x01 && data[2] === 0x00 && data[3] === 0x00)) {
      fontStreams.push(data);
    } else {
      const s = data.toString('latin1');
      if (/(Tj|TJ)\b/.test(s) && /<[0-9A-Fa-f]+>/.test(s)) contentHasTextOps = true;
    }
  }
  checks.push(['content stream دارای text-showing (Tj/TJ + hex)', contentHasTextOps]);
  checks.push([`فونت embed شده قابل شناسایی (${fontStreams.length} stream فونت)`, fontStreams.length >= 1]);
  // بررسی cmap فونت embed شده: presentation forms کلیدی باید glyph داشته باشند
  if (fontStreams.length >= 1) {
    const embedded: any = fontkit.create(fontStreams[0]);
    const mustHave = [
      ['SEEN initial FEB3', 0xfeb3],
      ['LAM-ALEF final FEFC', 0xfefc],
      ['MEEM initial FEDF', 0xfedf],
      ['FARSI YEH medial FBFF', 0xfbff],
      ['PERSIAN DIGIT 4 (06F4)', 0x06f4],
      ['LATIN M (004D)', 0x004d],
    ];
    for (const [name, cp] of mustHave) {
      const g = embedded.glyphForCodePoint(cp);
      checks.push([`فونت embed: ${name} glyph دارد`, !!g && g.id !== 0]);
    }
  }

  console.log(`\n📄 PDF نمونه: ${pdfPath} (${(pdfBytes.length / 1024).toFixed(1)} KB)`);
  for (const [name, ok] of checks) console.log(`   ${ok ? '✅' : '❌'} ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('❌ خطای spike:', err);
  process.exit(1);
});
