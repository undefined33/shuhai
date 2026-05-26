/**
 * Content types across all platforms
 */
export type ContentType =
  | 'article'
  | 'short-post'
  | 'image'
  | 'video'
  | 'thread'
  | 'comment'
  | 'repo';

/**
 * Platform capability declaration
 */
export interface PlatformCapabilities {
  supportsCategories: boolean;
  supportsTags: boolean;
  supportsMediaDownload: boolean;
  supportsFullContent: boolean;
  contentTypes: ContentType[];
}

/**
 * Author information
 */
export interface Author {
  name: string;
  handle: string;
  url?: string;
  avatar?: string;
}

/**
 * Engagement metrics for sorting/filtering
 */
export interface Engagement {
  likes?: number;
  shares?: number;
  comments?: number;
  views?: number;
}
