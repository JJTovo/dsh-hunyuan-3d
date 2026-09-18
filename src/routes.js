/**
 * The `/api/dsh-hunyuan-3d` route family: a loopback-fenced bridge between the
 * browser settings card and the host's settings + credential seams.
 *
 * Secret *values* never travel host-to-browser: `credentials/set` accepts one,
 * and every response reports only whether a reference is configured and whether
 * it is writable. That is the same rule the shipped configuration cards follow.
 */

import { DEFAULT_SECRET_ID_REF, DEFAULT_SECRET_KEY_REF, DEFAULT_TOKEN_REF, DEFAULT_API_KEY_REF } from './settings.js'
import { COMPATIBLE_BASE_URL, normalizeBaseUrl, probeCredentials } from './compatible.js'
import { DEFAULT_ENDPOINT, API_VERSION, Hunyuan3DError, callApi, resolveCredentials } from './hunyuan3d.js'

export const SETTINGS_ROUTE = '/api/dsh-hunyuan-3d/settings'
export const CREDENTIALS_ROUTE = '/api/dsh-hunyuan-3d/credentials'
export const TEST_ROUTE = '/api/dsh-hunyuan-3d/test'

const MAX_JSON_BODY_BYTES = 64 * 1024

/** Loopback literal check plus browser same-origin markers (mirrors dsh-ssh). */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const originUrl = new URL(origin)
    return originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost' || originUrl.hostname === '[::1]'
  } catch {
    return false
  }
}

/** @param {import('node:http').ServerResponse} response */
function writeJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

/** @param {import('node:http').IncomingMessage} request */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_JSON_BODY_BYTES) throw new Hunyuan3DError('request body is too large', 'bad-request')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Hunyuan3DError('request body is not JSON', 'bad-request')
  }
}

/**
 * Build the plugin's route registrations.
 * @param {object} deps
 * @param {() => Record<string, unknown>} deps.getSettings - current resolved settings.
 * @param {(patch: Record<string, unknown>) => Promise<Record<string, unknown>>} deps.updateSettings
 * @param {(ref: string) => Promise<{ configured: boolean, source?: string, writable: boolean }>} deps.describeCredential
 * @param {(ref: string, value: string) => Promise<void>} deps.setCredential
 * @param {(ref: string) => Promise<void>} deps.unsetCredential
 * @param {{ describe?: Function, resolve?: Function } | undefined} deps.credentials - the credential store.
 * @param {(() => { active: number, queued: number, maxConcurrency: number }) | undefined} [deps.getConcurrency] - live slot usage.
 * @returns {Array<import('@deepseek-ai/dsh-host-webserver').WebRoute>}
 */
export function makeRoutes(deps) {
  const guard = (request, response, method) => {
    if (!isLoopbackRequest(request)) {
      writeJson(response, 403, { ok: false, code: 'forbidden', message: 'forbidden: loopback-only' })
      return false
    }
    if (request.method !== method) {
      writeJson(response, 405, { ok: false, code: 'method-not-allowed', message: `method not allowed: ${request.method}` })
      return false
    }
    return true
  }

  /** Report the status of every credential reference the plugin reads. */
  const credentialStatus = async () => {
    const settings = deps.getSettings()
    const refs = settings.provider === 'compatible'
      ? [{ role: 'apiKey', ref: String(settings.apiKeyRef ?? DEFAULT_API_KEY_REF) }]
      : [
        { role: 'secretId', ref: String(settings.secretIdRef ?? DEFAULT_SECRET_ID_REF) },
        { role: 'secretKey', ref: String(settings.secretKeyRef ?? DEFAULT_SECRET_KEY_REF) },
        { role: 'token', ref: String(settings.tokenRef ?? DEFAULT_TOKEN_REF) },
      ]
    const entries = await Promise.all(refs.map(async (entry) => {
      const info = await deps.describeCredential(entry.ref).catch(() => ({ configured: false, writable: false }))
      return [entry.role, { ref: entry.ref, configured: info.configured === true, writable: info.writable === true, ...info.source === undefined ? {} : { source: info.source } }]
    }))
    return Object.fromEntries(entries)
  }

  return [
    {
      kind: 'exact',
      path: SETTINGS_ROUTE,
      handler: async (request, response) => {
        if (request.method === 'GET') {
          if (!guard(request, response, 'GET')) return
          writeJson(response, 200, {
            ok: true,
            settings: deps.getSettings(),
            credentials: await credentialStatus(),
            ...deps.getConcurrency === undefined ? {} : { concurrency: deps.getConcurrency() },
          })
          return
        }
        if (!guard(request, response, 'POST')) return
        try {
          const body = await readJsonBody(request)
          const patch = typeof body?.settings === 'object' && body.settings !== null ? body.settings : body
          const settings = await deps.updateSettings(patch ?? {})
          writeJson(response, 200, { ok: true, settings, credentials: await credentialStatus() })
        } catch (error) {
          writeJson(response, 200, {
            ok: false,
            code: error instanceof Hunyuan3DError ? error.code : 'invalid-settings',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: CREDENTIALS_ROUTE,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return
        let body
        try {
          body = await readJsonBody(request)
        } catch (error) {
          writeJson(response, 200, { ok: false, code: 'bad-request', message: error instanceof Error ? error.message : String(error) })
          return
        }
        const role = typeof body?.role === 'string' ? body.role : ''
        const settings = deps.getSettings()
        const ref = role === 'apiKey' ? settings.apiKeyRef
          : role === 'secretId' ? settings.secretIdRef
            : role === 'secretKey' ? settings.secretKeyRef
              : role === 'token' ? settings.tokenRef
                : undefined
        if (typeof ref !== 'string' || ref === '') {
          writeJson(response, 200, { ok: false, code: 'bad-request', message: 'role must be apiKey, secretId, secretKey or token' })
          return
        }
        try {
          const action = typeof body?.action === 'string' ? body.action : 'set'
          if (action === 'unset') await deps.unsetCredential(ref)
          else if (action === 'set') {
            const value = typeof body?.value === 'string' ? body.value.trim() : ''
            if (value === '') {
              writeJson(response, 200, { ok: false, code: 'bad-request', message: 'value must not be empty' })
              return
            }
            await deps.setCredential(ref, value)
          } else {
            writeJson(response, 200, { ok: false, code: 'bad-request', message: `unknown action ${action}` })
            return
          }
          writeJson(response, 200, { ok: true, credentials: await credentialStatus() })
        } catch (error) {
          writeJson(response, 200, {
            ok: false,
            code: 'credential-write-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
    {
      kind: 'exact',
      path: TEST_ROUTE,
      handler: async (request, response) => {
        if (!guard(request, response, 'POST')) return
        const settings = deps.getSettings()
        try {
          const credentials = await resolveCredentials(deps.credentials, {
            provider: String(settings.provider),
            apiKeyRef: String(settings.apiKeyRef),
            secretIdRef: String(settings.secretIdRef),
            secretKeyRef: String(settings.secretKeyRef),
            tokenRef: String(settings.tokenRef),
          })

          if (settings.provider === 'compatible') {
            const baseUrl = normalizeBaseUrl(String(settings.baseUrl ?? COMPATIBLE_BASE_URL))
            const probe = await probeCredentials({ baseUrl, apiKey: credentials.apiKey, timeoutMs: 20_000 })
            writeJson(response, 200, probe)
            return
          }

          // Native door: reuse the job-query action on a non-existent id, which
          // authenticates without creating or billing anything.
          await callApi({
            endpoint: String(settings.endpoint ?? DEFAULT_ENDPOINT),
            region: String(settings.region),
            action: 'QueryHunyuanTo3DProJob',
            payload: { JobId: 'connectivity-probe-does-not-exist' },
            credentials,
            timeoutMs: 20_000,
            signal: undefined,
          })
          writeJson(response, 200, { ok: true, message: `已连通 ${settings.endpoint}（${API_VERSION}）。` })
        } catch (error) {
          const code = error instanceof Hunyuan3DError ? error.code : 'unknown'
          const message = error instanceof Error ? error.message : String(error)
          // An authenticated probe that is rejected for the bogus job id still
          // proves the credentials are good, so report that as a pass.
          const authenticated = /ResourceNotFound|InvalidParameter/i.test(code) || /ResourceNotFound|InvalidParameter/i.test(message)
          writeJson(response, 200, authenticated
            ? { ok: true, message: '凭据有效（探测请求被服务端拒绝，属预期）。' }
            : { ok: false, code, message })
        }
      },
    },
  ]
}
