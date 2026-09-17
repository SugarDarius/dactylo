import { describe, expect, test } from 'vitest'

import { makeFixtureSetupApi } from './utils/fixture'

describe('Dactylo', () => {
  const fixture = makeFixtureSetupApi()

  test('editor should be empty when initialized', () => {
    const context = fixture.dactylo.getContextSnapshot()

    expect(context.state.blockOrderById.length).toBe(1)
  })
})
