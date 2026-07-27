import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Script } from 'node:vm';
import { build, defineConfig, type PluginOption } from 'vite';

const CONTENT_SCRIPT_ENTRIES = {
  article: 'src/content/article.ts',
  toast: 'src/content/toast.ts',
  twitter: 'src/content/twitter.ts',
  weibo: 'src/content/weibo.ts',
  'x-bookmarks': 'src/content/x-bookmarks.ts',
} as const;

const VIRTUAL_CONTENT_ENTRY = 'virtual:shuhai-content-entry';
const RESOLVED_VIRTUAL_CONTENT_ENTRY = `\0${VIRTUAL_CONTENT_ENTRY}`;

export function assertClassicContentScript(code: string, fileName: string): void {
  if (code.trim().length === 0) {
    throw new Error(`Content script ${fileName} is empty`);
  }

  new Script(code, { filename: fileName });
}

export function finalizeClassicContentScript(code: string, fileName: string): string {
  assertClassicContentScript(code, fileName);
  const wrapped = `(() => {\n${code}\n})();\n`;
  assertClassicContentScript(wrapped, fileName);
  return wrapped;
}

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

function contentEntryPlugin(entryPath: string): PluginOption {
  return {
    name: 'resolve-content-entry',
    resolveId(source) {
      if (source === VIRTUAL_CONTENT_ENTRY) {
        return RESOLVED_VIRTUAL_CONTENT_ENTRY;
      }

      return undefined;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_CONTENT_ENTRY) {
        return `import ${JSON.stringify(entryPath)};`;
      }

      return undefined;
    },
  };
}

function buildClassicContentScripts(): PluginOption {
  const root = resolve(__dirname);
  const dist = resolve(root, 'dist');

  return {
    name: 'build-classic-content-scripts',
    apply: 'build',
    buildStart() {
      this.addWatchFile(resolve(root, 'src'));
      this.addWatchFile(resolve(root, '../shared/src'));
    },
    async writeBundle() {
      for (const [name, source] of Object.entries(CONTENT_SCRIPT_ENTRIES)) {
        const output = resolve(dist, 'content', `${name}.js`);

        await build({
          configFile: false,
          logLevel: 'silent',
          root,
          plugins: [contentEntryPlugin(resolve(root, source))],
          resolve: {
            alias: {
              '@shuhai/shared': resolve(__dirname, '../shared/src/index.ts'),
            },
          },
          build: {
            emptyOutDir: false,
            minify: true,
            outDir: dist,
            rollupOptions: {
              input: VIRTUAL_CONTENT_ENTRY,
              output: {
                entryFileNames: `content/${name}.js`,
                format: 'iife',
                inlineDynamicImports: true,
              },
            },
          },
        });

        const bundledCode = readFileSync(output, 'utf8');
        writeFileSync(output, finalizeClassicContentScript(bundledCode, output));
      }
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src'),
  plugins: [react(), tailwindcss(), copyExtensionManifest(), buildClassicContentScripts()],
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
        options: resolve(__dirname, 'src/options/index.html'),
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        assetFileNames: 'assets/[name].[ext]',
        chunkFileNames: 'assets/[name].js',
        entryFileNames: '[name].js',
      },
    },
  },
});
