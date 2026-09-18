/**
 * Mock Tencent Hunyuan 3D service.
 *
 * Serves both documented front doors to the same job model:
 *
 *   native      `POST /` with `X-TC-Action` + a TC3 authorization header
 *   compatible `POST /v1/ai3d/{submit,query}` with an `Authorization` API key
 *
 * so the whole plugin path — both transports, submit, poll, download, schema
 * validation — is verified without spending real credits. It is a test double,
 * not a simulator: it does not model the service's own validation rules.
 *
 * Library use: `const mock = await startMockServer({ delayMs: 200 })`.
 * Standalone use: `node tests/mock-ai3d.mjs [--port 0] [--delay-ms 300] [--fail]`.
 */

import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const GLB_FIXTURE = Buffer.from('glTF mock hunyuan3d asset', 'utf8')

/** Mirror the SDK's own header checks so a signing regression fails the test. */
function authorizationProblems(authorization, expected) {
  if (typeof authorization !== 'string' || authorization === '') return ['missing Authorization header']
  const problems = []
  if (!authorization.startsWith(`TC3-HMAC-SHA256 Credential=${expected.secretId}/${expected.date}/${expected.service}/tc3_request`)) {
    problems.push(`credential scope mismatch: ${authorization.slice(0, 120)}`)
  }
  if (!authorization.includes('SignedHeaders=content-type;host')) problems.push('signed headers mismatch')
  if (!/Signature=[0-9a-f]{64}$/.test(authorization)) problems.push('signature is not a sha256 hex digest')
  return problems
}

/** @param {string | undefined} url */
function isAssetRequest(url) {
  return url !== undefined && url.endsWith('.glb')
}

/**
 * Start one isolated double.
 * @param {{ port?: number, delayMs?: number, fail?: boolean, secretId?: string, service?: string, apiKey?: string }} [initial]
 */
export async function startMockServer(initial = {}) {
  const options = {
    port: 0,
    delayMs: 300,
    fail: false,
    secretId: 'AKIDmock',
    service: 'ai3d',
    apiKey: 'sk-mockkey',
    ...initial,
  }
  /** @type {Map<string, { polls: number, createdAt: number, mode: string }>} */
  const jobs = new Map()
  /** Native-door requests (X-TC-Action). @type {Array<Record<string, unknown>>} */
  const requests = []
  /** Compatible-door requests (/v1/ai3d/*). @type {Array<Record<string, unknown>>} */
  const compatibleRequests = []
  let sequence = 0
  let baseUrl = ''

  /**
   * The OpenAI-compatible door: API key on `Authorization` (bare, as the
   * documentation's cURL sends it, or `Bearer`-prefixed as OpenAI clients do),
   * the documented paths, and a bare unwrapped response body.
   */
  const handleCompatible = (request, response, raw) => {
    /** @type {Record<string, unknown>} */
    let body = {}
    try {
      body = raw === '' ? {} : JSON.parse(raw)
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'body is not JSON', type: 'invalid_request_error' } }))
      return
    }

    const authorization = String(request.headers.authorization ?? '')
    compatibleRequests.push({ path: request.url, authorization, body })

    const presented = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : authorization
    const respond = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(payload))
    }
    if (presented !== options.apiKey) {
      respond(401, {
        error: {
          message: `Incorrect API key provided: ${presented === '' ? '.' : presented}`,
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      })
      return
    }

    if (request.url === '/v1/ai3d/submit') {
      const jobId = `mock-compat-${++sequence}`
      jobs.set(jobId, { polls: 0, createdAt: Date.now(), mode: 'pro' })
      respond(200, { JobId: jobId, RequestId: `mock-${sequence}` })
      return
    }
    if (request.url !== '/v1/ai3d/query') {
      respond(404, { error: { message: `unknown path ${request.url}`, type: 'invalid_request_error' } })
      return
    }

    const jobId = typeof body.JobId === 'string' ? body.JobId : ''
    const job = jobs.get(jobId)
    if (job === undefined) {
      respond(200, { Status: 'FAIL', ErrorCode: 'ResourceNotFound.Job', ErrorMessage: `job ${jobId} not found` })
      return
    }
    job.polls += 1
    if (Date.now() - job.createdAt < options.delayMs) {
      respond(200, { Status: job.polls === 1 ? 'WAIT' : 'RUN' })
      return
    }
    if (options.fail) {
      respond(200, { Status: 'FAIL', ErrorCode: 'FailedOperation.GenerateFailed', ErrorMessage: 'mock generation failure' })
      return
    }
    respond(200, {
      Status: 'DONE',
      ResultFile3Ds: [
        { Type: 'GLB', Url: `${baseUrl}/assets/${jobId}.glb`, PreviewImageUrl: `${baseUrl}/assets/${jobId}.png` },
        { Type: 'OBJ', Url: `data:model/obj;base64,${Buffer.from('# mock obj\nv 0 0 0\n').toString('base64')}` },
      ],
      ResultCreditConsumed: 20,
      ResultCreditDetails: '{"GenerateType-Normal":20}',
      RequestId: `mock-${sequence}`,
    })
  }

  const server = createServer((request, response) => {
    // Generated assets, fetched by the plugin after DONE.
    if (request.method === 'GET') {
      if (isAssetRequest(request.url)) {
        response.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': GLB_FIXTURE.byteLength })
        response.end(GLB_FIXTURE)
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }

    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (request.url?.startsWith('/v1/ai3d/') === true) {
        handleCompatible(request, response, raw)
        return
      }

      /** @type {Record<string, unknown>} */
      let body = {}
      try {
        body = raw === '' ? {} : JSON.parse(raw)
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ Response: { Error: { Code: 'InvalidParameter', Message: 'body is not JSON' } } }))
        return
      }

      const action = String(request.headers['x-tc-action'] ?? '')
      const timestamp = Number(request.headers['x-tc-timestamp'] ?? 0)
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
      requests.push({
        action,
        region: request.headers['x-tc-region'],
        version: request.headers['x-tc-version'],
        contentType: request.headers['content-type'],
        authorization: String(request.headers.authorization ?? ''),
        body,
      })

      const problems = authorizationProblems(String(request.headers.authorization ?? ''), {
        secretId: options.secretId,
        service: options.service,
        date,
      })
      if (action === '') problems.push('missing X-TC-Action header')
      const respond = (payload) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ Response: { RequestId: `mock-${++sequence}`, ...payload } }))
      }
      if (problems.length > 0) {
        respond({ Error: { Code: 'AuthFailure.SignatureFailure', Message: problems.join('; ') } })
        return
      }

      if (action === 'SubmitHunyuanTo3DProJob' || action === 'SubmitHunyuanTo3DRapidJob') {
        const mode = action.includes('Rapid') ? 'rapid' : 'pro'
        const jobId = `mock-job-${mode}-${++sequence}`
        jobs.set(jobId, { polls: 0, createdAt: Date.now(), mode })
        respond({ JobId: jobId })
        return
      }

      if (action === 'QueryHunyuanTo3DProJob' || action === 'QueryHunyuanTo3DRapidJob') {
        const jobId = typeof body.JobId === 'string' ? body.JobId : ''
        const job = jobs.get(jobId)
        if (job === undefined) {
          respond({ Error: { Code: 'ResourceNotFound.Job', Message: `job ${jobId} not found` } })
          return
        }
        job.polls += 1
        // A real modeling run takes minutes; `delayMs` is how long this double
        // pretends to work, deliberately longer than one poll interval.
        if (Date.now() - job.createdAt < options.delayMs) {
          respond({ Status: job.polls === 1 ? 'WAIT' : 'RUN' })
          return
        }
        if (options.fail) {
          respond({ Status: 'FAIL', ErrorCode: 'FailedOperation.GenerateFailed', ErrorMessage: 'mock generation failure' })
          return
        }
        respond({
          Status: 'DONE',
          ResultFile3Ds: [
            { Type: 'GLB', Url: `${baseUrl}/assets/${jobId}.glb`, PreviewImageUrl: `${baseUrl}/assets/${jobId}.png` },
            { Type: 'OBJ', Url: `data:model/obj;base64,${Buffer.from('# mock obj\nv 0 0 0\n').toString('base64')}` },
          ],
          ...(job.mode === 'pro' ? { ResultCreditConsumed: 20, ResultCreditDetails: 'Generate-Normal:20' } : {}),
        })
        return
      }

      respond({ Error: { Code: 'InvalidAction', Message: `unsupported action ${action}` } })
    })
  })

  await new Promise(resolve => server.listen(options.port, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port
  baseUrl = `http://127.0.0.1:${port}`

  return {
    server,
    port,
    baseUrl,
    host: `127.0.0.1:${port}`,
    options,
    jobs,
    requests,
    compatibleRequests,
    async close() {
      await new Promise(resolve => server.close(resolve))
    },
  }
}

// Standalone mode for manual probing: announce the bound port on stdout.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = name => {
    const index = process.argv.indexOf(name)
    return index < 0 ? undefined : process.argv[index + 1]
  }
  const mock = await startMockServer({
    ...(flag('--port') === undefined ? {} : { port: Number(flag('--port')) }),
    ...(flag('--delay-ms') === undefined ? {} : { delayMs: Number(flag('--delay-ms')) }),
    fail: process.argv.includes('--fail'),
  })
  process.stdout.write(`${JSON.stringify({ ready: true, host: '127.0.0.1', port: mock.port, baseUrl: mock.baseUrl })}\n`)
}
