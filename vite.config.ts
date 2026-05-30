import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { resolveConfig } from './vite.resolve';

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
  resolve: resolveConfig,
  server: {
    host: '0.0.0.0',
    port: 1430,
    strictPort: true
  },
  clearScreen: false
}));
