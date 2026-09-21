import { Effect } from 'effect'
import { build } from 'esbuild'

await Effect.runPromise(
  Effect.tryPromise(() =>
    build({
      entryPoints: {
        extension: 'src/extension.ts',
        'editor-smoke': 'src/__tests__/editor-smoke.ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['vscode'],
      outdir: 'dist',
      outExtension: { '.js': '.mjs' },
      sourcemap: true,
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      },
    }),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(error)
        process.exitCode = 1
      }),
    ),
  ),
)
