import { describe, expect, test, vi } from 'vitest'

import { EventSource } from '../../src/internals/event-source'

describe('EventSource', () => {
  test('notify returns false when there are no subscribers', () => {
    const source = new EventSource<string>()

    expect(source.notify('hello')).toBe(false)
  })

  test('subscribe delivers the event and makes notify return true', () => {
    const source = new EventSource<string>()
    const callback = vi.fn()

    source.observable.subscribe(callback)

    expect(source.notify('hello')).toBe(true)
    expect(callback).toHaveBeenCalledExactlyOnceWith('hello')
  })

  test('notifies every subscriber with the same event', () => {
    const source = new EventSource<number>()
    const first = vi.fn()
    const second = vi.fn()

    source.observable.subscribe(first)
    source.observable.subscribe(second)
    source.notify(42)

    expect(first).toHaveBeenCalledExactlyOnceWith(42)
    expect(second).toHaveBeenCalledExactlyOnceWith(42)
  })

  test('unsubscribe stops further notifications', () => {
    const source = new EventSource<string>()
    const callback = vi.fn()
    const unsub = source.observable.subscribe(callback)

    source.notify('first')
    unsub()

    expect(source.notify('second')).toBe(false)
    expect(callback).toHaveBeenCalledExactlyOnceWith('first')
  })

  test('unsubscribe is idempotent', () => {
    const source = new EventSource<string>()
    const remaining = vi.fn()
    const unsub = source.observable.subscribe(vi.fn())
    source.observable.subscribe(remaining)

    unsub()
    unsub()
    source.notify('hello')

    expect(remaining).toHaveBeenCalledExactlyOnceWith('hello')
  })

  test('subscribeOnce fires only for the next event', () => {
    const source = new EventSource<string>()
    const callback = vi.fn()

    source.observable.subscribeOnce(callback)

    expect(source.notify('first')).toBe(true)
    expect(source.notify('second')).toBe(false)
    expect(callback).toHaveBeenCalledExactlyOnceWith('first')
  })

  test('subscribeOnce can be cancelled before the event fires', () => {
    const source = new EventSource<string>()
    const callback = vi.fn()
    const unsub = source.observable.subscribeOnce(callback)

    unsub()

    expect(source.notify('hello')).toBe(false)
    expect(callback).not.toHaveBeenCalled()
  })

  test('subscribe and subscribeOnce can coexist', () => {
    const source = new EventSource<string>()
    const lasting = vi.fn()
    const once = vi.fn()

    source.observable.subscribe(lasting)
    source.observable.subscribeOnce(once)

    source.notify('first')
    source.notify('second')

    expect(once).toHaveBeenCalledExactlyOnceWith('first')
    expect(lasting).toHaveBeenCalledTimes(2)
    expect(lasting).toHaveBeenNthCalledWith(1, 'first')
    expect(lasting).toHaveBeenNthCalledWith(2, 'second')
  })
})
