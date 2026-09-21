import { Cause, Context, Effect, Layer, Option, Ref } from 'effect'
import { expect, test } from 'vitest'
import { Controller, ControllerLive, failureMessage, SessionSource } from '../controller.js'
import { ServerPathError } from '../server.js'
import { ClientError, Session } from '../session.js'
import { InvalidSettings } from '../settings.js'

test('serializes reloads and closes the last session on deactivation', async () => {
  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Ref.make<readonly string[]>([])
      const record = (message: string): Effect.Effect<void> =>
        Ref.update(log, (items) => [...items, message])
      const source = Layer.succeed(SessionSource, {
        load: Effect.sync(() =>
          Layer.scoped(
            Session,
            Effect.acquireRelease(record('start'), () => record('dispose')).pipe(
              Effect.as({ restart: Effect.void }),
            ),
          ),
        ),
        report: () => record('error'),
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const controller = yield* Controller
          yield* Effect.all([controller.reload, controller.reload, controller.reload], {
            concurrency: 'unbounded',
          })
        }).pipe(Effect.provide(ControllerLive.pipe(Layer.provide(source)))),
      )
      return yield* Ref.get(log)
    }),
  )
  expect(events).toStrictEqual(['start', 'dispose', 'start', 'dispose', 'start', 'dispose'])
})

test('reports failed startup, closes its resources, and can recover on the next reload', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const reports = yield* Ref.make<readonly string[]>([])
      const error = new ClientError({ operation: 'start', detail: 'missing executable' })
      const source = Layer.succeed(SessionSource, {
        load: Ref.getAndUpdate(attempts, (count) => count + 1).pipe(
          Effect.map((count) =>
            count === 0
              ? Layer.effect(Session, Effect.fail(error))
              : Layer.succeed(Session, { restart: Effect.void }),
          ),
        ),
        report: (cause) => Ref.update(reports, (messages) => [...messages, failureMessage(cause)]),
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const controller = yield* Controller
          yield* controller.reload
          yield* controller.reload
        }).pipe(Effect.provide(ControllerLive.pipe(Layer.provide(source)))),
      )
      return { attempts: yield* Ref.get(attempts), reports: yield* Ref.get(reports) }
    }),
  )
  expect(result).toStrictEqual({ attempts: 2, reports: ['missing executable'] })
})

test('deactivation without a reload has no session resources to close', async () => {
  const result = await Effect.runPromise(
    Effect.scoped(
      Layer.build(
        ControllerLive.pipe(
          Layer.provide(
            Layer.succeed(SessionSource, {
              load: Effect.succeed(Layer.succeed(Session, { restart: Effect.void })),
              report: () => Effect.void,
            }),
          ),
        ),
      ),
    ),
  )
  expect(Option.isSome(Context.getOption(result, Controller))).toBe(true)
})

test('formats path errors with the failing path and settings errors with their detail', () => {
  expect(
    failureMessage(Cause.fail(new ServerPathError({ path: '/missing', detail: 'not found' }))),
  ).toBe('/missing: not found')
  expect(
    failureMessage(Cause.fail(new InvalidSettings({ detail: 'nodePath cannot be empty' }))),
  ).toBe('nodePath cannot be empty')
  expect(failureMessage(Cause.die(new Error('unexpected failure')))).toContain('unexpected failure')
})
