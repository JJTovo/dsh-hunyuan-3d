/**
 * Contract + end-to-end verification for dsh-hunyuan-3d.
 *
 * Part 1 pins the wire format: the schemas this plugin registers by hand must be
 * accepted by the real dsh schema compiler and validator, both of which live in
 * the dsh checkout (`packages/core/tools/lib/index.js`).
 *
 * Part 2 drives the real plugin against a local mock `ai3d` service: a full
 * submit -> poll -> download -> result-schema cycle, plus the cancellation,
 * job-failure, credential and validation branches.
 *
 * Run: node --test tests/
 */

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { apply as applyPlugin } from '../src/index.js'
import { buildAuthorization, sha256Hex, utcDate } from '../src/tc3.js'
import { modelParameters, queryParameters, resultSchema } from '../src/schemas.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DSH_TOOLS_LIB = process.env.DSH_TOOLS_LIB
  ?? 'E:/deepseek_harness/packages/core/tools/lib/index.js'

/** dsh's own schema compiler, or undefined when the checkout is unavailable. */
async function loadDshTools() {
  if (!existsSync(DSH_TOOLS_LIB)) return undefined
  return await import(pathToFileURL(DSH_TOOLS_LIB).href)
}

const dshTools = await loadDshTools()

test('TC3 signer: deterministic string-to-sign and credential scope', () => {
  const input = {
    secretId: 'AKIDmock',
    secretKey: 'SECRETmock',
    service: 'ai3d',
    host: 'ai3d.tencentcloudapi.com',
    action: 'SubmitHunyuanTo3DProJob',
    version: '2025-05-13',
    region: 'ap-guangzhou',
    payload: '{"Prompt":"a cat"}',
    timestamp: 1_700_000_000,
  }
  const authorization = buildAuthorization(input)

  // Scope shape exactly as the official SDK builds it.
  assert.match(
    authorization,
    /^TC3-HMAC-SHA256 Credential=AKIDmock\/2023-11-14\/ai3d\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/,
  )

  // Independent recomputation of the documented algorithm.
  const canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:application/json; charset=utf-8\nhost:ai3d.tencentcloudapi.com\n',
    'content-type;host',
    sha256Hex(input.payload),
  ].join('\n')
  const stringToSign = [
    'TC3-HMAC-SHA256',
    '1700000000',
    '2023-11-14/ai3d/tc3_request',
    sha256Hex(canonicalRequest),
  ].join('\n')
  const kDate = createHmac('sha256', 'TC3SECRETmock').update('2023-11-14').digest()
  const kService = createHmac('sha256', kDate).update('ai3d').digest()
  const kSigning = createHmac('sha256', kService).update('tc3_request').digest()
  const expected = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  assert.ok(authorization.endsWith(`Signature=${expected}`), `signature mismatch:\n${authorization}\n${expected}`)
  assert.equal(utcDate(1_700_000_000), '2023-11-14')
  assert.equal(utcDate(1_700_000_000), new Date(1_700_000_000_000).toISOString().slice(0, 10))
})

test('registered schemas are valid dsh tool schemas', { skip: dshTools === undefined && `dsh checkout not found at ${DSH_TOOLS_LIB}` }, () => {
  const { validateJsonSchemaValue } = dshTools

  // A raw registration is handed straight to the executor, so the declared
  // shapes must already be in compiled (required-array) wire form.
  for (const [label, schema] of [['modelParameters', modelParameters], ['queryParameters', queryParameters], ['resultSchema', resultSchema]]) {
    assert.equal(schema.type, 'object', `${label} must be object-rooted`)
    for (const [name, property] of Object.entries(schema.properties)) {
      // A nested object legitimately carries a `required` ARRAY; only a leaf
      // property could wrongly carry the DSL's boolean form.
      if (property.type === 'object') {
        assert.ok(property.required === undefined || Array.isArray(property.required), `${label}.${name} nested required must be an array`)
        continue
      }
      assert.equal('required' in property, false, `${label}.${name} must not carry a boolean required`)
    }
    // `required` is present only when the tool declares required properties.
    assert.ok(schema.required === undefined || Array.isArray(schema.required), `${label} required must be an array`)
    for (const name of schema.required ?? []) {
      assert.ok(name in schema.properties, `${label} requires undeclared property ${name}`)
    }
    assert.equal(typeof validateJsonSchemaValue(schema, {}, '').length, 'number', `${label} must be walkable`)
  }

  // Representative calls and results must validate; typos would show up here.
  assert.deepEqual(validateJsonSchemaValue(modelParameters, { prompt: '一只宝箱' }, ''), [])
  assert.deepEqual(validateJsonSchemaValue(modelParameters, {
    mode: 'pro',
    multi_view_images: [{ view_type: 'left', image_url: 'https://example.com/l.png' }],
    face_count: 50_000,
    enable_pbr: true,
    wait: false,
  }, ''), [])
  assert.deepEqual(validateJsonSchemaValue(queryParameters, { job_id: 'mock-job-pro-1' }, ''), [])
  assert.deepEqual(validateJsonSchemaValue(resultSchema, {
    job_id: 'j1',
    mode: 'pro',
    status: 'DONE',
    message: 'ok',
    files: [{ type: 'GLB', path: 'C:/tmp/a.glb', bytes: 12 }],
  }, ''), [])

  // The strictness the model relies on.
  assert.ok(validateJsonSchemaValue(queryParameters, {}, '').length > 0, 'job_id must be required')
  assert.ok(validateJsonSchemaValue(resultSchema, { job_id: 'j1' }, '').length > 0, 'files must be required')

  // `ctx.tools.register()` runs these exact assertions on a raw definition.
  for (const [label, schema] of [['modelParameters', modelParameters], ['queryParameters', queryParameters], ['resultSchema', resultSchema]]) {
    assert.doesNotThrow(() => dshTools.assertSupportedJsonSchema(schema), `${label} must be a supported dsh schema`)
  }
})

test('tools are shaped like real dsh tool definitions', { skip: dshTools === undefined && `dsh checkout not found at ${DSH_TOOLS_LIB}` }, async () => {
  const harness = await bootHarness()
  try {
    const definitions = harness.registered
    assert.deepEqual(definitions.map(entry => entry.name).sort(), ['hunyuan_3d_model', 'hunyuan_3d_query'])
    for (const definition of definitions) {
      assert.equal(typeof definition.description, 'string')
      assert.ok(definition.description.length > 40, `${definition.name} needs a usable description`)
      assert.equal(definition.parameters.type, 'object')
      assert.equal(typeof definition.output.render, 'function')
      // The guard ctx.tools.register applies to every raw definition.
      assert.doesNotThrow(() => dshTools.assertSupportedJsonSchema(definition.output.schema), `${definition.name} output schema`)
      const blocks = definition.output.render({}, { job_id: 'j', mode: 'pro', status: 'DONE', message: 'm', files: [] })
      assert.equal(blocks[0].type, 'text')
      assert.match(blocks[0].text, /hunyuan/i)
    }
  } finally {
    await harness.close()
  }
})

/**
 * Boot one isolated mock service plus the real plugin.
 * @param {{ fail?: boolean, delayMs?: number, provider?: 'native' | 'compatible' }} [options]
 */
async function bootHarness(options = {}) {
  const provider = options.provider ?? 'native'
  const { startMockServer } = await import('./mock-ai3d.mjs')
  const mock = await startMockServer({ delayMs: options.delayMs ?? 400, fail: options.fail ?? false })

  const resultDir = await mkdtemp(path.join(tmpdir(), 'hunyuan3d-'))
  const tools = new Map()
  /** @type {Array<any>} */
  const registered = []
  const ctx = {
    tools: {
      register: definition => {
        registered.push(definition)
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    // A minimal in-memory credential store, so the card's bridge is exercised
    // against the same seam the host provides.
    credentials: {
      store: new Map(),
      async describe(ref) { return { configured: ctx.credentials.store.has(ref), writable: true } },
      async resolve(ref) { return ctx.credentials.store.has(ref) ? { value: ctx.credentials.store.get(ref) } : undefined },
      async set(ref, value) { ctx.credentials.store.set(ref, value) },
      async unset(ref) { ctx.credentials.store.delete(ref) },
    },
    // Cordis's soft-dependency form: run the callback once the named services
    // exist. Stubbed as always-available, which is the web host's situation.
    inject: (deps, callback) => {
      // Mirror Cordis: run once every named service is present, handing the
      // callback the same context (which carries them all here).
      const available = deps.every(name => ctx[name] !== undefined)
      if (available) callback(ctx)
      return () => {}
    },
    systemPrompt: { section: () => () => {} },
    settings: {
      installed: null,
      installSection(owner, ns, schema, entry, hooks) {
        ctx.settings.installed = { ns, schema, entry, hooks }
        hooks.setSource(() => schema(entry))
      },
      async update(ns, patch) {
        const installed = ctx.settings.installed
        if (installed === null || installed.ns !== ns) throw new Error(`namespace ${ns} is not registered`)
        installed.entry = { ...installed.entry, ...patch }
        installed.hooks.setSource(() => installed.schema(installed.entry))
      },
    },
    webServer: { routes: [], register: route => { ctx.webServer.routes.push(route); return () => {} } },
    get: name => ctx[name],
  }
  process.env.DSH_HUNYUAN3D_SCHEME = 'http'
  process.env.DSH_HUNYUAN3D_BASE_URL = mock.baseUrl
  const dispose = applyPlugin(ctx, {
    provider,
    endpoint: mock.host,
    baseUrl: mock.baseUrl,
    region: 'ap-guangzhou',
    resultDir,
    pollIntervalMs: 40,
    httpTimeoutMs: 10_000,
  })
  process.env.TENCENTCLOUD_SECRET_ID = 'AKIDmock'
  process.env.TENCENTCLOUD_SECRET_KEY = 'SECRETmock'
  process.env.HUNYUAN3D_API_KEY = 'sk-mockkey'

  return {
    ctx,
    tools,
    registered,
    routes: ctx.webServer.routes,
    requests: mock.requests,
    compatibleRequests: mock.compatibleRequests,
    baseUrl: mock.baseUrl,
    resultDir,
    async close() {
      dispose()
      delete process.env.TENCENTCLOUD_SECRET_ID
      delete process.env.TENCENTCLOUD_SECRET_KEY
      delete process.env.DSH_HUNYUAN3D_SCHEME
      delete process.env.DSH_HUNYUAN3D_BASE_URL
      delete process.env.HUNYUAN3D_API_KEY
      await rm(resultDir, { recursive: true, force: true })
      await mock.close()
    },
  }
}

/** Run a registered tool the way the executor does: validate, then execute. */
async function runTool(harness, name, args) {
  const definition = harness.tools.get(name)
  assert.ok(definition !== undefined, `tool ${name} was not registered`)
  const violations = dshTools === undefined ? [] : dshTools.validateJsonSchemaValue(definition.parameters, args, '')
  assert.deepEqual(violations, [], `${name} arguments must validate: ${violations.join('; ')}`)
  const value = await definition.execute(args, { signal: undefined })
  if (dshTools !== undefined) {
    const resultViolations = dshTools.validateJsonSchemaValue(definition.output.schema, value, '')
    assert.deepEqual(resultViolations, [], `${name} result must satisfy its declared schema: ${resultViolations.join('; ')}`)
  }
  return value
}

test('end-to-end: text-to-3D submit, poll and download', async () => {
  const harness = await bootHarness()
  try {
    assert.deepEqual([...harness.tools.keys()].sort(), ['hunyuan_3d_model', 'hunyuan_3d_query'])

    const result = await runTool(harness, 'hunyuan_3d_model', { prompt: '一只低多边形的宝箱', result_format: 'GLB', timeout_ms: 30_000 })

    assert.equal(result.status, 'DONE')
    assert.equal(result.mode, 'pro')
    assert.match(result.job_id, /^mock-job-pro-\d+$/)
    assert.equal(result.credits_consumed, 20)
    assert.equal(result.files.length, 2)

    const [glb, obj] = result.files
    assert.equal(glb.type, 'GLB')
    assert.ok(glb.path.endsWith('.glb'), `expected a .glb path, got ${glb.path}`)
    assert.deepEqual(await readFile(glb.path), Buffer.from('glTF mock hunyuan3d asset', 'utf8'))
    assert.ok(obj.path.endsWith('.obj'), `expected a .obj path, got ${obj.path}`)
    assert.match(await readFile(obj.path, 'utf8'), /# mock obj/)

    // The request the plugin actually sent: action, version, region, TC3 scope.
    const submit = harness.requests.find(entry => entry.action === 'SubmitHunyuanTo3DProJob')
    assert.ok(submit !== undefined, 'submit request was not received')
    assert.equal(submit.version, '2025-05-13')
    assert.equal(submit.region, 'ap-guangzhou')
    assert.equal(submit.body.Prompt, '一只低多边形的宝箱')
    assert.equal(submit.body.ResultFormat, 'GLB')
    assert.equal(submit.body.Model, '3.0')
    assert.equal(submit.body.GenerateType, 'Normal')
    assert.match(submit.authorization, /Credential=AKIDmock\/\d{4}-\d{2}-\d{2}\/ai3d\/tc3_request/)

    const queries = harness.requests.filter(entry => entry.action === 'QueryHunyuanTo3DProJob')
    assert.ok(queries.length >= 2, 'the plugin must poll until the job is DONE')
    assert.deepEqual(queries.map(entry => entry.body.JobId), queries.map(() => result.job_id))
  } finally {
    await harness.close()
  }
})

test('end-to-end: rapid mode, image input and background submission', async () => {
  const harness = await bootHarness()
  try {
    const imagePath = path.join(harness.resultDir, 'reference.png')
    await writeFile(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'))

    const submitted = await runTool(harness, 'hunyuan_3d_model', {
      prompt: '一只卡通鲨鱼',
      mode: 'rapid',
      image_path: imagePath,
      wait: false,
    })
    assert.equal(submitted.status, 'WAIT')
    assert.equal(submitted.mode, 'rapid')
    assert.deepEqual(submitted.files, [])

    const submit = harness.requests.find(entry => entry.action === 'SubmitHunyuanTo3DRapidJob')
    assert.ok(submit !== undefined, 'rapid submit request was not received')
    assert.equal(submit.body.ImageBase64, 'iVBORw0KGgo=')
    assert.equal(submit.body.Prompt, '一只卡通鲨鱼')

    const collected = await runTool(harness, 'hunyuan_3d_query', { job_id: submitted.job_id, mode: 'rapid', wait: true, timeout_ms: 30_000 })
    assert.equal(collected.status, 'DONE')
    assert.equal(collected.job_id, submitted.job_id)
    assert.equal(collected.mode, 'rapid')
    assert.ok(collected.files.length >= 1)
  } finally {
    await harness.close()
  }
})

test('end-to-end: OpenAI-compatible door (Bearer-free Authorization, /v1/ai3d paths)', async () => {
  const harness = await bootHarness({ provider: 'compatible' })
  try {
    const result = await runTool(harness, 'hunyuan_3d_model', { prompt: '一只木头宝箱', timeout_ms: 30_000 })

    assert.equal(result.status, 'DONE')
    assert.equal(result.mode, 'pro')
    assert.match(result.job_id, /^mock-compat-\d+$/)
    assert.equal(result.credits_consumed, 20)
    assert.ok(result.files.length >= 1)
    assert.ok(result.files[0].path.endsWith('.glb'))

    // The wire the compatible door expects: documented paths, the API key on
    // Authorization, the same PascalCase body the native API documents.
    const submit = harness.compatibleRequests.find(entry => entry.path === '/v1/ai3d/submit')
    assert.ok(submit !== undefined, 'no request reached /v1/ai3d/submit')
    assert.equal(submit.authorization, 'sk-mockkey')
    assert.equal(submit.body.Prompt, '一只木头宝箱')
    assert.equal(submit.body.Model, '3.0')
    assert.equal(submit.body.GenerateType, 'Normal')
    // No TC3 headers on this door at all.
    assert.equal(harness.requests.length, 0, 'the compatible door must not use the native transport')

    const queries = harness.compatibleRequests.filter(entry => entry.path === '/v1/ai3d/query')
    assert.ok(queries.length >= 2, 'the plugin must poll until DONE')
    assert.deepEqual(queries.map(entry => entry.body.JobId), queries.map(() => result.job_id))
  } finally {
    await harness.close()
  }
})

test('the compatible door rejects rapid mode and a wrong key clearly', async () => {
  const harness = await bootHarness({ provider: 'compatible' })
  try {
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', { prompt: 'x', mode: 'rapid' }),
      (error) => error.code === 'invalid-argument' && /pro model only/.test(error.message),
    )

    process.env.HUNYUAN3D_API_KEY = 'sk-wrong'
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', { prompt: 'x' }),
      (error) => error.code === 'invalid_api_key' && /Incorrect API key/.test(error.message),
    )
  } finally {
    await harness.close()
  }
})

test('failure branches: validation, credentials and a failed job', async () => {
  const harness = await bootHarness({ fail: true })
  try {
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', {}),
      (error) => error.code === 'invalid-argument' && /Provide prompt/.test(error.message),
    )
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', { prompt: 'x', image_url: 'https://e/x.png' }),
      (error) => error.code === 'invalid-argument' && /cannot be combined/.test(error.message),
    )
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', { prompt: 'x', mode: 'quantum' }),
      (error) => error.code === 'invalid-argument' && /Unknown mode/.test(error.message),
    )
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', { prompt: 'x', model: '3.1', generate_type: 'LowPoly' }),
      (error) => error.code === 'invalid-argument' && /unavailable on model/.test(error.message),
    )
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_query', { job_id: '../etc/passwd' }),
      (error) => error.code === 'invalid-argument' && /job_id/.test(error.message),
    )

    // A missing key must be reported, never papered over.
    const savedId = process.env.TENCENTCLOUD_SECRET_ID
    delete process.env.TENCENTCLOUD_SECRET_ID
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', { prompt: 'x' }),
      (error) => error.code === 'credentials-not-configured' && /TENCENTCLOUD_SECRET_ID/.test(error.message),
    )
    process.env.TENCENTCLOUD_SECRET_ID = savedId

    // The service-reported failure surfaces as an error carrying the service code.
    await assert.rejects(
      runTool(harness, 'hunyuan_3d_model', { prompt: 'x' }),
      (error) => error.code === 'FailedOperation.GenerateFailed' && /mock generation failure/.test(error.message),
    )
  } finally {
    await harness.close()
  }
})

test('expired or unreachable result URLs are reported as download failures', async () => {
  const { saveResultFile } = await import('../src/hunyuan3d.js')
  const directory = await mkdtemp(path.join(tmpdir(), 'hunyuan3d-dl-'))
  try {
    await assert.rejects(
      saveResultFile({
        file: { type: 'GLB', url: 'http://127.0.0.1:1/expired.glb' },
        directory,
        jobId: 'mock-job-pro-9',
        index: 0,
        timeoutMs: 2000,
        signal: undefined,
      }),
      (error) => error.code === 'download-failed' && error.retryable === true,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('submissions queue behind maxConcurrency instead of tripping the service limit', async () => {
  // A slow job keeps every slot occupied for the whole observation.
  const harness = await bootHarness({ provider: 'compatible', delayMs: 2500 })
  try {
    const submits = () => harness.compatibleRequests.filter(r => r.path === '/v1/ai3d/submit').length
    const call = () => runTool(harness, 'hunyuan_3d_model', { prompt: '并发测试', wait: false })

    // The shipped default admits three; a fourth must wait for a slot.
    const first = await Promise.all([call(), call(), call()])
    const waiting = call()

    const sentinel = 'still-waiting'
    const raced = await Promise.race([waiting.then(() => 'admitted'), new Promise(r => setTimeout(() => r(sentinel), 400))])
    assert.equal(raced, sentinel, 'the fourth call was admitted while all slots were busy')
    assert.equal(submits(), 3, 'a fourth submit escaped the gate')
    for (const result of first) assert.equal(result.status, 'WAIT')

    // A terminal observation is what frees a slot: query the running jobs.
    await new Promise(resolve => setTimeout(resolve, 2700))
    for (const result of first) {
      const done = await runTool(harness, 'hunyuan_3d_query', { job_id: result.job_id, timeout_ms: 30_000 })
      assert.equal(done.status, 'DONE')
    }

    // With slots free again, the queued call proceeds on its own.
    const fourth = await waiting
    assert.equal(submits(), 4, 'the queued call should submit once a slot frees')
    const ids = [...first.map(r => r.job_id), fourth.job_id]
    assert.equal(new Set(ids).size, 4, 'every call must own a distinct job')
  } finally {
    await harness.close()
  }
})

test('a query that observes a terminal status frees the slot it was holding', async () => {
  const harness = await bootHarness({ provider: 'compatible', delayMs: 200 })
  try {
    // wait:false leaves the job holding a slot until something observes it.
    const submitted = await runTool(harness, 'hunyuan_3d_model', { prompt: '释放测试', wait: false })
    assert.equal(submitted.status, 'WAIT')

    // The query waits for DONE, which is the terminal observation.
    const collected = await runTool(harness, 'hunyuan_3d_query', {
      job_id: submitted.job_id,
      wait: true,
      timeout_ms: 30_000,
    })
    assert.equal(collected.status, 'DONE')

    // Slots are back at zero, so a fresh call is admitted immediately.
    const again = await runTool(harness, 'hunyuan_3d_model', { prompt: '再来一个', wait: false })
    assert.equal(again.status, 'WAIT')
    assert.notEqual(again.job_id, submitted.job_id)
  } finally {
    await harness.close()
  }
})
