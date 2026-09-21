import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Effect, Either, Layer, Option } from 'effect'
import { expect, test } from 'vitest'
import { resolveServer, ServerFiles, ServerFilesLive, ServerPathError } from '../server.js'

const settings = { enable: true, serverPath: '', nodePath: 'node24' } as const
const root = resolve('project with spaces')
const missingFiles = Layer.succeed(ServerFiles, { isFile: () => Effect.succeed(false) })
const existingFiles = Layer.succeed(ServerFiles, { isFile: () => Effect.succeed(true) })

test('uses the workspace ES module launcher with Node and separate stdio arguments', async () => {
  const result = await Effect.runPromise(
    resolveServer(settings, Option.some(root)).pipe(Effect.provide(existingFiles)),
  )
  expect(result).toStrictEqual({
    command: 'node24',
    args: [
      join(root, 'node_modules', '@jvlk', 'rescript-lint', 'bin', 'rescript-lint.mjs'),
      'lsp',
      '--stdio',
    ],
    root: Option.some(root),
  })
})

test.for([Option.none<string>(), Option.some(root)])(
  'falls back to PATH without a workspace package: %j',
  async (folder) => {
    const result = await Effect.runPromise(
      resolveServer(settings, folder).pipe(Effect.provide(missingFiles)),
    )
    expect(result).toStrictEqual({
      command: 'rescript-lint',
      args: ['lsp', '--stdio'],
      root: folder,
    })
  },
)

test('uses an explicit native binary ahead of the workspace package', async () => {
  const path = join(root, 'native linter')
  const result = await Effect.runPromise(
    resolveServer({ ...settings, serverPath: path }, Option.some(root)).pipe(
      Effect.provide(existingFiles),
    ),
  )
  expect(result).toStrictEqual({ command: path, args: ['lsp', '--stdio'], root: Option.some(root) })
})

test('launches an explicit mjs file with the configured Node executable', async () => {
  const path = join(root, 'linter.mjs')
  const result = await Effect.runPromise(
    resolveServer({ ...settings, serverPath: path }, Option.none()).pipe(
      Effect.provide(existingFiles),
    ),
  )
  expect(result).toStrictEqual({
    command: 'node24',
    args: [path, 'lsp', '--stdio'],
    root: Option.none(),
  })
})

test.for(['relative/linter.mjs', join(root, 'missing')])(
  'reports an invalid explicit path without a fallback: %s',
  async (path) => {
    const result = await Effect.runPromise(
      Effect.either(
        resolveServer({ ...settings, serverPath: path }, Option.none()).pipe(
          Effect.provide(missingFiles),
        ),
      ),
    )
    expect(Either.isLeft(result) && result.left.path).toBe(path)
  },
)

test('preserves file access failures rather than silently falling back to PATH', async () => {
  const error = new ServerPathError({ path: root, detail: 'Access denied' })
  const files = Layer.succeed(ServerFiles, { isFile: () => Effect.fail(error) })
  const result = await Effect.runPromise(
    Effect.either(resolveServer(settings, Option.some(root)).pipe(Effect.provide(files))),
  )
  expect(result).toStrictEqual(Either.left(error))
})

test('the filesystem adapter distinguishes files, directories, missing paths, and invalid paths', async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'rescript-lint-vscode-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'linter.mjs')
  await writeFile(file, '')
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const files = yield* ServerFiles
      return yield* Effect.all([
        files.isFile(file),
        files.isFile(directory),
        files.isFile(join(directory, 'missing')),
        Effect.either(files.isFile('\0')),
      ])
    }).pipe(Effect.provide(ServerFilesLive)),
  )
  expect(result.slice(0, 3)).toStrictEqual([true, false, false])
  const invalid = result[3]
  expect(Either.isLeft(invalid) && invalid.left instanceof ServerPathError).toBe(true)
})
