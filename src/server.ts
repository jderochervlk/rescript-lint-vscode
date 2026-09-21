import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Context, Data, Effect, Layer, Option } from 'effect'
import type { Settings } from './settings.js'

export class ServerPathError extends Data.TaggedError('ServerPathError')<{
  readonly path: string
  readonly detail: string
}> {}

export class ServerFiles extends Context.Tag('ServerFiles')<
  ServerFiles,
  { readonly isFile: (path: string) => Effect.Effect<boolean, ServerPathError> }
>() {}

export const ServerFilesLive = Layer.succeed(ServerFiles, {
  isFile: (path) =>
    Effect.tryPromise({
      try: () => stat(path),
      catch: (cause) => ({ cause }),
    }).pipe(
      Effect.map((info) => info.isFile()),
      Effect.catchAll(({ cause }) => {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
          return Effect.succeed(false)
        }
        return Effect.fail(new ServerPathError({ path, detail: String(cause) }))
      }),
    ),
})

export interface Launch {
  readonly command: string
  readonly args: readonly string[]
  readonly root: Option.Option<string>
}

function commandFor(path: string, settings: Settings, root: Option.Option<string>): Launch {
  return path.endsWith('.mjs')
    ? { command: settings.nodePath, args: [path, 'lsp', '--stdio'], root }
    : { command: path, args: ['lsp', '--stdio'], root }
}

function explicitServer(
  settings: Settings,
  root: Option.Option<string>,
): Effect.Effect<Launch, ServerPathError, ServerFiles> {
  return Effect.gen(function* () {
    const path = settings.serverPath
    if (!isAbsolute(path)) {
      return yield* new ServerPathError({ path, detail: 'serverPath must be an absolute path.' })
    }
    const files = yield* ServerFiles
    if (!(yield* files.isFile(path))) {
      return yield* new ServerPathError({ path, detail: 'The configured linter is not a file.' })
    }
    return commandFor(path, settings, root)
  })
}

export function resolveServer(
  settings: Settings,
  root: Option.Option<string>,
): Effect.Effect<Launch, ServerPathError, ServerFiles> {
  if (settings.serverPath !== '') return explicitServer(settings, root)
  return Effect.gen(function* () {
    const files = yield* ServerFiles
    if (Option.isSome(root)) {
      const path = join(
        root.value,
        'node_modules',
        '@jvlk',
        'rescript-lint',
        'bin',
        'rescript-lint.mjs',
      )
      if (yield* files.isFile(path)) return commandFor(path, settings, root)
    }
    return commandFor('rescript-lint', settings, root)
  })
}
