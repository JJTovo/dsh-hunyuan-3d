/**
 * A concurrency gate for modeling jobs.
 *
 * The service grants a fixed number of simultaneous jobs (three, per the
 * product documentation) and answers anything beyond it with
 * `RequestLimitExceeded`. An agent that fires off four calls at once therefore
 * pays for a round trip to learn what the plugin already knows, so submissions
 * queue here instead.
 *
 * A slot is held for as long as a job occupies the service, not merely while a
 * call is in flight: `wait: false` returns immediately but the job is still
 * running, so its slot is released when a later query observes a terminal
 * status. A job that outlives every observation still returns its slot once the
 * wait budget expires, otherwise a single abandoned job would wedge the gate.
 */

/** Error thrown when the queue is full or a queued call gives up waiting. */
export class ConcurrencyError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message)
    this.name = 'ConcurrencyError'
    this.code = code
    this.retryable = true
  }
}

/**
 * Create one gate. The limits are read per call so a settings change applies
 * immediately, without rebuilding the gate.
 * @param {() => { maxConcurrency: number, queueLimit: number, queueTimeoutMs: number }} limits
 */
export function createConcurrencyGate(limits) {
  /** Number of jobs currently occupying a service slot. */
  let active = 0
  /** @type {Array<{ resolve: (release: () => void) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>, settled: boolean }>} */
  const waiters = []

  /**
   * Hand a free slot to the next waiter, if any. Called whenever a slot frees.
   */
  const drain = () => {
    while (active < limits().maxConcurrency && waiters.length > 0) {
      const waiter = waiters.shift()
      if (waiter === undefined || waiter.settled) continue
      waiter.settled = true
      clearTimeout(waiter.timer)
      active += 1
      waiter.resolve(makeRelease())
    }
  }

  /** @returns {() => void} a release that is safe to call more than once. */
  const makeRelease = () => {
    let released = false
    return () => {
      if (released) return
      released = true
      active = Math.max(0, active - 1)
      drain()
    }
  }

  return {
    /**
     * Take a slot, waiting in line when the service is at its limit.
     * @returns {Promise<() => void>} the release for the acquired slot.
     */
    async acquire() {
      const { maxConcurrency, queueLimit, queueTimeoutMs } = limits()
      if (active < maxConcurrency) {
        active += 1
        return makeRelease()
      }
      if (waiters.length >= queueLimit) {
        throw new ConcurrencyError(
          `All ${maxConcurrency} Hunyuan 3D job slots are busy and ${waiters.length} call(s) are already queued (queue limit ${queueLimit}). Wait for a running job to finish, or raise "maxConcurrency" in Settings if your plan allows more.`,
          'concurrency-queue-full',
        )
      }
      return await new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          settled: false,
          timer: setTimeout(() => {
            if (waiter.settled) return
            waiter.settled = true
            const index = waiters.indexOf(waiter)
            if (index >= 0) waiters.splice(index, 1)
            reject(new ConcurrencyError(
              `Waited ${Math.round(queueTimeoutMs / 1000)}s for a Hunyuan 3D job slot but all ${maxConcurrency} are still busy. The job was not submitted.`,
              'concurrency-wait-timeout',
            ))
          }, queueTimeoutMs),
        }
        waiters.push(waiter)
      })
    },

    /** Snapshot for reporting and for the settings card. */
    stats() {
      return { active, queued: waiters.length, maxConcurrency: limits().maxConcurrency }
    },

    /** Drop every waiter, e.g. when the plugin unloads. */
    dispose() {
      for (const waiter of waiters.splice(0)) {
        if (waiter.settled) continue
        waiter.settled = true
        clearTimeout(waiter.timer)
        waiter.reject(new ConcurrencyError('the Hunyuan 3D plugin unloaded while this call was queued', 'concurrency-cancelled'))
      }
    },
  }
}
