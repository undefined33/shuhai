import type { BookmarkClassification } from './bookmark-service.js';

export type BookmarkClassificationRecord = Record<string, BookmarkClassification>;

export function classificationMapToRecord(
  classifications: Map<string, BookmarkClassification>,
): BookmarkClassificationRecord {
  return Object.fromEntries(classifications);
}
