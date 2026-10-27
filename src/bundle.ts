import { validateCover } from './cover';
import type { Bundle } from './types';

export function validateBundle(value: unknown): Bundle {
  const b = value as Bundle;
  if (!b || b.format !== 'yuejian-babeldoc-v1' || !/^[a-f0-9]{64}$/.test(b.pdfSha256) || typeof b.title !== 'string' || typeof b.author !== 'string' || !Number.isInteger(b.pageCount) || !Array.isArray(b.segments) || !b.glossary || typeof b.glossary !== 'object' || Object.values(b.glossary).some(x=>typeof x !== 'string')) throw new Error('这不是有效的Margina阅读包');
  for (const s of b.segments) if (typeof s.id !== 'string' || typeof s.source !== 'string' || typeof s.zh !== 'string' || (s.page !== null && (!Number.isInteger(s.page) || s.page < 1 || s.page > b.pageCount))) throw new Error('段落数据不完整或页码超出范围');
  if (b.cover !== undefined) { validateCover(b.cover, b.pdfSha256); if (b.cover.crop !== 'zh') throw new Error('双语阅读包封面须为中文首页'); }
  return b;
}
