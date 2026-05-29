type ToastKind = 'success' | 'error' | 'info';

interface ToastMessage {
  type: 'toast:show';
  message: string;
  kind?: ToastKind;
}

interface ToastWindow extends Window {
  __shuhaiToastReady?: boolean;
}

const HOST_ID = 'shuhai-toast-host';

function toastColors(kind: ToastKind): { border: string; accent: string } {
  if (kind === 'error') {
    return { border: '#7f1d1d', accent: '#f87171' };
  }

  if (kind === 'info') {
    return { border: '#334155', accent: '#93c5fd' };
  }

  return { border: '#065f46', accent: '#34d399' };
}

export function ensureToastRoot(doc: Document = document): ShadowRoot {
  const existing = doc.getElementById(HOST_ID);
  if (existing?.shadowRoot) {
    return existing.shadowRoot;
  }

  const host = existing ?? doc.createElement('div');
  host.id = HOST_ID;
  if (!existing) {
    doc.documentElement.append(host);
  }

  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `
    .toast {
      position: fixed;
      right: 16px;
      top: 16px;
      z-index: 2147483647;
      max-width: min(360px, calc(100vw - 32px));
      padding: 12px 14px;
      border: 1px solid var(--shuhai-border);
      border-left: 4px solid var(--shuhai-accent);
      border-radius: 10px;
      background: #020617;
      color: #f8fafc;
      box-shadow: 0 18px 48px rgba(0,0,0,.35);
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: opacity .2s ease, transform .2s ease;
    }
    .toast[data-leaving="true"] {
      opacity: 0;
      transform: translateY(-6px);
    }
  `;
  root.append(style);
  return root;
}

export function showToast(message: string, kind: ToastKind = 'success'): void {
  const root = ensureToastRoot();
  const colors = toastColors(kind);
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.setProperty('--shuhai-border', colors.border);
  toast.style.setProperty('--shuhai-accent', colors.accent);
  root.append(toast);

  window.setTimeout(() => {
    toast.dataset.leaving = 'true';
    window.setTimeout(() => toast.remove(), 220);
  }, 3000);
}

function isToastMessage(message: unknown): message is ToastMessage {
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    (message as ToastMessage).type === 'toast:show' &&
    typeof (message as ToastMessage).message === 'string'
  );
}

const toastWindow = window as ToastWindow;
if (!toastWindow.__shuhaiToastReady) {
  toastWindow.__shuhaiToastReady = true;
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (isToastMessage(message)) {
      showToast(message.message, message.kind ?? 'success');
    }
  });
}
