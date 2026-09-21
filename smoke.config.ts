import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runTests } from '@vscode/test-electron'
import { Effect } from 'effect'

const smoke = Effect.scoped(
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'rescript-lint-editor-'))),
      (path) =>
        Effect.tryPromise(() => rm(path, { recursive: true, force: true })).pipe(
          Effect.catchAll(() => Effect.void),
        ),
    )
    const workspace = join(directory, 'workspace')
    yield* Effect.tryPromise(async () => {
      await mkdir(join(workspace, '.vscode'), { recursive: true })
      await writeFile(join(workspace, 'Smoke.res'), 'Console.log("hello")\n')
      await writeFile(
        join(workspace, '.vscode', 'settings.json'),
        JSON.stringify({ 'rescript.settings.askToStartBuild': false }),
      )
      const executable = process.env['VSCODE_EXECUTABLE_PATH']
      await runTests({
        ...(executable === undefined ? {} : { vscodeExecutablePath: executable }),
        version: '1.126.0',
        extensionDevelopmentPath: resolve('.'),
        extensionTestsPath: resolve('dist/editor-smoke.mjs'),
        extensionTestsEnv: {
          RESCRIPT_LINT_TEST_BINARY: process.env['RESCRIPT_LINT_TEST_BINARY'] ?? '',
        },
        launchArgs: [
          workspace,
          '--user-data-dir',
          join(directory, 'profile'),
          '--disable-workspace-trust',
          '--skip-welcome',
          '--skip-release-notes',
          '--disable-gpu',
          '--no-sandbox',
        ],
      })
    }).pipe(
      Effect.ensuring(
        Effect.tryPromise(() =>
          cp(join(directory, 'profile', 'logs'), resolve('.vscode-test', 'logs'), {
            recursive: true,
          }),
        ).pipe(Effect.catchAll(() => Effect.void)),
      ),
    )
  }),
)

await Effect.runPromise(
  smoke.pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(error)
        process.exitCode = 1
      }),
    ),
  ),
)
