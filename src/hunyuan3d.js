/**
 * Tencent Cloud Hunyuan 3D (混元生3D) client for the `ai3d` OpenAPI.
 *
 * Endpoint contract pinned from `tencentcloud-sdk-nodejs-ai3d` v4.1.310
 * (`services/ai3d/v20250513`):
 *   host          ai3d.tencentcloudapi.com
 *   version       2025-05-13
 *   service       ai3d
 *   submit        SubmitHunyuanTo3DProJob   / SubmitHunyuanTo3DRapidJob
 *   query         QueryHunyuanTo3DProJob    / QueryHunyuanTo3DRapidJob
 *   status        WAIT | RUN | FAIL | DONE
 *   result        ResultFile3Ds[{ Type, Url, PreviewImageUrl }]  (URL valid 24h)
 *   response      JobId, RequestId, ErrorCode, ErrorMessage,
 *                 ResultCreditConsumed, ResultCreditDetails (Pro only)
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildAuthorization } from './tc3.js'

export const DEFAULT_ENDPOINT = 'ai3d.tencentcloudapi.com'
export const API_VERSION = '2025-05-13'
export const API_SERVICE = 'ai3d'

/** Error whose `code` is stable for the agent and the UI to branch on. */
export class Hunyuan3DError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {{ requestId?: string, retryable?: boolean }} [meta]
   */
  constructor(message, code, meta = {}) {
    super(message)
    this.name = 'Hunyuan3DError'
    this.code = code
    if (meta.requestId !== undefined) this.requestId = meta.requestId
    this.retryable = meta.retryable ?? false
  }
}

const PRO_MODES = new Set(['pro', 'rapid'])

/**
 * Resolve one credential value: the credential store's reference first, then
 * the ambient process environment.
 *
 * The store is *passed in*, never read off a context: Cordis isolates services
 * per fiber, so touching `ctx.credentials` on a context that did not declare it
 * throws (`cannot get property "credentials" without inject`). Callers reach it
 * through `ctx.inject(['credentials'], …)` and hand it here.
 * @param {{ describe?: Function, resolve?: Function } | undefined} store
 * @param {string} ref - credential reference (an environment-variable name).
 * @returns {Promise<string | undefined>}
 */
async function resolveSecret(store, ref) {
  if (typeof ref !== 'string' || ref.trim() === '') return undefined
  if (typeof store?.resolve === 'function') {
    // `describe` first so a reference the store does not hold is an ordinary
    // miss rather than an error, and a partial seam still behaves.
    let configured = true
    if (typeof store.describe === 'function') {
      configured = await store.describe(ref).then((info) => info?.configured === true).catch(() => false)
    }
    if (configured) {
      const hit = await store.resolve(ref).catch(() => undefined)
      if (typeof hit?.value === 'string' && hit.value.trim() !== '') return hit.value.trim()
    }
  }
  const ambient = process.env[ref]
  return typeof ambient === 'string' && ambient.trim() !== '' ? ambient.trim() : undefined
}

/**
 * Load the credential set the selected provider needs, or explain what is missing.
 * @param {{ describe?: Function, resolve?: Function } | undefined} store - the credential store.
 * @param {{ provider?: string, apiKeyRef?: string, secretIdRef: string, secretKeyRef: string, tokenRef?: string }} refs
 */
export async function resolveCredentials(store, refs) {
  const hint = 'Open dsh Settings > Plugins > 腾讯云混元生3D and fill it in, or set the environment variable.'

  // The OpenAI-compatible door takes one console API key and nothing else.
  if (refs.provider === 'compatible') {
    const apiKey = await resolveSecret(store, refs.apiKeyRef)
    if (apiKey === undefined) {
      throw new Hunyuan3DError(`The Hunyuan 3D API key is not configured: missing ${refs.apiKeyRef}. ${hint}`, 'credentials-not-configured')
    }
    return { apiKey }
  }

  const [secretId, secretKey, token] = await Promise.all([
    resolveSecret(store, refs.secretIdRef),
    resolveSecret(store, refs.secretKeyRef),
    refs.tokenRef === undefined ? Promise.resolve(undefined) : resolveSecret(store, refs.tokenRef),
  ])
  const missing = []
  if (secretId === undefined) missing.push(`SecretId (${refs.secretIdRef})`)
  if (secretKey === undefined) missing.push(`SecretKey (${refs.secretKeyRef})`)
  if (missing.length > 0) {
    throw new Hunyuan3DError(`Tencent Cloud credentials are not configured: missing ${missing.join(' and ')}. ${hint}`, 'credentials-not-configured')
  }
  return { secretId, secretKey: /** @type {string} */ (secretKey), ...(token === undefined ? {} : { token }) }
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One signed OpenAPI call.
 * @param {object} input
 * @param {string} input.endpoint
 * @param {string} [input.scheme] - Transport scheme; defaults to https. Only a test double sets http.
 * @param {string} [input.service] - TC3 credential-scope service. Defaults to the endpoint's first label, which is `ai3d` for the real endpoint.
 * @param {string} input.region
 * @param {string} input.action
 * @param {Record<string, unknown>} input.payload
 * @param {{ secretId: string, secretKey: string, token?: string }} input.credentials
 * @param {number} input.timeoutMs
 * @param {AbortSignal | undefined} input.signal
 * @param {typeof fetch} [input.fetchImpl]
 * @returns {Promise<Record<string, unknown>>} the `Response` object of the OpenAPI envelope.
 */
export async function callApi(input) {
  const { endpoint, region, action, credentials, timeoutMs, signal, fetchImpl = fetch, scheme = 'https' } = input
  const service = input.service ?? endpoint.split('.')[0] ?? API_SERVICE
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify(input.payload)
  const contentType = 'application/json; charset=utf-8'
  const authorization = buildAuthorization({
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
    service,
    host: endpoint,
    action,
    version: API_VERSION,
    region,
    payload: body,
    timestamp,
    contentType,
    ...(credentials.token === undefined ? {} : { token: credentials.token }),
  })

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const composed = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])

  /** @type {Response} */
  let response
  try {
    response = await fetchImpl(`${scheme}://${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': contentType,
        Host: endpoint,
        'X-TC-Action': action,
        'X-TC-Version': API_VERSION,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': region,
        ...(credentials.token === undefined ? {} : { 'X-TC-Token': credentials.token }),
      },
      body,
      signal: composed,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const timedOut = timeoutSignal.aborted
    throw new Hunyuan3DError(
      timedOut
        ? `Hunyuan 3D request ${action} timed out after ${timeoutMs}ms.`
        : `Hunyuan 3D request ${action} failed before a response: ${reason}`,
      timedOut ? 'request-timeout' : 'network-error',
      { retryable: true },
    )
  }

  const text = await response.text()
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Hunyuan3DError(
      `Hunyuan 3D returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 300)}`,
      'malformed-response',
      { retryable: response.status >= 500 },
    )
  }
  const envelopeResponse = isRecord(parsed) && isRecord(parsed.Response) ? parsed.Response : undefined
  if (envelopeResponse === undefined) {
    throw new Hunyuan3DError(
      `Hunyuan 3D returned an unexpected envelope (HTTP ${response.status}): ${text.slice(0, 300)}`,
      'malformed-response',
    )
  }

  const requestId = typeof envelopeResponse.RequestId === 'string' ? envelopeResponse.RequestId : undefined
  const error = isRecord(envelopeResponse.Error) ? envelopeResponse.Error : undefined
  if (error !== undefined) {
    const code = typeof error.Code === 'string' ? error.Code : 'api-error'
    const message = typeof error.Message === 'string' ? error.Message : 'Hunyuan 3D request was rejected.'
    throw new Hunyuan3DError(`Hunyuan 3D ${action} rejected: [${code}] ${message}`, code, {
      ...(requestId === undefined ? {} : { requestId }),
      retryable: /RequestLimitExceeded|InternalError|FailedOperation\.Timeout/i.test(code),
    })
  }
  return envelopeResponse
}

/**
 * Submit one modeling job.
 * @param {object} input
 * @param {'pro' | 'rapid'} input.mode
 * @param {Record<string, unknown>} input.payload
 * @returns {Promise<{ jobId: string, requestId?: string, action: string }>}
 */
export async function submitJob(input) {
  const action = input.mode === 'rapid' ? 'SubmitHunyuanTo3DRapidJob' : 'SubmitHunyuanTo3DProJob'
  const response = await callApi({ ...input, action })
  const jobId = response.JobId
  if (typeof jobId !== 'string' || jobId === '') {
    throw new Hunyuan3DError(`Hunyuan 3D ${action} returned no JobId.`, 'malformed-response', {
      ...(typeof response.RequestId === 'string' ? { requestId: response.RequestId } : {}),
    })
  }
  return {
    jobId,
    action,
    ...(typeof response.RequestId === 'string' ? { requestId: response.RequestId } : {}),
  }
}

/** @typedef {{ type?: string, url?: string, previewImageUrl?: string }} ResultFile */

/**
 * Query one job.
 * @param {object} input
 * @param {'pro' | 'rapid'} input.mode
 * @param {string} input.jobId
 * @returns {Promise<{ status: string, errorCode?: string, errorMessage?: string, files: ResultFile[], credits?: number, creditDetails?: string, requestId?: string }>}
 */
export async function queryJob(input) {
  const action = input.mode === 'rapid' ? 'QueryHunyuanTo3DRapidJob' : 'QueryHunyuanTo3DProJob'
  const response = await callApi({ ...input, action, payload: { JobId: input.jobId } })
  const status = typeof response.Status === 'string' ? response.Status : 'UNKNOWN'
  const rawFiles = Array.isArray(response.ResultFile3Ds) ? response.ResultFile3Ds : []
  const files = rawFiles.filter(isRecord).map(file => ({
    ...(typeof file.Type === 'string' ? { type: file.Type } : {}),
    ...(typeof file.Url === 'string' ? { url: file.Url } : {}),
    ...(typeof file.PreviewImageUrl === 'string' ? { previewImageUrl: file.PreviewImageUrl } : {}),
  }))
  return {
    status,
    action,
    files,
    ...(typeof response.ErrorCode === 'string' && response.ErrorCode !== '' ? { errorCode: response.ErrorCode } : {}),
    ...(typeof response.ErrorMessage === 'string' && response.ErrorMessage !== '' ? { errorMessage: response.ErrorMessage } : {}),
    ...(typeof response.ResultCreditConsumed === 'number' ? { credits: response.ResultCreditConsumed } : {}),
    ...(typeof response.ResultCreditDetails === 'string' && response.ResultCreditDetails !== '' ? { creditDetails: response.ResultCreditDetails } : {}),
    ...(typeof response.RequestId === 'string' ? { requestId: response.RequestId } : {}),
  }
}

/**
 * Poll until the job reaches a terminal status or the wait budget runs out.
 * @param {object} input
 * @param {number} input.waitMs
 * @returns {Promise<{ snapshot: Awaited<ReturnType<typeof queryJob>>, waitedMs: number, timedOut: boolean }>}
 */
export async function waitForJob(input) {
  const started = Date.now()
  const deadline = started + input.waitMs
  const query = input.queryJob ?? queryJob
  for (;;) {
    const snapshot = await query(input)
    if (snapshot.status === 'DONE' || snapshot.status === 'FAIL') {
      return { snapshot, waitedMs: Date.now() - started, timedOut: false }
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { snapshot, waitedMs: Date.now() - started, timedOut: true }
    const delay = Math.min(input.pollIntervalMs, remaining)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        input.signal?.removeEventListener('abort', onAbort)
        resolve(undefined)
      }, delay)
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Hunyuan3DError('Hunyuan 3D wait was cancelled.', 'cancelled'))
      }
      if (input.signal?.aborted === true) return onAbort()
      input.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

/**
 * Materialize one result file. `Url` may be an http(s) URL or a `data:`
 * base64 payload; both become a real file on disk.
 * @param {object} input
 * @param {{ url?: string, type?: string }} input.file
 * @param {string} input.directory
 * @param {string} input.jobId
 * @param {number} input.index
 * @param {number} input.timeoutMs
 * @param {AbortSignal | undefined} input.signal
 * @param {typeof fetch} [input.fetchImpl]
 * @returns {Promise<{ path: string, bytes: number }>}
 */
export async function saveResultFile(input) {
  const { file, directory, jobId, index, timeoutMs, signal, fetchImpl = fetch } = input
  const url = file?.url
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Hunyuan3DError('Hunyuan 3D reported a result file without a Url.', 'malformed-response')
  }
  let data
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    if (comma < 0) throw new Hunyuan3DError('Hunyuan 3D returned a malformed data URL.', 'malformed-response')
    const header = url.slice(5, comma)
    const payload = url.slice(comma + 1)
    data = header.endsWith(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')
  } else {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const composed = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
    const response = await fetchImpl(url, { signal: composed }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Hunyuan3DError(`Downloading the Hunyuan 3D result failed: ${reason}`, 'download-failed', { retryable: true })
    })
    if (!response.ok) {
      throw new Hunyuan3DError(
        `Downloading the Hunyuan 3D result failed with HTTP ${response.status}. Result URLs expire 24 hours after generation; re-run the job if it has expired.`,
        'download-failed',
        { retryable: response.status >= 500 },
      )
    }
    data = Buffer.from(await response.arrayBuffer())
  }

  await mkdir(directory, { recursive: true })
  const extension = extensionFor(input.file.type, url)
  const target = path.join(directory, `hunyuan3d-${jobId.slice(0, 12)}-${index + 1}${extension}`)
  await writeFile(target, data)
  return { path: target, bytes: data.byteLength }
}

/** Pick an on-disk extension from the declared type, else the URL path. */
export function extensionFor(type, url) {
  const declared = typeof type === 'string' ? type.trim().toLowerCase().replace(/^\./, '') : ''
  if (/^[a-z0-9]{1,8}$/.test(declared)) return `.${declared}`
  const fromUrl = /\.([a-z0-9]{1,8})(?:\?|#|$)/i.exec(url)
  return fromUrl === null ? '.glb' : `.${fromUrl[1].toLowerCase()}`
}

/** Normalize the caller's `mode` argument. */
export function normalizeMode(value) {
  if (value === undefined || value === null || value === '') return 'pro'
  const mode = String(value).toLowerCase()
  if (!PRO_MODES.has(mode)) {
    throw new Hunyuan3DError(`Unknown mode "${value}". Use "pro" (highest quality, most control) or "rapid" (fast draft).`, 'invalid-argument')
  }
  return /** @type {'pro' | 'rapid'} */ (mode)
}
