import type { Bundle } from './types';

export function validateBundle(value: unknown): Bundle {
  const b = value as Bundle;
  if (!b || b.format !== 'yuejian-babeldoc-v1' || !/^[a-f0-9]{64}$/.test(b.pdfSha256) || typeof b.title !== 'string' || typeof b.author !== 'string' || !Number.isInteger(b.pageCount) || !Array.isArray(b.segments) || !b.glossary || typeof b.glossary !== 'object' || Object.values(b.glossary).some(x=>typeof x !== 'string')) throw new Error('这不是有效的Margina阅读包');
  for (const s of b.segments) if (typeof s.id !== 'string' || typeof s.source !== 'string' || typeof s.zh !== 'string' || (s.page !== null && (!Number.isInteger(s.page) || s.page < 1 || s.page > b.pageCount))) throw new Error('段落数据不完整或页码超出范围');
  return b;
}
