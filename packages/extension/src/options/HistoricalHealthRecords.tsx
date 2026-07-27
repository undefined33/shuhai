import { Copy, ExternalLink, Trash2 } from 'lucide-react';
import type { UrlHealthRecord } from '../shared/bookmark-types.js';
import { Button } from '../components/ui/button.js';

const MAX_VISIBLE_RECORDS = 200;
const MAX_URL_LENGTH = 8_192;

export function isSafeHistoricalHealthUrl(value: string): boolean {
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    value.length === 0 ||
    value.length > MAX_URL_LENGTH ||
    value !== value.trim() ||
    value.includes('\\') ||
    hasControlCharacter
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

export function openHistoricalHealthUrl(value: string): Promise<boolean> {
  if (!isSafeHistoricalHealthUrl(value)) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    if (!chrome.tabs?.create) {
      resolve(false);
      return;
    }
    try {
      chrome.tabs.create({ active: false, url: value }, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

export async function copyHistoricalHealthUrl(value: string): Promise<boolean> {
  if (!isSafeHistoricalHealthUrl(value) || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

interface HistoricalHealthRecordsProps {
  busy: boolean;
  records: UrlHealthRecord[];
  onClear(): void;
  onNotice(message: string): void;
}

function statusLabel(record: UrlHealthRecord): string {
  if (record.status === 'dead') return '历史死链';
  if (record.status === 'redirected') return '历史重定向';
  if (record.status === 'error') return '历史检查失败';
  if (record.status === 'skipped') return '历史跳过';
  return '历史存活';
}

export default function HistoricalHealthRecords({
  busy,
  records,
  onClear,
  onNotice,
}: HistoricalHealthRecordsProps) {
  const visible = records.slice(0, MAX_VISIBLE_RECORDS);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          仅供人工核实，不会据此修改或删除 Chrome 书签。共 {records.length} 条。
        </p>
        <Button disabled={busy || records.length === 0} onClick={onClear} variant="outline">
          <Trash2 className="h-4 w-4" />
          清空本地历史
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="m-0 py-4 text-sm text-muted-foreground">没有保留旧链接记录。</p>
      ) : (
        <ul className="m-0 divide-y divide-border border-y border-border p-0">
          {visible.map((record, index) => (
            <li
              className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
              key={`${record.bookmarkId}:${record.checkedAt}:${index}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <strong className="break-words text-sm">
                    {record.bookmarkTitle || '无标题书签'}
                  </strong>
                  <span className="text-[13px] text-muted-foreground">{statusLabel(record)}</span>
                </div>
                <p className="m-0 mt-1 break-all text-[13px] text-muted-foreground">
                  {record.bookmarkUrl}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Button
                  aria-label="在后台标签页打开原 URL"
                  onClick={() =>
                    void openHistoricalHealthUrl(record.bookmarkUrl).then((opened) =>
                      onNotice(
                        opened ? '已在后台标签页打开。' : '该历史 URL 未通过安全校验或无法打开。',
                      ),
                    )
                  }
                  size="icon"
                  title="在后台标签页打开"
                  variant="outline"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <Button
                  aria-label="复制原 URL"
                  onClick={() =>
                    void copyHistoricalHealthUrl(record.bookmarkUrl).then((copied) =>
                      onNotice(copied ? '已复制原 URL。' : '无法复制该历史 URL。'),
                    )
                  }
                  size="icon"
                  title="复制原 URL"
                  variant="outline"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {records.length > MAX_VISIBLE_RECORDS ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          为保持页面流畅，本页只显示最近 {MAX_VISIBLE_RECORDS} 条。
        </p>
      ) : null}
    </div>
  );
}
