import { Data, Effect, Schema } from 'effect'

const SettingsSchema = Schema.Struct({
  enable: Schema.Boolean,
  serverPath: Schema.String,
  nodePath: Schema.NonEmptyTrimmedString,
})

export type Settings = typeof SettingsSchema.Type

export class InvalidSettings extends Data.TaggedError('InvalidSettings')<{
  readonly detail: string
}> {}

export function decodeSettings(value: unknown): Effect.Effect<Settings, InvalidSettings> {
  return Schema.decodeUnknown(SettingsSchema)(value).pipe(
    Effect.mapError((error) => new InvalidSettings({ detail: error.message })),
  )
}
