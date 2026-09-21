import { Deferred, Effect, Either, Fiber, Layer, Option, Ref } from 'effect'
import { expect, test } from 'vitest'
import { ClientError, ClientFactory, Session, sessionLayer } from '../session.js'
import type { ClientHandle } from '../session.js'

const launch = {
  command: 'rescript-lint',
  args: ['lsp', '--stdio'],
  root: Option.none<string>(),
} as const

test('starts, restarts, and disposes each workspace client within its scope', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<readonly string[]>([])
      const record = (value: string): Effect.Effect<void> =>
        Ref.update(events, (values) => [...values, value])
      const factory = Layer.succeed(ClientFactory, {
        create: () =>
          Effect.succeed({
            start: record('start'),
            restart: record('restart'),
            dispose: record('dispose'),
          }),
        report: () => record('error'),
      })
      yield* Effect.scoped(
        Effect.flatMap(Session, (session) => session.restart).pipe(
          Effect.provide(sessionLayer([launch, launch]).pipe(Layer.provide(factory))),
        ),
      )
      return yield* Ref.get(events)
    }),
  )
  expect(result).toStrictEqual(['start', 'start', 'restart', 'restart', 'dispose', 'dispose'])
})

test.for(['start', 'restart', 'dispose', 'create'] as const)(
  'handles a %s failure and finalizes acquired clients',
  async (operation) => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<readonly string[]>([])
        const record = (value: string): Effect.Effect<void> =>
          Ref.update(events, (values) => [...values, value])
        const failure = new ClientError({ operation, detail: 'test failure' })
        const client: ClientHandle = {
          start: operation === 'start' ? Effect.fail(failure) : Effect.void,
          restart: operation === 'restart' ? Effect.fail(failure) : Effect.void,
          dispose: record('dispose').pipe(
            Effect.andThen(operation === 'dispose' ? Effect.fail(failure) : Effect.void),
          ),
        }
        const factory = Layer.succeed(ClientFactory, {
          create: () => (operation === 'create' ? Effect.fail(failure) : Effect.succeed(client)),
          report: (error) => record(error.operation),
        })
        const outcome = yield* Effect.either(
          Effect.scoped(
            Effect.flatMap(Session, (session) => session.restart).pipe(
              Effect.provide(sessionLayer([launch]).pipe(Layer.provide(factory))),
            ),
          ),
        )
        return { outcome, events: yield* Ref.get(events), failure }
      }),
    )
    expect(result.outcome).toStrictEqual(
      operation === 'dispose' ? Either.right(undefined) : Either.left(result.failure),
    )
    expect(result.events).toStrictEqual(
      operation === 'create' ? [] : operation === 'dispose' ? ['dispose', 'dispose'] : ['dispose'],
    )
  },
)

test('disposes the acquired client when startup is interrupted', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const disposed = yield* Ref.make(false)
      const factory = Layer.succeed(ClientFactory, {
        create: () =>
          Effect.succeed({
            start: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
            restart: Effect.void,
            dispose: Ref.set(disposed, true),
          }),
        report: () => Effect.void,
      })
      const fiber = yield* Effect.fork(
        Effect.scoped(
          Session.pipe(Effect.provide(sessionLayer([launch]).pipe(Layer.provide(factory)))),
        ),
      )
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(fiber)
      return yield* Ref.get(disposed)
    }),
  )
  expect(result).toBe(true)
})
