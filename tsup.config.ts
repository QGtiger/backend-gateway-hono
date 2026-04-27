import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  external: [
    'hono',
    '@hono/node-server',
    'chokidar',
    'pg',
    'drizzle-orm',
    'drizzle-orm/node-postgres',
    '@types/pg',
    '@lightfish/server',
    '@lightfish/server/shared',
  ],
  target: 'node22',
})