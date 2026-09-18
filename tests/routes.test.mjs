/**
 * The settings + credential bridge (`/api/dsh-hunyuan-3d/*`).
 *
 * Covers the contract the browser card depends on, plus the two rules that
 * matter most: the fence refuses non-loopback callers, and no response ever
 * carries a credential value.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_API_KEY_REF, normalizeSettings, SETTINGS_DEFAULTS, SettingsSchema } from '../src/settings.js'
import { CREDENTIALS_ROUTE, SETTINGS_ROUTE, TEST_ROUTE, makeRoutes } from '../src/routes.js'
import { fakeRequest, fakeResponse } from './http-doubles.mjs'

const SECRET = 'AKID-do-not-leak-me'

/** A bridge wired to an in-memory store, mirroring the host's seams. */
function harness() {
  const store = new Map()
  // native provider by default here: these cases assert the TC3 credential set.
  let settings = normalizeSettings({ provider: 'native' })
  const credentials = {
    async describe(ref) { return { configured: store.has(ref), writable: true, source: store.has(ref) ? 'file' : undefined } },
    async resolve(ref) { return store.has(ref) ? { value: store.get(ref) } : undefined },
    async set(ref, value) { store.set(ref, value) },
    async unset(ref) { store.delete(ref) },
  }
  const routes = makeRoutes({
    credentials,
    getSettings: () => ({ ...settings }),
    updateSettings: async (patch) => { settings = normalizeSettings({ ...settings, ...patch }); return { ...settings } },
    describeCredential: async (ref) => credentials.describe(ref),
    setCredential: async (ref, value) => credentials.set(ref, value),
    unsetCredential: async (ref) => credentials.unset(ref),
  })
  const byPath = new Map(routes.map(route => [route.path, route]))
  return { store, routes, byPath, settings: () => settings }
}

/** Dispatch one request through the real handler. */
async function call(h, path, request) {
  const route = h.byPath.get(path)
  assert.ok(route !== undefined, `no route registered for ${path}`)
  const response = fakeResponse()
  await route.handler(request, response)
  return response
}

test('settings route reads the resolved section and credential status only', async () => {
  const h = harness()
  await h.store.set('TENCENTCLOUD_SECRET_KEY', SECRET)

  const response = await call(h, SETTINGS_ROUTE, fakeRequest())
  assert.equal(response.status, 200)
  const payload = response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.settings.region, SETTINGS_DEFAULTS.region)
  assert.equal(payload.credentials.secretKey.ref, 'TENCENTCLOUD_SECRET_KEY')
  assert.equal(payload.credentials.secretKey.configured, true)
  assert.equal(payload.credentials.secretId.configured, false)

  // The whole point of the bridge: the literal never travels to the browser.
  assert.equal(response.body.includes(SECRET), false, 'a credential value leaked to the browser')
})

test('settings route persists a valid patch and rejects an invalid one', async () => {
  const h = harness()

  const ok = await call(h, SETTINGS_ROUTE, fakeRequest({ method: 'POST', payload: { settings: { region: 'ap-shanghai', pollIntervalMs: 2000 } } }))
  assert.equal(ok.json().ok, true)
  assert.equal(h.settings().region, 'ap-shanghai')
  assert.equal(h.settings().pollIntervalMs, 2000)

  const bad = await call(h, SETTINGS_ROUTE, fakeRequest({ method: 'POST', payload: { settings: { secretIdRef: 'not a ref' } } }))
  const badPayload = bad.json()
  assert.equal(badPayload.ok, false)
  assert.equal(badPayload.code, 'invalid-settings')
  assert.match(badPayload.message, /secretIdRef/)
  // A rejected patch must not have changed anything.
  assert.equal(h.settings().region, 'ap-shanghai')
})

test('credentials route writes, reports status, and never echoes the value', async () => {
  const h = harness()

  const written = await call(h, CREDENTIALS_ROUTE, fakeRequest({ method: 'POST', payload: { role: 'secretId', action: 'set', value: SECRET } }))
  const writtenPayload = written.json()
  assert.equal(writtenPayload.ok, true)
  assert.equal(h.store.get('TENCENTCLOUD_SECRET_ID'), SECRET)
  assert.equal(written.body.includes(SECRET), false, 'the write response echoed the secret')

  const unset = await call(h, CREDENTIALS_ROUTE, fakeRequest({ method: 'POST', payload: { role: 'secretId', action: 'unset' } }))
  assert.equal(unset.json().ok, true)
  assert.equal(h.store.has('TENCENTCLOUD_SECRET_ID'), false)

  const badRole = await call(h, CREDENTIALS_ROUTE, fakeRequest({ method: 'POST', payload: { role: 'nope', action: 'set', value: 'x' } }))
  assert.equal(badRole.json().code, 'bad-request')

  const empty = await call(h, CREDENTIALS_ROUTE, fakeRequest({ method: 'POST', payload: { role: 'secretId', action: 'set', value: '   ' } }))
  assert.equal(empty.json().code, 'bad-request')
})

test('the fence refuses non-loopback callers and wrong methods', async () => {
  const h = harness()

  const foreignHost = await call(h, SETTINGS_ROUTE, fakeRequest({ headers: { host: 'example.com' } }))
  assert.equal(foreignHost.status, 403)

  const foreignAddress = await call(h, SETTINGS_ROUTE, fakeRequest({ remoteAddress: '10.0.0.7' }))
  assert.equal(foreignAddress.status, 403)

  const crossSite = await call(h, SETTINGS_ROUTE, fakeRequest({ headers: { 'sec-fetch-site': 'cross-site' } }))
  assert.equal(crossSite.status, 403)

  const wrongMethod = await call(h, SETTINGS_ROUTE, fakeRequest({ method: 'DELETE' }))
  assert.equal(wrongMethod.status, 405)

  // A loopback Origin on a loopback Host is the browser-writing case: allowed.
  const sameOrigin = await call(h, SETTINGS_ROUTE, fakeRequest({ headers: { origin: 'http://127.0.0.1:8080' } }))
  assert.equal(sameOrigin.status, 200)
})

test('settings schema resolves defaults and reports issues instead of throwing', () => {
  const resolved = SettingsSchema({})
  assert.deepEqual(resolved, SETTINGS_DEFAULTS)

  const issues = SettingsSchema['~standard'].validate({ endpoint: 'not a host!' })
  assert.ok(Array.isArray(issues.issues) && issues.issues.length > 0)
  assert.equal(typeof SettingsSchema.toJSON().properties.region, 'object')
})

test('connectivity probe reports missing credentials without calling out', async () => {
  const h = harness()
  const response = await call(h, TEST_ROUTE, fakeRequest({ method: 'POST', payload: {} }))
  const payload = response.json()
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'credentials-not-configured')
})

test('connectivity probe queries a bogus job so it authenticates without billing', async () => {
  const store = new Map([['HUNYUAN3D_API_KEY', 'sk-probe']])
  let settings = normalizeSettings({ provider: 'compatible' })
  let seen
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen = { url, method: init?.method, authorization: init?.headers?.Authorization, body: init?.body }
    // A real gateway answers about the job once the key is accepted.
    // The real gateway answers HTTP 200 carrying a job-level failure once the key is accepted.
    return { ok: true, status: 200, text: async () => JSON.stringify({ Status: 'FAIL', ErrorCode: 'ResourceNotFound.Job', ErrorMessage: 'job x not found' }) }
  }
  const ctx = {
    credentials: {
      async describe(ref) { return { configured: store.has(ref), writable: true } },
      async resolve(ref) { return store.has(ref) ? { value: store.get(ref) } : undefined },
    },
  }
  const routes = makeRoutes({
    credentials: ctx.credentials,
    getSettings: () => ({ ...settings }),
    updateSettings: async (patch) => { settings = normalizeSettings({ ...settings, ...patch }); return { ...settings } },
    describeCredential: async (ref) => ({ configured: store.has(ref), writable: true }),
    setCredential: async () => {},
    unsetCredential: async () => {},
  })
  const route = routes.find(entry => entry.path === TEST_ROUTE)
  const response = fakeResponse()
  try {
    await route.handler(fakeRequest({ method: 'POST', url: TEST_ROUTE, payload: {} }), response)
  } finally {
    globalThis.fetch = originalFetch
  }

  // The probe must hit the real business endpoint, not POST anything billable.
  assert.equal(seen.url, 'https://api.ai3d.cloud.tencent.com/v1/ai3d/query')
  assert.equal(seen.method, 'POST')
  assert.equal(seen.authorization, 'sk-probe')
  assert.deepEqual(JSON.parse(seen.body), { JobId: 'connectivity-probe-does-not-exist' })
  const payload = response.json()
  assert.equal(payload.ok, true)
  assert.ok(response.body.includes('sk-probe') === false, 'the probe response echoed the key')
})

test('connectivity probe fails loudly, naming the status and the service body', async () => {
  const store = new Map([['HUNYUAN3D_API_KEY', 'sk-probe']])
  let settings = normalizeSettings({ provider: 'compatible' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: 'base url is required', type: 'invalid_request_error' } }),
  })
  const ctx = { credentials: { async resolve(ref) { return store.has(ref) ? { value: store.get(ref) } : undefined } } }
  const routes = makeRoutes({
    credentials: ctx.credentials,
    getSettings: () => ({ ...settings }),
    updateSettings: async (patch) => { settings = normalizeSettings({ ...settings, ...patch }); return { ...settings } },
    describeCredential: async () => ({ configured: true, writable: true }),
    setCredential: async () => {},
    unsetCredential: async () => {},
  })
  const response = fakeResponse()
  try {
    await routes.find(entry => entry.path === TEST_ROUTE).handler(fakeRequest({ method: 'POST', url: TEST_ROUTE, payload: {} }), response)
  } finally {
    globalThis.fetch = originalFetch
  }
  const payload = response.json()
  assert.equal(payload.ok, false)
  // The service's own message is the whole point: it is what makes a 400 fixable.
  assert.ok(payload.message.includes('base url is required'), `message lost the service detail: ${payload.message}`)
  assert.ok(payload.message.includes('HTTP 400'), `message lost the status: ${payload.message}`)
})


test('base URL normalization survives a pasted API path', async () => {
  const { normalizeBaseUrl } = await import('../src/compatible.js')
  const origin = 'https://api.ai3d.cloud.tencent.com'
  for (const pasted of [
    origin,
    `${origin}/`,
    `${origin}/v1`,
    `${origin}/v1/ai3d`,
    `${origin}/v1/ai3d/submit`,
    `${origin}/v1/ai3d/query`,
    '',
    '   ',
  ]) {
    assert.equal(normalizeBaseUrl(pasted), origin, `failed to normalize ${JSON.stringify(pasted)}`)
  }
  // A non-Tencent gateway is left alone apart from the trailing slash.
  assert.equal(normalizeBaseUrl('https://proxy.internal/hunyuan/'), 'https://proxy.internal/hunyuan')
})

test('the settings schema accepts a pasted base URL with the API path', () => {
  const origin = 'https://api.ai3d.cloud.tencent.com'
  for (const pasted of [origin, `${origin}/`, `${origin}/v1`, `${origin}/v1/ai3d`, `${origin}/v1/ai3d/submit`]) {
    assert.equal(SettingsSchema({ baseUrl: pasted }).baseUrl.replace(/\/+$/, ''), pasted.replace(/\/+$/, ''))
  }
  assert.throws(() => SettingsSchema({ baseUrl: 'ftp://x' }), /must be an http\(s\) URL/)
  assert.throws(() => SettingsSchema({ baseUrl: 'not a url' }), /must be an http\(s\) URL/)
})
