import { Cause, Context, Effect, Exit, Layer, Option, Ref, Scope } from 'effect'
import type { InvalidSettings } from './settings.js'
import type { ServerPathError } from './server.js'
import type { ClientError, Session } from './session.js'

export type StartupError = InvalidSettings | ServerPathError | ClientError

export class SessionSource extends Context.Tag('SessionSource')<
  SessionSource,
  {
    readonly load: Effect.Effect<Layer.Layer<Session, StartupError>>
    readonly report: (cause: Cause.Cause<StartupError>) => Effect.Effect<void>
  }
>() {}

export class Controller extends Context.Tag('Controller')<
  Controller,
  { readonly reload: Effect.Effect<void> }
>() {}

function closeCurrent(current: Ref.Ref<Option.Option<Scope.CloseableScope>>): Effect.Effect<void> {
  return Ref.getAndSet(current, Option.none()).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (scope) => Scope.close(scope, Exit.void),
      }),
    ),
  )
}

export const ControllerLive = Layer.scoped(
  Controller,
  Effect.gen(function* () {
    const source = yield* SessionSource
    const lock = yield* Effect.makeSemaphore(1)
    const current = yield* Ref.make(Option.none<Scope.CloseableScope>())
    yield* Effect.addFinalizer(() => lock.withPermits(1)(closeCurrent(current)))
    const reload = lock.withPermits(1)(
      Effect.gen(function* () {
        yield* closeCurrent(current)
        const scope = yield* Scope.make()
        yield* Ref.set(current, Option.some(scope))
        const layer = yield* source.load
        yield* Layer.buildWithScope(layer, scope).pipe(
          Effect.onError(() => closeCurrent(current)),
          Effect.catchAll((error) => source.report(Cause.fail(error))),
        )
      }),
    )
    return { reload }
  }),
)

export function failureMessage(cause: Cause.Cause<StartupError>): string {
  return Option.match(Cause.failureOption(cause), {
    onNone: () => Cause.pretty(cause),
    onSome: (error) => ('path' in error ? `${error.path}: ${error.detail}` : error.detail),
  })
}
