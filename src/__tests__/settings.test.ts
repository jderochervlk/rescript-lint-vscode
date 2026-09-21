import { Effect, Either } from 'effect'
import { expect, test } from 'vitest'
import { decodeSettings, InvalidSettings } from '../settings.js'

test('decodes disabled settings and preserves a path containing spaces', async () => {
  const settings = { enable: false, serverPath: '/local build/linter.mjs', nodePath: 'node' }
  expect(await Effect.runPromise(decodeSettings(settings))).toStrictEqual(settings)
})

test.for([
  null,
  {},
  { enable: 'yes', serverPath: '', nodePath: 'node' },
  { enable: true, serverPath: 1, nodePath: 'node' },
  { enable: true, serverPath: '', nodePath: '' },
  { enable: true, serverPath: '', nodePath: ' node ' },
])('rejects malformed settings: %j', async (value) => {
  const result = await Effect.runPromise(Effect.either(decodeSettings(value)))
  expect(Either.isLeft(result) && result.left instanceof InvalidSettings).toBe(true)
})
