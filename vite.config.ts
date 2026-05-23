import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const defaultScratchWasmDir = path.resolve(__dirname, '../../.tmp/test-prebuild/browser-wasm/igloo-pwa/public/wasm');
const trackedWasmDir = path.resolve(__dirname, 'public/wasm');

function resolveWasmSourceDir() {
  if (process.env.IGLOO_PWA_WASM_SOURCE_DIR) {
    return path.resolve(process.env.IGLOO_PWA_WASM_SOURCE_DIR);
  }
  if (fs.existsSync(defaultScratchWasmDir)) {
    return defaultScratchWasmDir;
  }
  return trackedWasmDir;
}

function wasmScratchAssetsPlugin(): Plugin {
  const wasmSourceDir = resolveWasmSourceDir();
  return {
    name: 'igloo-pwa-wasm-assets',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url?.split('?')[0] ?? '';
        if (!requestUrl.startsWith('/wasm/')) {
          next();
          return;
        }
        const filePath = path.join(wasmSourceDir, path.basename(requestUrl));
        try {
          const body = await fsp.readFile(filePath);
          res.setHeader('Content-Type', filePath.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
          res.end(body);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      const outDir = path.resolve(__dirname, 'dist/wasm');
      await fsp.rm(outDir, { recursive: true, force: true });
      await fsp.cp(wasmSourceDir, outDir, { recursive: true });
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), wasmScratchAssetsPlugin()],
  resolve: {
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: /^igloo-shared$/, replacement: path.resolve(__dirname, '../igloo-shared/src/index.ts') },
      { find: /^igloo-ui$/, replacement: path.resolve(__dirname, '../igloo-ui/src/index.ts') },
      {
        find: /^igloo-ui\/styles\.css$/,
        replacement: path.resolve(__dirname, '../igloo-ui/dist/styles.css'),
      },
      { find: /^react$/, replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') }
    ]
  },
  server: {
    host: '0.0.0.0',
    port: 1430,
    strictPort: true
  },
  test: {
    include: ['test/frontend/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts']
  },
  clearScreen: false
}));
