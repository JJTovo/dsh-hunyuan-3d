/**
 * End-to-end proof that the concurrency gate behaves as documented.
 *
 * These drive the real registered tools against the mock service, so the
 * assertions are about what actually reached the wire — the only place a
 * concurrency limit can be shown to work.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply as applyPlugin } from '../src/index.js'

/**
 * Boot the plugin against the mock with explicit limits.
 * @param {{ delayMs?: number, maxConcurrency?: number, queueLimit?: number, queueTimeoutMs?: number }} options
 */
async function boot(options) {
  const { startMockServer } = await import('./mock-ai3d.mjs')
  const mock = await startMockServer({ delayMs: options.delayMs ?? 2500, apiKey: 'sk-mockkey' })
  const resultDir = await mkdtemp(path.join(tmpdir(), 'hy3d-conc-'))
  const tools = new Map()
  const ctx = {
    tools: { register: d => { tools.set(d.name, d); return () => {} } },
    credentials: {
      async describe() { return { configured: true, writable: true } },
      async resolve() { return { value: 'sk-mockkey' } },
    },
    inject: (deps, callback) => {
      if (deps.every(name => ctx[name] !== undefined)) callback(ctx)
      return () => {}
    },
    systemPrompt: { section: () => () => {} },
    settings: {
      installed: null,
      installSection(_owner, _ns, schema, entry, hooks) {
        ctx.settings.installed = { schema, entry, hooks }
        hooks.setSource(() => schema(entry))
      },
      async update() {},
    },
    webServer: { routes: [], register: route => { ctx.webServer.routes.push(route); return () => {} } },
    get: name => ctx[name],
  }

  const dispose = applyPlugin(ctx, {
    provider: 'compatible',
    baseUrl: mock.baseUrl,
    resultDir,
    pollIntervalMs: 50,
    httpTimeoutMs: 10_000,
    maxConcurrency: options.maxConcurrency ?? 1,
    queueLimit: options.queueLimit ?? 2,
    queueTimeoutMs: options.queueTimeoutMs ?? 5000,
  })

  const run = (name, args) => tools.get(name).execute(args, { signal: undefined })
  return {
    mock,
    run,
    /** How many submits actually reached the service. */
    submits: () => mock.compatibleRequests.filter(r => r.path === '/v1/ai3d/submit').length,
    stats: () => ctx.webServer.routes
      .find(route => route.path === '/api/dsh-hunyuan-3d/settings'),
    async close() {
      dispose()
      await rm(resultDir, { recursive: true, force: true })
      await mock.close()
    },
  }
}

/** Resolve after `ms`, for asserting that something has NOT happened yet. */
const settle = ms => new Promise(resolve => setTimeout(resolve, ms))

test('maxConcurrency=1: parallel calls reach the service one at a time', async () => {
  // A long first job proves the gate blocks; a short one afterwards lets the
  // queue drain without the test having to drive every slot by hand.
  const h = await boot({ maxConcurrency: 1, delayMs: 4000, queueTimeoutMs: 30_000 })
  try {
    const call = () => h.run('hunyuan_3d_model', { prompt: '并发实测', wait: false })
    const first = call()
    const second = call()
    const third = call()

    const firstResult = await first
    assert.equal(h.submits(), 1, 'more than one submit reached the service')
    assert.equal(firstResult.status, 'WAIT')
    assert.equal(firstResult.concurrency.maxConcurrency, 1)
    assert.equal(firstResult.concurrency.active, 1)
    assert.ok(firstResult.message.includes('holding 1 of 1'),
      `the message should explain the held slot: ${firstResult.message}`)

    // The others are queued and have sent nothing.
    await settle(400)
    assert.equal(h.submits(), 1, 'a queued call submitted before a slot freed')
    const pending = Symbol('pending')
    assert.equal(await Promise.race([second.then(() => 'settled'), settle(200).then(() => pending)]), pending,
      'the second call settled while no slot was free')

    // A terminal observation frees the first slot; the second call then submits
    // and, being wait:false, takes the slot over.
    h.mock.options.delayMs = 300
    const done = await h.run('hunyuan_3d_query', { job_id: firstResult.job_id, wait: true, timeout_ms: 30_000 })
    assert.equal(done.status, 'DONE')
    const secondResult = await second
    assert.equal(h.submits(), 2, 'the queued call should submit once the slot frees')
    assert.equal(secondResult.concurrency.active, 1, 'the second job takes the freed slot')

    // Querying the second frees it for the third, which is the whole point of
    // holding a slot for a background job rather than for the call.
    const doneAgain = await h.run('hunyuan_3d_query', { job_id: secondResult.job_id, wait: true, timeout_ms: 30_000 })
    assert.equal(doneAgain.status, 'DONE')
    const thirdResult = await third
    assert.equal(h.submits(), 3, 'the third queued call should submit on the next freed slot')
    assert.notEqual(thirdResult.job_id, firstResult.job_id)
    assert.notEqual(thirdResult.job_id, secondResult.job_id)
  } finally {
    await h.close()
  }
})

test('a full queue is refused with a code that says nothing was submitted', async () => {
  const h = await boot({ maxConcurrency: 1, queueLimit: 1, delayMs: 3000, queueTimeoutMs: 4000 })
  try {
    const call = () => h.run('hunyuan_3d_model', { prompt: 'x', wait: false })
    await call()                       // takes the only slot
    const queued = call()              // fills the queue
    await settle(100)

    await assert.rejects(
      call(),
      error => error.code === 'concurrency-queue-full' && error.retryable === true,
    )
    assert.equal(h.submits(), 1, 'a refused call must not reach the service')

    // The call that did get queued gives up on its own.
    await assert.rejects(
      queued,
      error => error.code === 'concurrency-wait-timeout' && /was not submitted/.test(error.message),
    )
    assert.equal(h.submits(), 1, 'a timed-out call must not reach the service')
  } finally {
    await h.close()
  }
})

test('wait:true releases its slot on completion, so the next call runs immediately', async () => {
  const h = await boot({ maxConcurrency: 1, delayMs: 300 })
  try {
    // Two sequential waited calls: the second proves the first freed its slot.
    const a = await h.run('hunyuan_3d_model', { prompt: '先', timeout_ms: 30_000 })
    assert.equal(a.status, 'DONE')
    const b = await h.run('hunyuan_3d_model', { prompt: '后', timeout_ms: 30_000 })
    assert.equal(b.status, 'DONE')
    assert.notEqual(a.job_id, b.job_id)
    assert.equal(h.submits(), 2)
    // No slot survives a completed wait.
    assert.equal(b.concurrency, undefined)
  } finally {
    await h.close()
  }
})

test('the settings card report reflects live slot usage', async () => {
  const h = await boot({ maxConcurrency: 2, delayMs: 2500, queueTimeoutMs: 600 })
  try {
    const call = () => h.run('hunyuan_3d_model', { prompt: 'x', wait: false })
    await call()
    await call()
    const queued = call()

    const { fakeResponse, fakeRequest } = await import('./http-doubles.mjs')
    await settle(150)

    // Two slots held, one waiting; the settings GET must say so.
    const response = fakeResponse()
    const route = h.stats()
    assert.ok(route !== undefined, 'no settings route registered')
    await route.handler(fakeRequest({ method: 'GET' }), response)
    const payload = response.json()
    assert.equal(payload.concurrency.active, 2, `expected 2 active, got ${JSON.stringify(payload.concurrency)}`)
    assert.equal(payload.concurrency.queued, 1, `expected 1 queued, got ${JSON.stringify(payload.concurrency)}`)
    assert.equal(payload.concurrency.maxConcurrency, 2)

    // Settle the queued call so nothing outlives the test. It gives up on its
    // own budget, which is what keeps a settings probe side-effect free.
    await assert.rejects(queued, error => error.code === 'concurrency-wait-timeout')
  } finally {
    await h.close()
  }
})
