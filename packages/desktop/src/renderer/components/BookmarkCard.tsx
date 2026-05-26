import type { ProcessedBookmark } from '@shuhai/shared';
import { StatusBadge } from './StatusBadge.js';

interface BookmarkCardProps {
  bookmark: ProcessedBookmark;
}

export function BookmarkCard({ bookmark }: BookmarkCardProps) {
  const createdAt = new Date(bookmark.createdAt).toLocaleDateString('zh-CN');
  const tags = [...(bookmark.aiTags ?? []), ...(bookmark.tags ?? [])];

  return (
    <article className="bookmark-card">
      <div className="bookmark-main">
        <div className="bookmark-title-row">
          <h2>{bookmark.title || bookmark.url}</h2>
          <StatusBadge status={bookmark.status} />
        </div>
        <a href={bookmark.url} title={bookmark.url}>
          {bookmark.url}
        </a>
        <div className="bookmark-meta">
          <span>{bookmark.category}</span>
          <span>{createdAt}</span>
          {bookmark.confidence !== undefined && (
            <span>置信度 {(bookmark.confidence * 100).toFixed(0)}%</span>
          )}
        </div>
      </div>
      {tags.length > 0 && (
        <div className="tag-row">
          {tags.slice(0, 6).map((tag) => (
            <span key={`${bookmark.id}-${tag}`} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
