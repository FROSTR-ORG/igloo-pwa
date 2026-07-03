// Minimal ambient declarations for the node builtins used by Vitest-only tests.
// igloo-pwa is browser-targeted and deliberately avoids a full @types/node
// dependency, which would reshape global DOM timer typings during app typecheck.
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}

declare const process: {
  cwd(): string;
};
