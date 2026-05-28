import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type PluginOption } from 'vite';

function copyExtensionManifest(): PluginOption {
  const root = resolve(__dirname);
  const dist = resolve(root, 'dist');

  return {
    name: 'copy-extension-manifest',
    buildStart() {
      rmSync(dist, { recursive: true, force: true });
    },
    closeBundle() {
      const output = resolve(dist, 'manifest.json');
      mkdirSync(dirname(output), { recursive: true });
      copyFileSync(resolve(root, 'manifest.json'), output);
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src'),
  plugins: [react(), tailwindcss(), copyExtensionManifest()],
  resolve: {
    alias: {
      '@shuhai/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  build: {
    emptyOutDir: false,
    outDir: resolve(__dirname, 'dist'),
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        'background/service-worker': resolve(
          __dirname,
          'src/background/service-worker.ts',
        ),
        'content/twitter': resolve(__dirname, 'src/content/twitter.ts'),
        'content/weibo': resolve(__dirname, 'src/content/weibo.ts'),
      },
      output: {
        assetFileNames: 'assets/[name].[ext]',
        chunkFileNames: 'assets/[name].js',
        entryFileNames: '[name].js',
      },
    },
  },
});
