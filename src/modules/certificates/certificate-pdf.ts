/**
 * Certificate PDF renderer — pdf-lib + Vazirmatn (embedded) + bidi shaping + QR.
 * Pipeline verified by scripts/spike-pdf.ts (shape fixtures vs HarfBuzz + sample PDF).
 * (REQ-P5-02)
 */
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb, PDFFont } from 'pdf-lib';
import * as fontkit from 'fontkit';
import QRCode from 'qrcode';
import { shapeRtl } from '../../core/text/shape';

const ROOT = path.join(__dirname, '..', '..', '..');
const FONT_REGULAR = path.join(ROOT, 'public', 'fonts', 'Vazirmatn-Regular.ttf');
const FONT_BOLD = path.join(ROOT, 'public', 'fonts', 'Vazirmatn-Bold.ttf');

export interface CertificateDesign {
  title?: string;
  subtitle?: string;
  primaryColor?: string; // #rrggbb
  showQr?: boolean;
  fontScale?: number; // 0.8 .. 1.5
}

export interface CertificatePdfInput {
  instituteName: string;
  headerNote?: string | null;
  studentName: string;
  classTitle: string;
  code: string;
  issuedAtJalaali: string; // e.g. 1405/07/19
  verifyUrl: string;
  design?: CertificateDesign;
  revoked?: boolean;
  revokeReason?: string | null;
}

let cachedFonts: { regular: PDFFont; bold: PDFFont } | null = null;

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return rgb(0.2, 0.35, 0.55);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/** Render one certificate page → PDF bytes. */
export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  (doc as unknown as { registerFontkit: (fk: unknown) => void }).registerFontkit(fontkit);
  if (!cachedFonts) {
    cachedFonts = {
      regular: await doc.embedFont(fs.readFileSync(FONT_REGULAR)),
      bold: await doc.embedFont(fs.readFileSync(FONT_BOLD)),
    };
  }
  const { regular, bold } = cachedFonts;
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();
  const scale = Math.min(1.5, Math.max(0.8, input.design?.fontScale ?? 1));
  const primary = hexToRgb(input.design?.primaryColor ?? '#1d4ed8');
  const showQr = input.design?.showQr !== false;

  const drawRtl = (
    text: string,
    rightX: number,
    y: number,
    size: number,
    font: PDFFont,
    color = rgb(0.1, 0.1, 0.1),
  ): void => {
    const visual = shapeRtl(text);
    const w = font.widthOfTextAtSize(visual, size);
    page.drawText(visual, { x: rightX - w, y, size, font, color });
  };

  // Frame
  page.drawRectangle({ x: 40, y: 40, width: width - 80, height: height - 80, borderColor: primary, borderWidth: 2 });
  page.drawRectangle({ x: 48, y: 48, width: width - 96, height: height - 96, borderColor: primary, borderWidth: 0.75 });

  // Header
  drawRtl(input.instituteName, width - 70, height - 110, 15 * scale, bold, primary);
  if (input.headerNote) drawRtl(input.headerNote, width - 70, height - 132, 10 * scale, regular, rgb(0.35, 0.35, 0.35));
  drawRtl(input.design?.title ?? 'گواهی‌نامه پایان دوره', width - 70, height - 175, 26 * scale, bold);
  if (input.design?.subtitle) drawRtl(input.design.subtitle, width - 70, height - 205, 12 * scale, regular, rgb(0.35, 0.35, 0.35));
  page.drawLine({ start: { x: 150, y: height - 195 }, end: { x: width - 150, y: height - 195 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });

  // Body
  drawRtl('گواهی می‌شود که:', width - 70, height - 245, 14 * scale, regular);
  drawRtl(input.studentName, width - 70, height - 285, 20 * scale, bold);
  drawRtl(`دوره آموزشی «${input.classTitle}» را با موفقیت به پایان رسانده است.`, width - 70, height - 325, 13 * scale, regular);
  drawRtl(`تاریخ صدور: ${input.issuedAtJalaali}`, width - 70, height - 365, 13 * scale, regular);
  drawRtl(`شماره گواهی: ${input.code}`, width - 70, height - 395, 13 * scale, regular);

  // QR (public verification link)
  if (showQr) {
    const qrPng = await QRCode.toBuffer(input.verifyUrl, { margin: 1, width: 120 });
    const qrImg = await doc.embedPng(qrPng);
    page.drawImage(qrImg, { x: 70, y: 90, width: 90, height: 90 });
    drawRtl(input.verifyUrl.replace(/^https?:\/\//, ''), 175, 120, 9, regular, rgb(0.35, 0.35, 0.35));
  }

  // Signature
  page.drawLine({ start: { x: width - 250, y: 140 }, end: { x: width - 90, y: 140 }, thickness: 0.75, color: rgb(0.1, 0.1, 0.1) });
  drawRtl('مسئول صدور', width - 90, 122, 12, regular);

  // Revoked watermark (regenerated file — code unchanged)
  if (input.revoked) {
    const stamp = 'لغو شده';
    const size = 42;
    const w = bold.widthOfTextAtSize(shapeRtl(stamp), size);
    page.drawText(shapeRtl(stamp), { x: (width - w) / 2, y: height / 2 - 60, size, font: bold, color: rgb(0.75, 0.1, 0.1), opacity: 0.35 });
    page.drawRectangle({ x: 60, y: height / 2 - 40, width: width - 120, height: 70, borderColor: rgb(0.75, 0.1, 0.1), borderWidth: 1.5 });
    if (input.revokeReason) drawRtl(input.revokeReason, width - 80, height / 2 - 25, 10, regular, rgb(0.75, 0.1, 0.1));
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}
