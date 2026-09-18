/**
 * The browser half, verified without a browser.
 *
 * Loads the real built artifact (`lib/client.js`) the way dsh's client module
 * system does — execute the file, capture the registered factory, call it with
 * a `require` — then renders the card with real React. A hook-order or element
 * error in the card fails here rather than in the user's settings tab.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const bundlePath = path.join(root, 'lib', 'client.js')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

/**
 * Execute the artifact against a loader double and return the module exports.
 * @returns {Promise<{ exports: Record<string, unknown>, registered: { id: string, factory: Function } }>}
 */
async function loadClientBundle() {
  /** @type {{ id: string, factory: Function } | undefined} */
  let registered
  const window = {
    __ModuleLoader__: {
      load(entry) { registered = entry },
    },
  }
  const source = readFileSync(bundlePath, 'utf8')
  // The artifact is a script, not a module: run it with the loader in scope.
  const run = new Function('window', 'require', source)
  run(window, (specifier) => {
    throw new Error(`the factory must not require ${specifier} at registration time`)
  })
  assert.ok(registered !== undefined, 'the bundle registered no module')
  const entry = registered
  const exports = await entry.factory((specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return reactJsxRuntime
    // The shell owns the design-system primitives; double them faithfully
    // enough to render (Tag is the only one the card uses).
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesDouble
    throw new Error(`unexpected external require: ${specifier}`)
  })
  return { exports, registered: entry }
}

/**
 * React is a dev-only dependency here: the shipped bundle takes it from the
 * shell at runtime. A vendored copy without `node_modules` therefore still runs
 * the non-browser suites and skips these, instead of failing on an import.
 */
const react = await import('react').catch(() => undefined)
const skipNoReact = react === undefined && 'react/react-dom are dev-only; run `npm install` in the plugin directory to exercise the browser half'

/** Stand-in for the shell's design-system exports the card consumes (Tag only). */
const primitivesDouble = {
  Tag: ({ children, tone, className }) => react.createElement('span', { className, 'data-tone': tone }, children),
}
const reactJsxRuntime = react === undefined ? undefined : await import('react/jsx-runtime')
const renderToStaticMarkup = react === undefined ? undefined : (await import('react-dom/server')).renderToStaticMarkup

test('the client bundle registers itself under the package name', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, async () => {
  const { registered, exports } = await loadClientBundle()
  assert.equal(registered.id, packageJson.name)
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots'])
  // The card is the only thing the shell needs to find.
  assert.equal(typeof exports.HunyuanSettingsCard, 'function')
})

test('the browser half declares its client face and externals stay external', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, () => {
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.equal(packageJson.exports['./client'], './lib/client.js')

  const source = readFileSync(bundlePath, 'utf8')
  // React must come from the shell: a second copy breaks hooks across the app.
  assert.match(source, /require\("react"\)/)
  assert.doesNotMatch(source, /createRoot|__SECRET_INTERNALS/, 'React appears to be bundled in')
  assert.match(source, /__ModuleLoader__\.load\(/)
})

test('apply() registers the card into the plugin settings slot', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, async () => {
  const { exports } = await loadClientBundle()
  /** @type {Array<{ name: string, options: any, component: unknown }>} */
  const registered = []
  const ctx = {
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.plugin.item'); callback() },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
  }
  exports.apply(ctx)

  assert.equal(registered.length, 1)
  const entry = registered[0]
  // The key IS the settings namespace: the tab pairs card and host section by it.
  assert.equal(entry.options.key, 'hunyuan-3d')
  assert.equal(entry.options.name, 'settings.plugin.item')
  assert.equal(typeof entry.component, 'function')
})

test('the card renders its initial state without throwing', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, async () => {
  const { exports } = await loadClientBundle()

  // The effect fires a fetch; renderToStaticMarkup never runs effects, so the
  // card must produce its loading state from props-free state alone.
  const html = renderToStaticMarkup(react.createElement(exports.HunyuanSettingsCard))
  assert.match(html, /正在读取设置/)
})

/** The loaded-state props the collapsed/expanded assertions share (native provider). */
const loaded = {
  settings: {
    provider: 'native',
    region: 'ap-guangzhou',
    endpoint: 'ai3d.tencentcloudapi.com',
    resultDir: '',
    secretIdRef: 'TENCENTCLOUD_SECRET_ID',
    secretKeyRef: 'TENCENTCLOUD_SECRET_KEY',
    tokenRef: 'TENCENTCLOUD_TOKEN',
    pollIntervalMs: 10000,
    defaultWaitMs: 900000,
    httpTimeoutMs: 120000,
  },
  credentials: {
    secretId: { ref: 'TENCENTCLOUD_SECRET_ID', configured: true, writable: true },
    secretKey: { ref: 'TENCENTCLOUD_SECRET_KEY', configured: false, writable: true },
    token: { ref: 'TENCENTCLOUD_TOKEN', configured: false, writable: true },
  },
}

test('the card is collapsed by default: header only, like the other plugin cards', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, async () => {
  const { exports } = await loadClientBundle()
  const html = renderToStaticMarkup(react.createElement(exports.HunyuanSettingsCard, { initial: loaded }))

  // The header always names the plugin and what its settings govern.
  assert.match(html, /腾讯云混元生3D/)
  assert.match(html, /混元生3D 建模/)

  // Collapsed means the controls are NOT in the DOM at all.
  assert.doesNotMatch(html, /SecretId/, 'credential controls leaked into the collapsed card')
  assert.doesNotMatch(html, /接口域名/)
  assert.doesNotMatch(html, /type="password"/)
  assert.doesNotMatch(html, new RegExp('>保存<'))
  assert.doesNotMatch(html, new RegExp('>测试连接<'))

  // It is still a disclosure: a header button that reports its state.
  assert.match(html, /<button[^>]*aria-expanded="false"/)
  assert.match(html, /aria-label="展开: 腾讯云混元生3D"/)
})

test('the card discloses every field and credential control when expanded', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, async () => {
  const { exports } = await loadClientBundle()
  const html = renderToStaticMarkup(react.createElement(exports.HunyuanSettingsCard, { initial: loaded, defaultOpen: true }))

  for (const label of ['区域', '接口域名', '模型保存目录', '轮询间隔', '默认等待上限', '单次请求超时']) {
    assert.ok(html.includes(label), 'missing field: ' + label)
  }
  for (const label of ['SecretId', 'SecretKey', 'STS Token']) {
    assert.ok(html.includes(label), 'missing credential control: ' + label)
  }

  // Credentials are write-only inputs, and configured state is reported.
  assert.equal(html.split('type="password"').length - 1, 3, 'each credential needs a password input')
  assert.ok(html.includes('已配置'))
  assert.ok(html.includes('未配置'))
  assert.ok(html.includes('>保存<'), 'missing the save button')
  assert.ok(html.includes('>放弃改动<'), 'missing the discard button')
  assert.ok(html.includes('>测试连接<'), 'missing the test button')
  // Only the configured, writable credential offers Clear.
  assert.equal(html.split('>清除<').length - 1, 1)

  // Expanded state is announced, and no credential value can appear.
  assert.ok(html.includes('aria-expanded="true"'))
  assert.ok(html.includes('aria-label="折叠: 腾讯云混元生3D"'))
  assert.equal(html.includes('AKID'), false)
})

test('the compatible provider shows the API key and base URL instead of TC3 fields', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, async () => {
  const { exports } = await loadClientBundle()
  const html = renderToStaticMarkup(react.createElement(exports.HunyuanSettingsCard, {
    initial: {
      settings: { ...loaded.settings, provider: 'compatible' },
      credentials: { apiKey: { ref: 'HUNYUAN3D_API_KEY', configured: false, writable: true } },
    },
    defaultOpen: true,
  }))

  // The console API key is the only credential this door takes.
  assert.ok(html.includes('API Key'), 'missing the API Key control')
  assert.equal(html.split('type="password"').length - 1, 1, 'exactly one secret input on this provider')
  // TC3-only fields are absent, and the base URL is present.
  assert.equal(html.includes('SecretId'), false, 'the compatible card must not show the SecretId control')
  assert.equal(html.includes('SecretKey'), false, 'the compatible card must not show SecretKey')
  assert.ok(html.includes('base URL'), 'missing the base URL field')
  assert.equal(html.includes('区域 (region)'), false, 'the compatible card must not show the native region field')
  // The provider selector offers both doors.
  assert.ok(html.includes('<select'), 'missing the provider selector')
  assert.ok(html.includes('OpenAI 兼容接口'), 'missing the compatible provider option')
  assert.ok(html.includes('原生云 API'), 'missing the native provider option')
})

test('the chevron rotates only while the card is open', { skip: skipNoReact || (!existsSync(bundlePath) && 'run `node scripts/build-client.mjs` first') }, async () => {
  const { exports } = await loadClientBundle()
  const collapsed = renderToStaticMarkup(react.createElement(exports.HunyuanSettingsCard, { initial: loaded }))
  const expanded = renderToStaticMarkup(react.createElement(exports.HunyuanSettingsCard, { initial: loaded, defaultOpen: true }))

  assert.match(collapsed, /data-hunyuan-card="true"/)
  assert.doesNotMatch(collapsed, /data-open="true"/)
  assert.match(expanded, /data-open="true"/)

  const rotation = (markup) => markup.includes('rotate(180deg)')
  assert.equal(rotation(collapsed), false, 'the collapsed chevron must point down')
  assert.equal(rotation(expanded), true, 'the expanded chevron must point up')
})
