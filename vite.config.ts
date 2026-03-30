import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: /^igloo-shared$/, replacement: path.resolve(__dirname, '../igloo-shared/src/index.ts') },
      { find: /^igloo-ui$/, replacement: path.resolve(__dirname, '../igloo-ui/src/index.ts') },
      {
        find: /^igloo-ui\/styles\.css$/,
        replacement: path.resolve(
          __dirname,
          command === 'serve' ? '../igloo-ui/src/styles.css' : '../igloo-ui/dist/styles.css',
        ),
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
