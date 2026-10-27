export type Rect = { x: number; y: number; width: number; height: number };
export type MarkColor = 'yellow' | 'green' | 'pink';
export type Language = 'zh' | 'en' | 'both';
export type Segment = { id: string; page: number | null; source: string; zh: string; keep: boolean; reason?: string; hasFormula?: boolean };
export type Bundle = { cover?: import('./cover').Cover; format: 'yuejian-babeldoc-v1'; pdfSha256: string; sourceSha256: string; title: string; titleEn: string; author: string; engine: string; pageCount: number; segments: Segment[]; glossary: Record<string, string>; review: string; note: string };
export type Annotation = { id: string; page: number; quote: string; text: string; rects: Rect[]; color: MarkColor; created: number; updated: number; language: Language; segmentId?: string };
export type Book = { id: string; format?: 'pdf' | 'txt'; contentHash?: string; privateOwner?: string; title: string; author: string; fileName: string; size: number; pages: number; page: number; added: number; opened: number; starred: boolean; bookmarks: number[]; annotations: Annotation[]; cover: string; blob: Blob; sample?: boolean; source?: string; bilingual: boolean; bundle?: Bundle };
export type SelectionData = { quote: string; rects: Rect[]; page: number; language: Language; segmentId?: string };
