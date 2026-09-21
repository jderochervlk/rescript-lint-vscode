import { Context, Data, Effect, Layer } from 'effect'
import type { Launch } from './server.js'

export class ClientError extends Data.TaggedError('ClientError')<{
  readonly operation: 'create' | 'start' | 'restart' | 'dispose'
  readonly detail: string
}> {}

export interface ClientHandle {
  readonly start: Effect.Effect<void, ClientError>
  readonly restart: Effect.Effect<void, ClientError>
  readonly dispose: Effect.Effect<void, ClientError>
}

export class ClientFactory extends Context.Tag('ClientFactory')<
  ClientFactory,
  {
    readonly create: (launch: Launch) => Effect.Effect<ClientHandle, ClientError>
    readonly report: (error: ClientError) => Effect.Effect<void>
  }
>() {}

export class Session extends Context.Tag('Session')<
  Session,
  { readonly restart: Effect.Effect<void, ClientError> }
>() {}

export function sessionLayer(
  launches: readonly Launch[],
): Layer.Layer<Session, ClientError, ClientFactory> {
  return Layer.scoped(
    Session,
    Effect.gen(function* () {
      const factory = yield* ClientFactory
      const lock = yield* Effect.makeSemaphore(1)
      const clients = yield* Effect.forEach(launches, (launch) =>
        Effect.acquireRelease(factory.create(launch), (client) =>
          lock.withPermits(1)(client.dispose).pipe(Effect.catchAll(factory.report)),
        ),
      )
      yield* Effect.forEach(clients, (client) => client.start, { discard: true })
      return {
        restart: lock.withPermits(1)(
          Effect.forEach(clients, (client) => client.restart, { discard: true }),
        ),
      }
    }),
  )
}
