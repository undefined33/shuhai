import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
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

function wrapContentScripts(): PluginOption {
  return {
    name: 'wrap-content-scripts',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.fileName.startsWith('content/')) {
          continue;
        }

        chunk.code = `(() => {\n${chunk.code}\n})();\n`;
      }
    },
  };
}

function duplicateContentDiagnostics(): PluginOption {
  const diagnosticsPath = resolve(__dirname, 'src/utils/extractor-diagnostics.ts');
  const normalizedDiagnosticsPath = diagnosticsPath.replace(/\\/g, '/');

  return {
    name: 'duplicate-content-diagnostics',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.includes('extractor-diagnostics')) {
        return undefined;
      }

      const normalizedImporter = importer.replace(/\\/g, '/');
      if (!normalizedImporter.includes('/src/content/')) {
        return undefined;
      }

      return `${normalizedDiagnosticsPath}?content=${basename(normalizedImporter)}`;
    },
    load(id) {
      if (!id.startsWith(`${normalizedDiagnosticsPath}?content=`)) {
        return undefined;
      }

      return readFileSync(diagnosticsPath, 'utf8');
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src'),
  plugins: [
    react(),
    tailwindcss(),
    copyExtensionManifest(),
    duplicateContentDiagnostics(),
    wrapContentScripts(),
  ],
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
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content/article': resolve(__dirname, 'src/content/article.ts'),
        'content/toast': resolve(__dirname, 'src/content/toast.ts'),
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
