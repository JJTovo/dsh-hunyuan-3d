/**
 * dsh-hunyuan-3d — host half.
 *
 * Exposes Tencent Cloud Hunyuan 3D (混元生3D, `ai3d` OpenAPI) as agent tools:
 * text-to-3D and image-to-3D job submission plus result polling, with every
 * generated asset downloaded to disk so later turns and other tools (Blender,
 * converters) can consume a real file path.
 *
 * Credentials are read through the dsh credential seam first and the process
 * environment second; no secret is ever written to configuration.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { COMPATIBLE_MODES, queryJob as compatibleQueryJob, submitJob as compatibleSubmitJob } from './compatible.js'
import { createConcurrencyGate } from './concurrency.js'
import { makeRoutes } from './routes.js'
import { SETTINGS_DEFAULTS, SETTINGS_NAMESPACE, SettingsSchema, normalizeSettings } from './settings.js'
import {
  DEFAULT_ENDPOINT,
  Hunyuan3DError,
  normalizeMode,
  queryJob as queryJobApi,
  resolveCredentials,
  saveResultFile,
  submitJob as submitJobApi,
  waitForJob,
} from './hunyuan3d.js'
import { modelParameters, queryParameters, resultSchema } from './schemas.js'

export const name = 'hunyuan-3d'
export const inject = ['tools']

const MODEL_IDS = ['3.0', '3.1']
const GENERATE_TYPES = ['Normal', 'LowPoly', 'Geometry', 'Sketch']
const POLYGON_TYPES = ['triangle', 'quadrilateral']
const RESULT_FORMATS = ['OBJ', 'GLB', 'STL', 'USDZ', 'FBX', 'MP4']
const VIEW_TYPES = ['left', 'right', 'back', 'top', 'bottom', 'left_front', 'right_front']

/** Default cooperative ceiling for one submit+wait call (pro jobs can run for minutes). */
const DEFAULT_WAIT_MS = 15 * 60 * 1000
const MAX_WAIT_MS = 60 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_HTTP_TIMEOUT_MS = 120_000
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/

/** Crockford-free: schemastery validates the declared shape, this normalizes it. */
function stringOrUndefined(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Normalize one image argument into exactly one of `ImageUrl` / `ImageBase64`.
 * A local path is read from disk and inlined, which is the only way to feed an
 * already-generated asset back into the API.
 * @param {{ image_url?: string, image_base64?: string, image_path?: string }} args
 * @returns {Promise<Record<string, string>>}
 */
async function imageFields(args) {
  const provided = [
    stringOrUndefined(args.image_url) === undefined ? undefined : 'image_url',
    stringOrUndefined(args.image_base64) === undefined ? undefined : 'image_base64',
    stringOrUndefined(args.image_path) === undefined ? undefined : 'image_path',
  ].filter(value => value !== undefined)
  if (provided.length === 0) return {}
  if (provided.length > 1) {
    throw new Hunyuan3DError(
      `image_url, image_base64 and image_path are mutually exclusive; received ${provided.join(', ')}.`,
      'invalid-argument',
    )
  }
  const url = stringOrUndefined(args.image_url)
  if (url !== undefined) return { ImageUrl: url }
  const base64 = stringOrUndefined(args.image_base64)
  if (base64 !== undefined) return { ImageBase64: base64.replace(/^data:[^;,]+;base64,/, '') }
  const filePath = stringOrUndefined(args.image_path)
  if (filePath === undefined) return {}
  let bytes
  try {
    bytes = await readFile(path.resolve(filePath))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Hunyuan3DError(`image_path could not be read: ${reason}`, 'invalid-argument')
  }
  return { ImageBase64: bytes.toString('base64') }
}

/**
 * Build the OpenAPI request body for one submit call.
 * @param {Record<string, unknown>} args
 * @param {'pro' | 'rapid'} mode
 * @returns {Promise<Record<string, unknown>>}
 */
async function buildSubmitPayload(args, mode) {
  const prompt = stringOrUndefined(args.prompt)
  const image = await imageFields(/** @type {any} */ (args))
  const hasImage = Object.keys(image).length > 0
  const multiview = Array.isArray(args.multi_view_images) ? args.multi_view_images.filter(Boolean) : []
  const generateType = stringOrUndefined(args.generate_type) ?? 'Normal'

  if (mode === 'rapid') {
    if (multiview.length > 0) {
      throw new Hunyuan3DError('multi_view_images is only supported by rapid mode = "pro".', 'invalid-argument')
    }
    if (args.face_count !== undefined || args.model !== undefined || args.polygon_type !== undefined) {
      throw new Hunyuan3DError('model, face_count and polygon_type are only supported by mode = "pro".', 'invalid-argument')
    }
    if (prompt === undefined && !hasImage) {
      throw new Hunyuan3DError('Provide prompt (text-to-3D) or one of image_url / image_base64 / image_path (image-to-3D).', 'invalid-argument')
    }
  } else {
    if (!GENERATE_TYPES.includes(generateType)) {
      throw new Hunyuan3DError(`generate_type must be one of ${GENERATE_TYPES.join(', ')}.`, 'invalid-argument')
    }
    const model = stringOrUndefined(args.model) ?? '3.0'
    if (!MODEL_IDS.includes(model)) {
      throw new Hunyuan3DError(`model must be one of ${MODEL_IDS.join(', ')}.`, 'invalid-argument')
    }
    if (model === '3.1' && generateType === 'LowPoly') {
      throw new Hunyuan3DError('generate_type "LowPoly" is unavailable on model "3.1".', 'invalid-argument')
    }
    // Sketch accepts a prompt together with an image; every other mode is
    // either text-to-3D or image-to-3D.
    if (generateType !== 'Sketch') {
      if (prompt !== undefined && hasImage) {
        throw new Hunyuan3DError('prompt and an image cannot be combined unless generate_type is "Sketch".', 'invalid-argument')
      }
      if (prompt === undefined && !hasImage && multiview.length === 0) {
        throw new Hunyuan3DError('Provide prompt (text-to-3D) or an image (image_url / image_base64 / image_path) or multi_view_images.', 'invalid-argument')
      }
    } else if (prompt === undefined && !hasImage) {
      throw new Hunyuan3DError('generate_type "Sketch" needs prompt or an image.', 'invalid-argument')
    }
  }

  /** @type {Record<string, unknown>} */
  const payload = {}
  if (prompt !== undefined) payload.Prompt = prompt
  Object.assign(payload, image)
  if (multiview.length > 0) {
    payload.MultiViewImages = multiview.map((view) => {
      const entry = /** @type {Record<string, unknown>} */ (view ?? {})
      const viewType = stringOrUndefined(entry.view_type)
      if (viewType === undefined || !VIEW_TYPES.includes(viewType)) {
        throw new Hunyuan3DError(`multi_view_images entries need view_type in ${VIEW_TYPES.join(', ')}.`, 'invalid-argument')
      }
      const viewUrl = stringOrUndefined(entry.image_url)
      const viewBase64 = stringOrUndefined(entry.image_base64)
      if ((viewUrl === undefined) === (viewBase64 === undefined)) {
        throw new Hunyuan3DError('multi_view_images entries need exactly one of image_url or image_base64.', 'invalid-argument')
      }
      return {
        ViewType: viewType,
        ...(viewUrl === undefined ? {} : { ViewImageUrl: viewUrl }),
        ...(viewBase64 === undefined ? {} : { ViewImageBase64: viewBase64.replace(/^data:[^;,]+;base64,/, '') }),
      }
    })
  }

  if (typeof args.enable_pbr === 'boolean') payload.EnablePBR = args.enable_pbr
  const resultFormat = stringOrUndefined(args.result_format)
  if (resultFormat !== undefined) {
    const normalized = resultFormat.toUpperCase()
    if (!RESULT_FORMATS.includes(normalized)) {
      throw new Hunyuan3DError(`result_format must be one of ${RESULT_FORMATS.join(', ')}.`, 'invalid-argument')
    }
    payload.ResultFormat = normalized
  }

  if (mode === 'rapid') {
    if (typeof args.enable_geometry === 'boolean') payload.EnableGeometry = args.enable_geometry
    return payload
  }

  payload.Model = stringOrUndefined(args.model) ?? '3.0'
  payload.GenerateType = generateType
  if (typeof args.face_count === 'number') {
    if (!Number.isInteger(args.face_count) || args.face_count < 3000 || args.face_count > 1_500_000) {
      throw new Hunyuan3DError('face_count must be an integer between 3000 and 1500000.', 'invalid-argument')
    }
    payload.FaceCount = args.face_count
  }
  const polygonType = stringOrUndefined(args.polygon_type)
  if (polygonType !== undefined) {
    if (!POLYGON_TYPES.includes(polygonType)) {
      throw new Hunyuan3DError(`polygon_type must be one of ${POLYGON_TYPES.join(', ')}.`, 'invalid-argument')
    }
    payload.PolygonType = polygonType
  }
  return payload
}

/** Whether a job has stopped occupying the service. @param {string} status */
function terminal(status) {
  return status === 'DONE' || status === 'FAIL' || status === 'CANCELLED'
}

/** Terminal-status vocabulary the model reasons about. */
function statusMessage(status, timedOut) {
  if (timedOut) return 'The wait budget elapsed while the job was still running; query it again with hunyuan_3d_query.'
  switch (status) {
    case 'DONE': return 'Modeling finished. The result files are saved on disk.'
    case 'FAIL': return 'Modeling failed. See error_code and error_message.'
    case 'RUN': return 'The job is still running.'
    case 'WAIT': return 'The job is queued.'
    default: return `The job reported status ${status}.`
  }
}

/**
 * Register the plugin settings section through the settings seam.
 *
 * The section lives only while the service does: ctx.inject is the soft form,
 * so a host without settings keeps running on the composition entry instead of
 * failing to activate.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} entry - this plugin row's composition config.
 * @param {(scope: { get: () => unknown } | undefined) => void} onScope - receives
 *   the live settings scope, so the caller reads current values, not a snapshot.
 */
function installSettings(ctx, entry, onScope) {
  const base = normalizeSettings(entry)
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = /** @type {{ installSection?: Function }} */ (settingsCtx.settings)
    if (typeof settings?.installSection !== 'function') return
    const installed = settings.installSection(ctx, SETTINGS_NAMESPACE, SettingsSchema, base, {
      // rc.7 hands the reader through this hook; alpha.2 returns the scope.
      setSource: get => { onScope({ get }) },
      onChange: () => {},
    })
    if (installed !== undefined && typeof installed.get === 'function') onScope(installed)
  })
}

function resultDirectoryOf(settings) {
  const configured = stringOrUndefined(settings.resultDir)
  if (configured !== undefined) return path.resolve(configured)
  const session = stringOrUndefined(process.env.DSH_WORKSPACE_DIR)
  if (session !== undefined) return path.join(session, '.dsh-hunyuan-3d')
  const home = stringOrUndefined(process.env.DSH_HOME)
  return home === undefined
    ? path.join(process.cwd(), '.dsh-hunyuan-3d')
    : path.join(home, 'hunyuan-3d')
}

export function apply(ctx, config) {
  /** Composition entry, used until (and if) a settings section is installed. */
  let fallback = normalizeSettings(config ?? {})
  /** The live settings scope, once the settings service is present. */
  /** @type {{ get: () => unknown } | undefined} */
  let scope
  /**
   * Read the current settings. The live scope wins so a committed write is
   * visible on the very next call, not at the next restart.
   */
  const settingsSource = () => {
    const live = scope?.get()
    return live === undefined ? fallback : normalizeSettings(live)
  }

  /**
   * Service slots are finite (three per the product documentation), so
   * submissions queue behind this gate instead of earning a
   * `RequestLimitExceeded` round trip.
   */
  const gate = createConcurrencyGate(() => {
    const settings = settingsSource()
    return {
      maxConcurrency: settings.maxConcurrency,
      queueLimit: settings.queueLimit,
      queueTimeoutMs: settings.queueTimeoutMs,
    }
  })
  /**
   * Jobs still occupying a service slot, by job id. A slot is released when a
   * call observes a terminal status, which is how `wait: false` and a query
   * after a timeout both give their slot back.
   * @type {Map<string, () => void>}
   */
  const activeJobs = new Map()

  /** @param {string} jobId */
  const releaseJob = (jobId) => {
    const release = activeJobs.get(jobId)
    if (release === undefined) return
    activeJobs.delete(jobId)
    release()
  }

  installSettings(ctx, config ?? {}, installed => {
    scope = installed
    if (installed === undefined) fallback = normalizeSettings(config ?? {})
  })

  /**
   * Resolve the transport for the current settings. Both API doors share the
   * snapshot vocabulary; only the wire differs, so the tools stay
   * provider-agnostic.
   */
  /**
   * The credential store, reached the only safe way: a context that declares the
   * injection. Cordis isolates services per fiber, so `ctx.credentials` on this
   * plugin's own context throws.
   * @returns {Promise<{ describe?: Function, resolve?: Function } | undefined>}
   */
  const credentialStore = () => new Promise((resolveStore) => {
    let settled = false
    const settle = (store) => {
      if (settled) return
      settled = true
      resolveStore(store)
    }
    ctx.inject(['credentials'], (storeCtx) => { settle(storeCtx.credentials) })
    // A host without a credential store still runs: environment variables are
    // then the only source, which is what an undefined store means here.
    setTimeout(() => settle(undefined), 2000)
  })

  /**
   * Resolve the transport for the current settings. Both API doors share the
   * snapshot vocabulary; only the wire differs, so the tools stay
   * provider-agnostic.
   */
  const callContext = async (signal) => {
    const settings = settingsSource()
    const credentials = await resolveCredentials(await credentialStore(), {
      provider: settings.provider,
      apiKeyRef: settings.apiKeyRef,
      secretIdRef: settings.secretIdRef,
      secretKeyRef: settings.secretKeyRef,
      tokenRef: settings.tokenRef,
    })
    const base = {
      credentials,
      timeoutMs: settings.httpTimeoutMs,
      pollIntervalMs: settings.pollIntervalMs,
      signal,
    }

    if (settings.provider === 'compatible') {
      const baseUrl = stringOrUndefined(process.env.DSH_HUNYUAN3D_BASE_URL) ?? settings.baseUrl
      return {
        provider: 'compatible',
        baseUrl,
        mode: 'pro',
        ...base,
        submitJob: (input) => compatibleSubmitJob({ ...base, ...input, baseUrl, apiKey: credentials.apiKey }),
        queryJob: (input) => compatibleQueryJob({ ...base, ...input, baseUrl, apiKey: credentials.apiKey }),
      }
    }

    const endpoint = stringOrUndefined(process.env.DSH_HUNYUAN3D_ENDPOINT) ?? settings.endpoint
    const native = {
      ...base,
      provider: 'native',
      endpoint,
      // Transport scheme and TC3 service label are not user settings: a real
      // deployment is always https/ai3d, and only a test double overrides them.
      scheme: stringOrUndefined(process.env.DSH_HUNYUAN3D_SCHEME) ?? 'https',
      service: stringOrUndefined(process.env.DSH_HUNYUAN3D_SERVICE) ?? 'ai3d',
      region: settings.region,
    }
    return {
      provider: 'native',
      endpoint,
      submitJob: (input) => submitJobApi({ ...native, ...input, mode: input.mode }),
      queryJob: (input) => queryJobApi({ ...native, ...input }),
    }
  }

  const waitBudget = (requested) => Math.min(
    MAX_WAIT_MS,
    Math.max(1000, typeof requested === 'number' ? requested : settingsSource().defaultWaitMs),
  )

  const disposers = [
    ctx.tools.register({
      name: 'hunyuan_3d_model',
      description: [
        'Create a 3D model with Tencent Cloud Hunyuan 3D (混元生3D): text-to-3D from a prompt, or image-to-3D from a picture.',
        'Submits an ai3d job and, unless wait is false, polls until it finishes; finished assets are downloaded to disk and returned as file paths.',
        'Pass either prompt, or exactly one image source (image_url / image_base64 / image_path), or multi_view_images. Sketch mode accepts a prompt together with an image.',
        'This call is billed per generated model, so do not retry a failed job blindly.',
      ].join(' '),
      parameters: modelParameters,
      output: {
        schema: resultSchema,
        render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
      },
      async execute(args, exec) {
        const mode = normalizeMode(args.mode)
        const call = await callContext(exec.signal)
        if (call.provider === 'compatible' && !COMPATIBLE_MODES.has(mode)) {
          throw new Hunyuan3DError(
            'The OpenAI-compatible endpoint publishes the pro model only. Use mode "pro", or switch the provider to native TC3 in Settings for "rapid".',
            'invalid-argument',
          )
        }
        const effectiveMode = call.provider === 'compatible' ? 'pro' : mode
        const payload = await buildSubmitPayload(/** @type {any} */ (args), effectiveMode)

        // Hold a service slot for the whole job, not merely for the submit.
        const release = await gate.acquire()
        /** @type {{ jobId: string, requestId?: string }} */
        let submitted
        try {
          submitted = await call.submitJob({ mode: effectiveMode, payload })
          const existing = activeJobs.get(submitted.jobId)
          activeJobs.set(submitted.jobId, release)
          existing?.()
        } catch (error) {
          // A rejected submit never occupied the service, so give the slot back.
          release()
          throw error
        }

        if (args.wait === false) {
          // The job keeps its slot until a query observes a terminal status.
          return {
            job_id: submitted.jobId,
            mode: effectiveMode,
            status: 'WAIT',
            message: `Job submitted and holding 1 of ${settingsSource().maxConcurrency} service slots. Call hunyuan_3d_query with job_id "${submitted.jobId}" (mode "${effectiveMode}") to collect the result and free the slot.`,
            ...(submitted.requestId === undefined ? {} : { request_id: submitted.requestId }),
            concurrency: gate.stats(),
            files: [],
          }
        }

        const { snapshot, timedOut } = await waitForJob({
          queryJob: call.queryJob,
          mode: effectiveMode,
          jobId: submitted.jobId,
          waitMs: waitBudget(args.timeout_ms),
        })
        const settings = settingsSource()
        // A job that ended no longer occupies the service; one still running
        // keeps its slot until a later query observes the terminal status.
        if (terminal(snapshot.status)) releaseJob(submitted.jobId)
        return collectResult({ snapshot, mode: effectiveMode, jobId: submitted.jobId, resultDir: resultDirectoryOf(settings), signal: exec.signal, httpTimeoutMs: settings.httpTimeoutMs, timedOut })
      },
    }),
    ctx.tools.register({
      name: 'hunyuan_3d_query',
      description: 'Check a Hunyuan 3D (混元生3D) modeling job and, when it has finished, download its assets to disk. Use this for jobs started with wait=false or to re-check a job. Result URLs stay valid for 24 hours after completion.',
      parameters: queryParameters,
      output: {
        schema: resultSchema,
        render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
      },
      async execute(args, exec) {
        const jobId = stringOrUndefined(args.job_id)
        if (jobId === undefined || !JOB_ID_PATTERN.test(jobId)) {
          throw new Hunyuan3DError('job_id is required and must be the JobId string returned by hunyuan_3d_model.', 'invalid-argument')
        }
        const mode = normalizeMode(args.mode)
        const call = await callContext(exec.signal)
        const { snapshot, timedOut } = args.wait === true
          ? await waitForJob({ queryJob: call.queryJob, mode, jobId, waitMs: waitBudget(args.timeout_ms) })
          : { snapshot: await call.queryJob({ mode, jobId }), timedOut: false }
        const settings = settingsSource()
        // A terminal answer is what frees the slot this job was holding.
        if (terminal(snapshot.status)) releaseJob(jobId)
        if (args.download === false || snapshot.status !== 'DONE') {
          return {
            job_id: jobId,
            mode,
            status: snapshot.status,
            message: statusMessage(snapshot.status, timedOut),
            ...(snapshot.requestId === undefined ? {} : { request_id: snapshot.requestId }),
            ...(snapshot.errorCode === undefined ? {} : { error_code: snapshot.errorCode }),
            ...(snapshot.errorMessage === undefined ? {} : { error_message: snapshot.errorMessage }),
            ...(snapshot.credits === undefined ? {} : { credits_consumed: snapshot.credits }),
            ...(snapshot.creditDetails === undefined ? {} : { credit_details: snapshot.creditDetails }),
            files: [],
          }
        }
        return collectResult({ snapshot, mode, jobId, resultDir: resultDirectoryOf(settings), signal: exec.signal, httpTimeoutMs: settings.httpTimeoutMs, timedOut })
      },
    }),
  ]

  // Announce the capability so the model knows the tool exists even before its
  // schema is inlined. `ctx.inject` is the soft-dependency form: the callback
  // runs when `systemPrompt` appears and is skipped on a host without it, so the
  // plugin activates everywhere instead of failing on an undeclared service.
  void ctx.inject(['systemPrompt'], (promptCtx) => {
    const dispose = promptCtx.systemPrompt.section({
      name: 'plugin:dsh-hunyuan-3d:capability',
      order: 60,
      text: 'Tencent Cloud Hunyuan 3D (混元生3D) modeling is available through hunyuan_3d_model and hunyuan_3d_query. Each generated model is billed, so confirm the intent before submitting a job.',
    })
    disposers.push(dispose)
  })

  // The browser settings card reaches settings and credentials through this
  // loopback-fenced bridge. Both services are read from the context that
  // actually holds them: `ctx.credentials` raises on a context that does not
  // declare the injection, so this must not run on the plugin's own context.
  void ctx.inject(['webServer', 'credentials', 'settings'], (bridgeCtx) => {
    const store = /** @type {any} */ (bridgeCtx.credentials)
    const settingsService = /** @type {any} */ (bridgeCtx.settings)

    const describeCredential = async (ref) => {
      if (typeof store?.describe === 'function') {
        const info = await store.describe(ref).catch(() => undefined)
        if (info !== undefined && info !== null) {
          return {
            configured: info.configured === true,
            writable: info.writable === true,
            ...info.source === undefined ? {} : { source: info.source },
          }
        }
      }
      const ambient = typeof process.env[ref] === 'string' && process.env[ref] !== ''
      return { configured: ambient, writable: typeof store?.set === 'function', ...ambient ? { source: 'environment' } : {} }
    }

    const routes = makeRoutes({
      credentials: store,
      getSettings: () => ({ ...settingsSource() }),
      getConcurrency: () => gate.stats(),
      updateSettings: async (patch) => {
        // Normalize first so a bad patch is rejected before anything persists.
        const next = normalizeSettings({ ...settingsSource(), ...patch })
        if (typeof settingsService?.update === 'function') {
          await settingsService.update(SETTINGS_NAMESPACE, patch)
        } else {
          // No settings service: the composition entry is the only source, so
          // the write is declined rather than silently forgotten.
          throw new Hunyuan3DError(
            'this host has no settings service, so configuration cannot be saved at runtime; edit the plugin row in cordis.yml instead.',
            'settings-read-only',
          )
        }
        return { ...settingsSource() }
      },
      describeCredential,
      setCredential: async (ref, value) => {
        if (typeof store?.set !== 'function') throw new Hunyuan3DError('this host has no writable credential store', 'credentials-read-only')
        await store.set(ref, value)
      },
      unsetCredential: async (ref) => {
        if (typeof store?.unset !== 'function') return
        await store.unset(ref)
      },
    })
    for (const route of routes) disposers.push(bridgeCtx.webServer.register(route))
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** Turn one terminal snapshot into the tool's canonical result. */
async function collectResult(input) {
  const { snapshot, mode, jobId, resultDir, signal, httpTimeoutMs, timedOut } = input
  if (snapshot.status === 'FAIL') {
    throw new Hunyuan3DError(
      `Hunyuan 3D job ${jobId} failed: [${snapshot.errorCode ?? 'unknown'}] ${snapshot.errorMessage ?? 'no message'}`,
      snapshot.errorCode ?? 'job-failed',
      { ...(snapshot.requestId === undefined ? {} : { requestId: snapshot.requestId }) },
    )
  }
  const files = []
  if (snapshot.status === 'DONE') {
    for (const [index, file] of snapshot.files.entries()) {
      const saved = await saveResultFile({
        file,
        directory: resultDir,
        jobId,
        index,
        timeoutMs: httpTimeoutMs,
        signal,
      })
      files.push({
        ...(file.type === undefined ? {} : { type: file.type }),
        path: saved.path,
        bytes: saved.bytes,
        ...(file.url === undefined ? {} : { source_url: file.url }),
        ...(file.previewImageUrl === undefined ? {} : { preview_image_url: file.previewImageUrl }),
      })
    }
  }
  return {
    job_id: jobId,
    mode,
    status: snapshot.status,
    message: snapshot.status === 'DONE' && files.length === 0
      ? 'Modeling finished but the service reported no result files; query again in a moment.'
      : statusMessage(snapshot.status, timedOut),
    ...(snapshot.requestId === undefined ? {} : { request_id: snapshot.requestId }),
    ...(snapshot.credits === undefined ? {} : { credits_consumed: snapshot.credits }),
    ...(snapshot.creditDetails === undefined ? {} : { credit_details: snapshot.creditDetails }),
    ...(files.length === 0 ? {} : { result_directory: resultDir }),
    files,
  }
}

/** Model-facing text rendering. */
function renderResult(value) {
  const lines = [`Hunyuan 3D job ${value.job_id} (${value.mode}) — status ${value.status}.`, value.message]
  if (value.error_code !== undefined) lines.push(`Error: [${value.error_code}] ${value.error_message ?? ''}`.trim())
  if (value.credits_consumed !== undefined) lines.push(`Credits consumed: ${value.credits_consumed}${value.credit_details === undefined ? '' : ` (${value.credit_details})`}`)
  for (const file of value.files) {
    lines.push(`- ${file.type ?? 'file'} ${file.path} (${file.bytes} bytes)${file.preview_image_url === undefined ? '' : ` preview: ${file.preview_image_url}`}`)
  }
  return lines.join('\n')
}
