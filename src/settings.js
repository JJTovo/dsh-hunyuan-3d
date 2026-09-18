/**
 * The plugin's user-editable settings: a schema-free shape plus its validation.
 *
 * No schemastery dependency on purpose. The settings service accepts any object
 * exposing `~standard.validate`, so a plain validator keeps this plugin free of
 * runtime dependencies — and therefore free of the resolution failures that a
 * missing dependency would cause at host boot.
 */

/** Namespace the settings service and the browser card both address. */
export const SETTINGS_NAMESPACE = 'hunyuan-3d'

/** Transport modes: the console API-key door, or the signed cloud API. */
export const PROVIDERS = ['compatible', 'native']
export const DEFAULT_PROVIDER = 'compatible'

/** Credential references the plugin reads when no environment value wins. */
export const DEFAULT_API_KEY_REF = 'HUNYUAN3D_API_KEY'
export const DEFAULT_SECRET_ID_REF = 'TENCENTCLOUD_SECRET_ID'
export const DEFAULT_SECRET_KEY_REF = 'TENCENTCLOUD_SECRET_KEY'
export const DEFAULT_TOKEN_REF = 'TENCENTCLOUD_TOKEN'

/** Environment-variable name grammar the credential store accepts. */
const REF_PATTERN = /^[A-Z_][A-Z0-9_]*$/

/**
 * The composition entry, and the shape the settings card edits.
 * @typedef {object} Settings
 * @property {'compatible' | 'native'} provider
 * @property {string} baseUrl
 * @property {string} apiKeyRef
 * @property {string} region
 * @property {string} endpoint
 * @property {string} resultDir
 * @property {string} secretIdRef
 * @property {string} secretKeyRef
 * @property {string} tokenRef
 * @property {number} maxConcurrency
 * @property {number} queueLimit
 * @property {number} queueTimeoutMs
 * @property {number} pollIntervalMs
 * @property {number} defaultWaitMs
 * @property {number} httpTimeoutMs
 */

/** @type {Settings} */
export const SETTINGS_DEFAULTS = {
  // The console API key is the documented path for the OpenAI-compatible door.
  provider: DEFAULT_PROVIDER,
  baseUrl: 'https://api.ai3d.cloud.tencent.com',
  apiKeyRef: DEFAULT_API_KEY_REF,
  region: 'ap-guangzhou',
  endpoint: 'ai3d.tencentcloudapi.com',
  resultDir: '',
  secretIdRef: DEFAULT_SECRET_ID_REF,
  secretKeyRef: DEFAULT_SECRET_KEY_REF,
  tokenRef: DEFAULT_TOKEN_REF,
  // The service grants three simultaneous jobs; the queue absorbs the rest.
  maxConcurrency: 3,
  queueLimit: 32,
  queueTimeoutMs: 10 * 60 * 1000,
  pollIntervalMs: 10_000,
  defaultWaitMs: 15 * 60 * 1000,
  httpTimeoutMs: 120_000,
}

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? value.trim() : undefined
}

/** @param {unknown} value @param {number} fallback */
function positiveInteger(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Validate and normalize one candidate section into the plugin's settings shape.
 * Throws a plain `Error` whose message the settings service surfaces to the card.
 * @param {unknown} input
 * @returns {Settings}
 */
export function normalizeSettings(input) {
  const raw = typeof input === 'object' && input !== null ? /** @type {Record<string, unknown>} */ (input) : {}
  const problems = []

  const provider = text(raw.provider) ?? SETTINGS_DEFAULTS.provider
  if (!PROVIDERS.includes(provider)) problems.push(`provider "${provider}" must be one of ${PROVIDERS.join(', ')}`)

  const rawBaseUrl = text(raw.baseUrl) ?? SETTINGS_DEFAULTS.baseUrl
  const baseUrl = rawBaseUrl.replace(/\/+$/, '')
  // A path is allowed: people paste the documented endpoint, and the transport
  // strips the API path rather than duplicating it. Only the scheme and host
  // are load-bearing here.
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s?#]*)?$/i.test(baseUrl)) {
    problems.push(`baseUrl "${rawBaseUrl}" must be an http(s) URL such as https://api.ai3d.cloud.tencent.com`)
  }

  const region = text(raw.region) ?? SETTINGS_DEFAULTS.region
  if (region === '') problems.push('region must not be empty')

  const endpoint = text(raw.endpoint) ?? SETTINGS_DEFAULTS.endpoint
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(endpoint)) problems.push(`endpoint "${endpoint}" is not a host name`)

  const resultDir = text(raw.resultDir) ?? ''

  /** @type {Record<string, string>} */
  const refs = {}
  for (const key of ['apiKeyRef', 'secretIdRef', 'secretKeyRef', 'tokenRef']) {
    const value = text(raw[key]) ?? SETTINGS_DEFAULTS[key]
    if (!REF_PATTERN.test(value)) problems.push(`${key} "${value}" must be an environment-variable name such as ${SETTINGS_DEFAULTS[key]}`)
    refs[key] = value
  }

  if (problems.length > 0) throw new Error(problems.join('; '))

  return {
    provider,
    baseUrl,
    region,
    endpoint,
    resultDir,
    ...refs,
    maxConcurrency: Math.min(64, positiveInteger(raw.maxConcurrency, SETTINGS_DEFAULTS.maxConcurrency)),
    queueLimit: Math.min(1024, positiveInteger(raw.queueLimit, SETTINGS_DEFAULTS.queueLimit)),
    queueTimeoutMs: positiveInteger(raw.queueTimeoutMs, SETTINGS_DEFAULTS.queueTimeoutMs),
    pollIntervalMs: positiveInteger(raw.pollIntervalMs, SETTINGS_DEFAULTS.pollIntervalMs),
    defaultWaitMs: positiveInteger(raw.defaultWaitMs, SETTINGS_DEFAULTS.defaultWaitMs),
    httpTimeoutMs: positiveInteger(raw.httpTimeoutMs, SETTINGS_DEFAULTS.httpTimeoutMs),
  }
}

/**
 * The schema handle the settings service expects.
 *
 * The service calls the handle as a function (`schema(candidate)`), reads
 * `schema.toJSON()` when describing the namespace to a configuration surface,
 * and may consult the standard-schema interface. Those three requirements are
 * satisfied by one callable object, which is why this is not a plain literal.
 * @param {unknown} value
 * @returns {Settings} the validated, normalized section.
 */
function validateSettings(value) {
  return normalizeSettings(value)
}

/** Fields a configuration surface renders, in display order. */
export const SETTINGS_FIELDS = [
  { key: 'baseUrl', type: 'string', label: 'OpenAI 兼容 base URL', placeholder: SETTINGS_DEFAULTS.baseUrl },
  { key: 'region', type: 'string', label: '区域 (region，仅原生 TC3)', placeholder: SETTINGS_DEFAULTS.region },
  { key: 'endpoint', type: 'string', label: '接口域名 (endpoint)', placeholder: SETTINGS_DEFAULTS.endpoint },
  { key: 'resultDir', type: 'string', label: '模型保存目录 (resultDir)', placeholder: '留空则用 $DSH_HOME/hunyuan-3d' },
  { key: 'maxConcurrency', type: 'number', label: '并发上限 (服务端为 3)', placeholder: String(SETTINGS_DEFAULTS.maxConcurrency) },
  { key: 'queueLimit', type: 'number', label: '排队上限', placeholder: String(SETTINGS_DEFAULTS.queueLimit) },
  { key: 'queueTimeoutMs', type: 'number', label: '排队超时 (ms)', placeholder: String(SETTINGS_DEFAULTS.queueTimeoutMs) },
  { key: 'pollIntervalMs', type: 'number', label: '轮询间隔 (ms)', placeholder: String(SETTINGS_DEFAULTS.pollIntervalMs) },
  { key: 'defaultWaitMs', type: 'number', label: '默认等待上限 (ms)', placeholder: String(SETTINGS_DEFAULTS.defaultWaitMs) },
  { key: 'httpTimeoutMs', type: 'number', label: '单次请求超时 (ms)', placeholder: String(SETTINGS_DEFAULTS.httpTimeoutMs) },
  { key: 'apiKeyRef', type: 'string', label: 'API Key 引用名', placeholder: DEFAULT_API_KEY_REF },
  { key: 'secretIdRef', type: 'string', label: 'SecretId 引用名（仅原生 TC3）', placeholder: DEFAULT_SECRET_ID_REF },
  { key: 'secretKeyRef', type: 'string', label: 'SecretKey 引用名', placeholder: DEFAULT_SECRET_KEY_REF },
  { key: 'tokenRef', type: 'string', label: 'STS Token 引用名', placeholder: DEFAULT_TOKEN_REF },
]

/** The callable schema handle passed to `ctx.settings`. */
export const SettingsSchema = Object.assign(validateSettings, {
  /** Shipped with the namespace so a UI can render a generic form. */
  toJSON() {
    return {
      type: 'object',
      additionalProperties: false,
      default: SETTINGS_DEFAULTS,
      properties: Object.fromEntries(SETTINGS_FIELDS.map(field => [
        field.key,
        {
          type: field.type,
          description: field.label,
          ...field.placeholder === undefined ? {} : { default: SETTINGS_DEFAULTS[field.key] },
        },
      ])),
    }
  },
  '~standard': {
    version: 1,
    vendor: 'dsh-hunyuan-3d',
    /** @param {unknown} value */
    validate(value) {
      try {
        return { value: normalizeSettings(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
})
