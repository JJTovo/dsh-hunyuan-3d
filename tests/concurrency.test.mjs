/**
 * The concurrency gate: the service grants a fixed number of simultaneous jobs,
 * so the plugin must queue rather than let the agent trip the limit.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ConcurrencyError, createConcurrencyGate } from '../src/concurrency.js'

/** @param {Partial<{maxConcurrency: number, queueLimit: number, queueTimeoutMs: number}>} [over] */
function gateWith(over = {}) {
  const limits = { maxConcurrency: 3, queueLimit: 2, queueTimeoutMs: 300, ...over }
  return { gate: createConcurrencyGate(() => limits), limits }
}

test('the gate admits exactly maxConcurrency jobs and queues the next one', async () => {
  const { gate } = gateWith()
  const releases = []
  for (let i = 0; i < 3; i += 1) releases.push(await gate.acquire())
  assert.deepEqual(gate.stats(), { active: 3, queued: 0, maxConcurrency: 3 })

  let admitted = false
  const fourth = gate.acquire().then((release) => { admitted = true; releases.push(release) })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(admitted, false, 'the fourth call must wait, not run')
  assert.deepEqual(gate.stats(), { active: 3, queued: 1, maxConcurrency: 3 })

  // Freeing one slot admits exactly one waiter.
  releases[0]()
  await fourth
  assert.equal(admitted, true)
  assert.deepEqual(gate.stats(), { active: 3, queued: 0, maxConcurrency: 3 })
})

test('a release is idempotent, so a double release cannot inflate capacity', async () => {
  const { gate } = gateWith()
  const release = await gate.acquire()
  release()
  release()
  assert.equal(gate.stats().active, 0)
  // Capacity is intact: three more are admitted.
  await gate.acquire(); await gate.acquire(); await gate.acquire()
  assert.equal(gate.stats().active, 3)
})

test('a full queue is refused with a retryable, explanatory error', async () => {
  const { gate } = gateWith({ queueLimit: 1 })
  const held = [await gate.acquire(), await gate.acquire(), await gate.acquire()]
  const queued = gate.acquire() // fills the queue
  await assert.rejects(
    gate.acquire(),
    (error) => error instanceof ConcurrencyError
      && error.code === 'concurrency-queue-full'
      && error.retryable === true
      && /3/.test(error.message),
  )
  held[0]()
  await queued
})

test('a queued call gives up after queueTimeoutMs and says it never submitted', async () => {
  const { gate } = gateWith({ queueTimeoutMs: 60 })
  await gate.acquire(); await gate.acquire(); await gate.acquire()
  const started = Date.now()
  await assert.rejects(
    gate.acquire(),
    (error) => error.code === 'concurrency-wait-timeout' && /was not submitted/.test(error.message),
  )
  assert.ok(Date.now() - started >= 50, 'it must actually wait before giving up')
  assert.equal(gate.stats().queued, 0, 'a timed-out waiter leaves the queue')
})

test('a raised limit takes effect immediately, without rebuilding the gate', async () => {
  const { gate, limits } = gateWith()
  await gate.acquire(); await gate.acquire(); await gate.acquire()
  limits.maxConcurrency = 4
  const release = await gate.acquire()
  assert.equal(gate.stats().active, 4)
  release()
})

test('dispose rejects queued waiters instead of leaving them pending', async () => {
  const { gate } = gateWith()
  await gate.acquire(); await gate.acquire(); await gate.acquire()
  const queued = gate.acquire()
  gate.dispose()
  await assert.rejects(queued, (error) => error.code === 'concurrency-cancelled')
})
