export type ErrorCode =
  | 'AI_KEY_INVALID'
  | 'AI_KEY_MISSING'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_NETWORK_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_RESPONSE_INVALID'
  | 'VAULT_PERMISSION_DENIED'
  | 'VAULT_NOT_CONFIGURED'
  | 'VAULT_WRITE_FAILED'
  | 'EXTRACT_EMPTY'
  | 'EXTRACT_NOT_DETAIL_PAGE'
  | 'EXTRACT_DOM_CHANGED'
  | 'HEALTH_NETWORK_ERROR'
  | 'HEALTH_ABORTED'
  | 'UNKNOWN';

export type RecoveryActionHandler = 'retry' | 'openSettings' | 'selectVault' | 'checkNetwork';

export interface StructuredError {
  code: ErrorCode;
  message: string;
  suggestion: string;
  details?: string;
  action?: {
    label: string;
    handler: RecoveryActionHandler;
  };
}

const ERROR_MAP: Record<ErrorCode, Omit<StructuredError, 'code' | 'details'>> = {
  AI_KEY_INVALID: {
    message: 'API Key 无效或已过期',
    suggestion: '请检查 AI 设置中的 Key 是否正确，保存后再重试。',
    action: { label: '打开设置', handler: 'openSettings' },
  },
  AI_KEY_MISSING: {
    message: '未配置 AI 服务',
    suggestion: '请先在设置中添加并启用一个 AI Provider，或暂时关闭 AI 使用规则分类。',
    action: { label: '打开设置', handler: 'openSettings' },
  },
  AI_QUOTA_EXCEEDED: {
    message: 'AI 调用额度已用完',
    suggestion: '请检查 Provider 账户余额，或稍后再试。',
    action: { label: '重试', handler: 'retry' },
  },
  AI_NETWORK_ERROR: {
    message: 'AI 网络连接失败',
    suggestion: '请检查网络后重试；如果只是想先整理，可以关闭 AI 使用规则分类。',
    action: { label: '重试', handler: 'retry' },
  },
  AI_TIMEOUT: {
    message: 'AI 响应超时',
    suggestion: '可能是网络不稳定或模型响应慢，请稍后重试。',
    action: { label: '重试', handler: 'retry' },
  },
  AI_RESPONSE_INVALID: {
    message: 'AI 返回内容无法解析',
    suggestion: '当前模型可能不兼容，请尝试切换模型或 Provider。',
    action: { label: '打开设置', handler: 'openSettings' },
  },
  VAULT_PERMISSION_DENIED: {
    message: 'Vault 目录访问权限已失效',
    suggestion: '请重新选择 Obsidian Vault 目录。',
    action: { label: '选择目录', handler: 'selectVault' },
  },
  VAULT_NOT_CONFIGURED: {
    message: '未选择 Obsidian Vault 目录',
    suggestion: '请先在设置中选择 Vault 目录，再写入内容。',
    action: { label: '打开设置', handler: 'openSettings' },
  },
  VAULT_WRITE_FAILED: {
    message: '写入文件失败',
    suggestion: 'Vault 目录可能被移动、删除或权限变化，请重新选择后再试。',
    action: { label: '选择目录', handler: 'selectVault' },
  },
  EXTRACT_EMPTY: {
    message: '未检测到可保存内容',
    suggestion: '页面结构可能已更新，或当前页面没有正文内容。',
  },
  EXTRACT_NOT_DETAIL_PAGE: {
    message: '请先打开详情页',
    suggestion: '点击推文或微博进入详情页后，再使用保存动作。',
  },
  EXTRACT_DOM_CHANGED: {
    message: '页面结构可能已更新',
    suggestion: 'ShuHai 没能识别当前页面，请稍后更新规则或反馈提取失败。',
  },
  HEALTH_NETWORK_ERROR: {
    message: '链接检查失败',
    suggestion: '这不一定是死链，可能只是网络波动、目标站限速或临时不可达。',
    action: { label: '重试', handler: 'retry' },
  },
  HEALTH_ABORTED: {
    message: '检查被中断',
    suggestion: '可能是暂停操作或网络波动导致。已完成的结果会保留，可以继续检查。',
    action: { label: '重试', handler: 'retry' },
  },
  UNKNOWN: {
    message: '操作失败',
    suggestion: '请稍后重试；如果反复出现，可以保留当前页面状态用于排查。',
  },
};

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? '');
}

export function inferErrorCode(error: unknown): ErrorCode {
  const text = errorText(error).toLowerCase();

  if (text.includes('no provider') || text.includes('未配置 ai') || text.includes('api key')) {
    if (
      text.includes('invalid') ||
      text.includes('401') ||
      text.includes('403') ||
      text.includes('无效')
    ) {
      return 'AI_KEY_INVALID';
    }
    if (text.includes('missing') || text.includes('未配置') || text.includes('请先填写')) {
      return 'AI_KEY_MISSING';
    }
  }

  if (text.includes('401') || text.includes('403')) {
    return 'AI_KEY_INVALID';
  }

  if (text.includes('429') || text.includes('quota') || text.includes('额度')) {
    return 'AI_QUOTA_EXCEEDED';
  }

  if (text.includes('timeout') || text.includes('timed out') || text.includes('超时')) {
    return text.includes('health') || text.includes('检查') ? 'HEALTH_ABORTED' : 'AI_TIMEOUT';
  }

  if (text.includes('json') || text.includes('parse') || text.includes('无法解析')) {
    return 'AI_RESPONSE_INVALID';
  }

  if (text.includes('vault') || text.includes('obsidian') || text.includes('目录')) {
    if (text.includes('permission') || text.includes('权限') || text.includes('denied')) {
      return 'VAULT_PERMISSION_DENIED';
    }
    if (text.includes('先选择') || text.includes('未选择')) {
      return 'VAULT_NOT_CONFIGURED';
    }
    return 'VAULT_WRITE_FAILED';
  }

  if (text.includes('详情页')) {
    return 'EXTRACT_NOT_DETAIL_PAGE';
  }

  if (text.includes('提取失败') || text.includes('页面结构')) {
    return 'EXTRACT_DOM_CHANGED';
  }

  if (text.includes('empty') || text.includes('正文')) {
    return 'EXTRACT_EMPTY';
  }

  if (text.includes('signal') || text.includes('aborted') || text.includes('abort')) {
    return 'HEALTH_ABORTED';
  }

  if (text.includes('failed to fetch') || text.includes('network') || text.includes('fetch')) {
    return 'AI_NETWORK_ERROR';
  }

  return 'UNKNOWN';
}

export function toStructuredError(
  error: unknown,
  explicitCode?: ErrorCode | string,
): StructuredError {
  const code = isErrorCode(explicitCode) ? explicitCode : inferErrorCode(error);
  const mapped = ERROR_MAP[code];
  const details = errorText(error);

  return {
    code,
    ...mapped,
    details: details && details !== mapped.message ? details : undefined,
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_MAP;
}

export function friendlyHealthError(error: string | undefined): string {
  if (!error) {
    return '';
  }

  const inferred = inferErrorCode(error);
  const code =
    inferred === 'HEALTH_ABORTED'
      ? 'HEALTH_ABORTED'
      : inferred === 'UNKNOWN' || inferred === 'AI_NETWORK_ERROR'
        ? 'HEALTH_NETWORK_ERROR'
        : inferred;

  return toStructuredError(error, code).message;
}
