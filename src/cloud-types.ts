import type { Annotation } from './types';
export type Account = { id: string; email: string; admin: boolean; local: boolean };
export type Session = { user: Account | null; local: boolean; loginAvailable: boolean };
export type Paper = { id: string; format?: 'pdf' | 'txt'; contentHash?: string; visibility?: 'public' | 'private'; privateOwner?: string; title: string; author: string; fileName: string; size: number; pages: number; bilingual: boolean; hasBundle: boolean; created: number; updated: number; removed: boolean };
export type ReadingData = { shelf: boolean; starred: boolean; page: number; opened: number; bookmarks: number[]; annotations: Annotation[] };
export type RemoteRecord = { bookId: string; version: number; seq: number; data: ReadingData };
export type LocalRecord = { version: number; base: ReadingData; data: ReadingData; dirty: boolean };
export type AccountState = { cursor: number; records: Record<string, LocalRecord>; lastSynced: number };
export const emptyReading = (): ReadingData => ({ shelf: false, starred: false, page: 1, opened: 0, bookmarks: [], annotations: [] });
