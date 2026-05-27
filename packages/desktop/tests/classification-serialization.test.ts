import { describe, expect, it } from 'vitest';
import {
  classificationMapToRecord,
  type BookmarkClassificationRecord,
} from '../src/main/classification-serialization.js';

describe('bookmark classification serialization', () => {
  it('serializes Map results into IPC-safe plain objects', () => {
    const classifications = new Map([
      [
        'https://example.com',
        {
          category: '开发/文档',
          tags: ['docs'],
          confidence: 0.82,
          aiClassified: true,
        },
      ],
    ]);

    const record: BookmarkClassificationRecord = classificationMapToRecord(classifications);

    expect(record).toEqual({
      'https://example.com': {
        category: '开发/文档',
        tags: ['docs'],
        confidence: 0.82,
        aiClassified: true,
      },
    });
    expect(record).not.toBeInstanceOf(Map);
  });
});
