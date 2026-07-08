// Stub for `server-only` / `client-only` in the vitest environment. Next.js
// provides these as build-time markers (they have no runtime package), so vite
// can't resolve them — this empty module stands in so server modules can be
// unit-tested directly. Aliased in vitest.config.ts; never used by the app build.
export {};
