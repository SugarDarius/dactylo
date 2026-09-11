/** A callback function that is called when an event is emitted. */
export type SubscriberCallback<T> = (event: T) => void

/** A function that unsubscribes from an event source. */
export type UnsubscribeCallback = () => void

/** An observable that can be subscribed to and notified about events. */
export interface Observable<T> {
  /** Register a callback function called when the event source emits an events. */
  subscribe: (callback: SubscriberCallback<T>) => UnsubscribeCallback
}
/**
 * An event source that can be subscribed to and notified about events.
 * @example
 * ```ts
 * const event = new EventSource<string>()
 *
 * const unsub = event.observable.subscribe((event: string) => {
 *   console.log(event)
 * })
 *
 * event.notify('Hello, world!')
 * unsub()
 *
 * // Output: Hello, world!
 * ```
 */
export class EventSource<T> {
  /** Set of registered callbacks subscribed to the event */
  #callbacks: Set<SubscriberCallback<T>>

  constructor() {
    this.#callbacks = new Set<SubscriberCallback<T>>()
  }

  /** An observable that can be subscribed to and notified about events. */
  get observable(): Observable<T> {
    return {
      /** Register a callback function called when the event source emits an events. */
      subscribe: (callback: SubscriberCallback<T>): UnsubscribeCallback => {
        this.#callbacks.add(callback)

        return () => this.#callbacks.delete(callback)
      },
    }
  }

  /**
   * Notify all subscribers about the given event.
   * Returns `true` if at least one subscriber was notified.
   */
  notify(event: T): boolean {
    let notified = false

    for (const callback of this.#callbacks) {
      callback(event)
      notified = true
    }

    return notified
  }
}
