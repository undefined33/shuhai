import type { UrlStatus } from '@shuhai/shared';

interface StatusBadgeProps {
  status: UrlStatus;
}

const STATUS_LABELS: Record<UrlStatus, string> = {
  alive: '有效',
  dead: '失效',
  redirect: '重定向',
  unchecked: '未检测',
  error: '错误',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge ${status}`}>{STATUS_LABELS[status]}</span>;
}
