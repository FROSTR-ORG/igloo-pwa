import path from 'node:path';

// Shared module-resolution config used by both the app build (vite.config.ts)
// and the unit-test runner (vitest.config.ts) so they resolve igloo-shared /
// igloo-ui sources and dedupe React identically.
//
// NOTE: the igloo-shared/igloo-ui aliases are exact-match (`$`), so subpath
// imports like `igloo-shared/testing/setup-dom` intentionally fall through to
// node resolution + the package exports map rather than the source alias.
export const resolveConfig = {
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
    { find: /^react-dom\/client$/, replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
  ],
};
