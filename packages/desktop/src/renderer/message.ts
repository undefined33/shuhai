export const MESSAGE_AUTO_DISMISS_MS = 3_000;

export type UserMessageType = 'success' | 'error' | 'info' | 'warning';

export interface UserMessage {
  text: string;
  type: UserMessageType;
}

export function messageClassName(message: UserMessage): string {
  return `notice ${message.type}`;
}

export function errorMessage(reason: unknown, fallback: string): UserMessage {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return {
    type: 'error',
    text: detail.trim().length > 0 ? `${fallback}：${detail}` : fallback,
  };
}

export function userMessage(type: UserMessageType, text: string): UserMessage {
  return { type, text };
}
