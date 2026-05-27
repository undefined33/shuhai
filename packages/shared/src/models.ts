import type { ContentType, Author, Engagement } from './types.js';

/**
 * Media attachment (images, videos, etc.)
 */
export interface MediaAttachment {
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  thumbnail?: string;
  alt?: string;
  duration?: number;
  localPath?: string;
}

/**
 * Unified raw bookmark from any source
 */
export interface RawBookmark {
  url: string;
  title: string;
  source: string;
  contentType: ContentType;
  createdAt: Date;
  tags?: string[];
  categories?: string[];
  author?: Author;
  engagement?: Engagement;
  media?: MediaAttachment[];
  content?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Processed bookmark with AI enrichment
 */
export interface ProcessedBookmark extends RawBookmark {
  id: string;
  normalizedUrl: string;
  category: string;
  aiTags?: string[];
  summary?: string;
  status: UrlStatus;
  resolvedUrl?: string;
  confidence?: number;
  exportedAt?: Date;
  reviewedAt?: Date;
}

export type UrlStatus = 'alive' | 'dead' | 'redirect' | 'unchecked' | 'error';
