/**
 * The OpenAI-compatible Hunyuan 3D transport.
 *
 * Tencent publishes two front doors to the same 3D service, and they share a
 * request/response vocabulary but not a transport:
 *
 *   native      POST https://ai3d.tencentcloudapi.com          TC3-HMAC-SHA256, X-TC-Action
 *   compatible  POST https://api.ai3d.cloud.tencent.com/v1/ai3d/submit   Authorization: <api key>
 *
 * The compatible door takes the API key from the console's "API KEY" page. The
 * documentation's cURL sends it as the bare `Authorization` value; OpenAI
 * clients send `Bearer <key>`, so both are accepted here — a gateway that
 * tolerates the other form is the only way both readings can work.
 *
 * Requests use the same PascalCase body the native API documents (`Prompt`,
 * `ImageUrl`, `MultiImageViews`, `FaceCount`, …), because the compatibility
 * layer forwards to that service. Responses are read tolerantly: the envelope
 * may be bare (`{ "JobId": … }`) or wrapped (`{ "Response": { … } }`), and the
 * casing of each key is accepted either way.
 */

import { Hunyuan3DError } from './hunyuan3d.js'

export const COMPATIBLE_BASE_URL = 'https://api.ai3d.cloud.tencent.com'
export const SUBMIT_PATH = '/v1/ai3d/submit'
export const QUERY_PATH = '/v1/ai3d/query'

/** The compatibility layer is the pro model only; `rapid` has no path here. */
export const COMPATIBLE_MODES = new Set(['pro'])

/**
 * Normalize the base URL. Accepts the bare origin the documentation states, but
 * also survives a paste that carries the API path with it (`…/v1`,
 * `…/v1/ai3d`, or the full `…/v1/ai3d/submit`): those suffixes are stripped
 * rather than duplicated into every request, because a doubled path is a routing
 * failure the service answers with an unhelpful 4xx.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBaseUrl(value) {
  const trimmed = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (trimmed === '') return COMPATIBLE_BASE_URL
  const stripped = trimmed
    .replace(/\/v1\/ai3d\/(submit|query)$/i, '')
    .replace(/\/v1\/ai3d$/i, '')
    .replace(/\/v1$/i, '')
  return stripped === '' ? COMPATIBLE_BASE_URL : stripped
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Unwrap the service envelope. Tencent Cloud's own compatible endpoints return
 * the bare object, while its native gateway wraps it in `Response`; a
 * compatibility layer in front of either may do both.
 * @param {unknown} parsed
 * @returns {Record<string, unknown>}
 */
export function unwrapEnvelope(parsed) {
  if (!isRecord(parsed)) {
    throw new Hunyuan3DError('Hunyuan 3D returned a non-object JSON body.', 'malformed-response')
  }
  const nested = parsed.Response
  return isRecord(nested) ? nested : parsed
}

/**
 * Read one key ignoring the casing convention the layer chose, so `JobId`,
 * `job_id` and `JOBID` all resolve.
 * @param {Record<string, unknown>} source
 * @param {string} name
 */
export function readKey(source, name) {
  if (name in source) return source[name]
  const lowered = name.toLowerCase()
  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase() === lowered) return value
  }
  return undefined
}

/** Read a string field, or undefined when absent/blank. @param {Record<string, unknown>} source @param {string} name */
function readText(source, name) {
  const value = readKey(source, name)
  if (typeof value === 'string') return value === '' ? undefined : value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** Read a finite number. @param {Record<string, unknown>} source @param {string} name */
function readNumber(source, name) {
  const value = readKey(source, name)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

/** Read one result-file array, tolerating `ResultFile3Ds` / `result_file3ds` / `files`. */
function readFiles(source) {
  for (const name of ['ResultFile3Ds', 'ResultFiles', 'Files']) {
    const value = readKey(source, name)
    if (Array.isArray(value)) {
      return value.filter(isRecord).map(file => ({
        ...readText(file, 'Type') === undefined ? {} : { type: readText(file, 'Type') },
        ...readText(file, 'Url') === undefined ? {} : { url: readText(file, 'Url') },
        ...readText(file, 'PreviewImageUrl') === undefined ? {} : { previewImageUrl: readText(file, 'PreviewImageUrl') },
      }))
    }
  }
  return []
}

/** The service error, wherever the layer put it. */
function readFailure(source) {
  const nested = readKey(source, 'Error')
  if (isRecord(nested)) {
    return {
      code: readText(nested, 'Code') ?? readText(nested, 'code') ?? 'api-error',
      message: readText(nested, 'Message') ?? readText(nested, 'message') ?? 'Hunyuan 3D request was rejected.',
      type: readText(nested, 'Type') ?? readText(nested, 'type'),
    }
  }
  const code = readText(source, 'ErrorCode')
  const message = readText(source, 'ErrorMessage')
  return code === undefined && message === undefined ? undefined : { code: code ?? 'api-error', message: message ?? '' }
}

/**
 * One request against the compatible door.
 * @param {object} input
 * @param {string} input.baseUrl
 * @param {string} input.path
 * @param {Record<string, unknown>} input.payload
 * @param {string} input.apiKey
 * @param {number} input.timeoutMs
 * @param {AbortSignal | undefined} input.signal
 * @param {typeof fetch} [input.fetchImpl]
 * @returns {Promise<Record<string, unknown>>} the unwrapped response body.
 */
async function request(input) {
  const { baseUrl, path, payload, apiKey, timeoutMs, signal, fetchImpl = fetch } = input
  const url = `${normalizeBaseUrl(baseUrl)}${path}`
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const composed = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])

  /**
   * The documentation's cURL sends the bare key, but this is an
   * OpenAI-compatible door and some gateway builds insist on `Bearer`. Send the
   * documented form first and retry once with the prefix only when the header
   * itself was refused, so a normal call never pays for the second round trip.
   */
  const attempt = async (authorization) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: composed,
    })
    if (response.status !== 401 && response.status !== 403) return response
    if (authorization.startsWith('Bearer ')) return response
    return await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: composed,
    })
  }

  /** @type {Response} */
  let response
  try {
    response = await attempt(apiKey)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const timedOut = timeoutSignal.aborted
    throw new Hunyuan3DError(
      timedOut
        ? `Hunyuan 3D request ${path} timed out after ${timeoutMs}ms.`
        : `Hunyuan 3D request ${path} failed before a response: ${reason}`,
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

  const body = unwrapEnvelope(parsed)
  const failure = readFailure(body)
  // A 401/403 is an authentication answer even when the body carries no error
  // object, and it is the one failure a user can fix from the settings card.
  if (failure !== undefined) {
    throw new Hunyuan3DError(
      `Hunyuan 3D ${path} rejected: [${failure.code}] ${failure.message} (HTTP ${response.status})`,
      failure.code,
      { retryable: /RequestLimitExceeded|InternalError|Timeout/i.test(failure.code) },
    )
  }
  if (!response.ok) {
    const detail = text.slice(0, 400)
    throw new Hunyuan3DError(
      response.status === 401 || response.status === 403
        ? `Hunyuan 3D rejected the API key (HTTP ${response.status}). Check the key in Settings > Plugins > 腾讯云混元生3D. ${detail}`
        : `Hunyuan 3D request ${path} failed with HTTP ${response.status}. ${detail}`,
      response.status === 401 || response.status === 403 ? 'auth-failed' : 'http-error',
      { retryable: response.status >= 500 },
    )
  }
  return body
}

/**
 * Submit one modeling job through the compatible door.
 * @returns {Promise<{ jobId: string, requestId?: string, action: string }>}
 */
export async function submitJob(input) {
  const body = await request({ ...input, path: SUBMIT_PATH })
  const jobId = readText(body, 'JobId') ?? readText(body, 'id')
  if (jobId === undefined) {
    throw new Hunyuan3DError(
      `Hunyuan 3D ${SUBMIT_PATH} returned no JobId. Response keys: ${Object.keys(body).join(', ') || '(none)'}`,
      'malformed-response',
    )
  }
  const requestId = readText(body, 'RequestId')
  return { jobId, action: SUBMIT_PATH, ...requestId === undefined ? {} : { requestId } }
}

/**
 * Query one job through the compatible door.
 * @returns {Promise<{ status: string, files: unknown[], errorCode?: string, errorMessage?: string, credits?: number, creditDetails?: string, requestId?: string }>}
 */
export async function queryJob(input) {
  const body = await request({ ...input, path: QUERY_PATH, payload: { JobId: input.jobId } })
  const status = (readText(body, 'Status') ?? 'UNKNOWN').toUpperCase()
  const errorCode = readText(body, 'ErrorCode')
  const errorMessage = readText(body, 'ErrorMessage')
  const credits = readNumber(body, 'ResultCreditConsumed')
  const creditDetails = readText(body, 'ResultCreditDetails')
  const requestId = readText(body, 'RequestId')
  return {
    status,
    action: QUERY_PATH,
    files: readFiles(body),
    ...errorCode === undefined ? {} : { errorCode },
    ...errorMessage === undefined ? {} : { errorMessage },
    ...credits === undefined ? {} : { credits },
    ...creditDetails === undefined ? {} : { creditDetails },
    ...requestId === undefined ? {} : { requestId },
  }
}

/**
 * Authenticate against the compatible door using a real business endpoint.
 *
 * `POST /v1/ai3d/query` with a JobId that cannot exist needs no other input and
 * is rejected by the service itself once the key is accepted, so it proves the
 * key without submitting — and therefore without billing — a job. `/v1/models`
 * is an inference-server convention this gateway may not route at all, which is
 * why the probe does not use it.
 *
 * @param {object} input
 * @param {string} input.baseUrl
 * @param {string} input.apiKey
 * @param {number} [input.timeoutMs]
 * @returns {Promise<{ ok: boolean, code?: string, message?: string }>}
 */
export async function probeCredentials(input) {
  const timeoutMs = input.timeoutMs ?? 20_000
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  try {
    await request({
      baseUrl,
      path: QUERY_PATH,
      payload: { JobId: 'connectivity-probe-does-not-exist' },
      apiKey: input.apiKey,
      timeoutMs,
      signal: undefined,
    })
    // A 200 for a bogus job id is unexpected but does mean the key was accepted.
    return { ok: true, message: `已连通 ${baseUrl}，API Key 有效。` }
  } catch (error) {
    const code = error instanceof Hunyuan3DError ? error.code : 'unknown'
    const message = error instanceof Error ? error.message : String(error)
    // The key was accepted: the service answered about the job, not the key.
    if (code === 'ResourceNotFound.Job' || /ResourceNotFound|任务不存在|job .* not found/i.test(message)) {
      return { ok: true, message: `已连通 ${baseUrl}，API Key 有效（探测任务不存在，属预期）。` }
    }
    return { ok: false, code, message: `${baseUrl}：${message}` }
  }
}
