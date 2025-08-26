import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/client/index.ts',
    'src/server/index.ts',
    'src/schema.ts'
  ],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    '@libsql/client',
    'drizzle-orm',
    'drizzle-kit',
    'postgres',
    'dotenv',
    'hono',
    '@hono/node-server',
    '@hono/zod-validator',
    'zod',
    'luxon'
  ]
});