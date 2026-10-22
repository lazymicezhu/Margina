// Bound the bitmap allocation, rather than capping every phone at 2x density.
// 12 million RGBA pixels use about 48 MB, excluding PDF.js working memory.
export const MAX_PDF_PIXELS = 12_000_000;
export const MAX_PDF_SIDE = 8192;

export function pdfBitmapSize(width: number, height: number, density: number) {
  const ratio = Math.min(
    Math.max(1, density),
    Math.sqrt(MAX_PDF_PIXELS / (width * height)),
    MAX_PDF_SIDE / width,
    MAX_PDF_SIDE / height,
  );
  const pixelWidth = Math.max(1, Math.floor(width * ratio));
  const pixelHeight = Math.max(1, Math.floor(height * ratio));
  return { width: pixelWidth, height: pixelHeight, scaleX: pixelWidth / width, scaleY: pixelHeight / height };
}
