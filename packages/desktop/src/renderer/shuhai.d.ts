import type { ShuHaiAPI } from '../preload.js';

declare global {
  interface Window {
    shuhai: ShuHaiAPI;
  }
}

export {};
