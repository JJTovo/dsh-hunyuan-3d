/**
 * The Hunyuan 3D settings card (browser half).
 *
 * Rendered inside dsh's Settings > Plugins > Configurable tab, keyed by the
 * `hunyuan-3d` settings namespace so the tab pairs it with the host section
 * without knowing what the namespace means.
 *
 * Shape mirrors the shipped plugin cards: a header naming the plugin and what
 * its settings govern, disclosing the controls in place, collapsed by default.
 * Disclosure is card-local state, but a card holding unsaved edits stays open
 * through a save attempt so a rejection is never hidden behind a collapsed
 * header.
 *
 * The credential controls are write-only: the card learns whether a reference
 * is configured, never its value, and posts a new value through the plugin's
 * loopback bridge.
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'

const BRIDGE = '/api/dsh-hunyuan-3d'
const NS = 'hunyuan-3d'
const TITLE = '腾讯云混元生3D'
const DESCRIPTION = '混元生3D 建模：接口方式、密钥与生成参数'

/** The two documented front doors, and which fields each one uses. */
const PROVIDERS = [
  { value: 'compatible', label: 'OpenAI 兼容接口（API Key）', hint: 'api.ai3d.cloud.tencent.com/v1/ai3d/*，用控制台创建的 API Key' },
  { value: 'native', label: '原生云 API（TC3 签名）', hint: 'ai3d.tencentcloudapi.com，用 SecretId/SecretKey 签名' },
]

/** Human labels; the settings keys themselves are host-owned. */
const TEXT_FIELDS = [
  { key: 'baseUrl', label: 'OpenAI 兼容 base URL', hint: '默认 https://api.ai3d.cloud.tencent.com', providers: ['compatible'] },
  { key: 'resultDir', label: '模型保存目录', hint: '留空则写入 $DSH_HOME/hunyuan-3d' },
]

/** Fields only the native signed transport reads. */
const NATIVE_FIELDS = [
  { key: 'region', label: '区域 (region)', hint: '例如 ap-guangzhou', providers: ['native'] },
  { key: 'endpoint', label: '接口域名 (endpoint)', hint: '默认 ai3d.tencentcloudapi.com', providers: ['native'] },
]

const NUMBER_FIELDS = [
  { key: 'maxConcurrency', label: '并发上限', hint: '服务端限制为 3；调小可省额度占用' },
  { key: 'queueLimit', label: '排队上限' },
  { key: 'queueTimeoutMs', label: '排队超时 (ms)' },
  { key: 'pollIntervalMs', label: '轮询间隔 (ms)' },
  { key: 'defaultWaitMs', label: '默认等待上限 (ms)' },
  { key: 'httpTimeoutMs', label: '单次请求超时 (ms)' },
]

const CREDENTIAL_FIELDS = [
  { role: 'apiKey', label: 'API Key', hint: '控制台「API KEY」页创建，形如 sk-xxxx（仅写入，不回显）', providers: ['compatible'] },
  { role: 'secretId', label: 'SecretId', hint: '腾讯云访问密钥 ID', providers: ['native'] },
  { role: 'secretKey', label: 'SecretKey', hint: '腾讯云访问密钥 Key（仅写入，不回显）', providers: ['native'] },
  { role: 'token', label: 'STS Token', hint: '仅使用临时凭据时需要', providers: ['native'] },
]

/** @param {string} path @param {RequestInit} [init] */
async function bridge(path, init) {
  const response = await fetch(`${BRIDGE}${path}`, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json()
}

/** Card chrome, drawn with the same design tokens the shipped cards use. */
const styles = {
  card: {
    listStyle: 'none',
    border: '0.5px solid var(--dsw-alias-border-l4)',
    borderRadius: '16px',
    background: 'var(--dsw-alias-bg-layer-3)',
    transition: 'border-color .16s, background .16s',
    margin: '0 0 8px',
  },
  cardOpen: { background: 'var(--dsw-alias-bg-layer-2)', borderColor: 'var(--dsw-alias-label-dimmed)' },
  header: {
    width: '100%',
    appearance: 'none',
    border: 0,
    background: 'none',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: '12px',
  },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
  name: { fontSize: '15px', fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' },
  description: { fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  chevron: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s' },
  chevronOpen: { transform: 'rotate(180deg)' },
  body: {
    borderTop: '0.5px solid var(--dsw-alias-border-l2)',
    margin: '0 16px',
    padding: '12px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px 16px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontWeight: 500 },
  muted: { opacity: 0.65, fontSize: '12px' },
  input: {
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l4)',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'inherit',
    fontSize: '13px',
    fontFamily: 'inherit',
  },
  row: { display: 'flex', alignItems: 'flex-end', gap: '8px' },
  button: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l4)',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: 'inherit',
  },
  badge: {
    borderRadius: '999px',
    padding: '1px 8px',
    fontSize: '11px',
    border: '1px solid var(--dsw-alias-border-l4)',
    color: 'var(--dsw-alias-label-tertiary)',
  },
  status: { fontSize: '12px' },
}

/**
 * The disclosure indicator, drawn inline so the card needs no icon export.
 * @param {{ open: boolean }} props
 */
function Chevron(props) {
  return h('svg', {
    viewBox: '0 0 14 14',
    width: 14,
    height: 14,
    'aria-hidden': 'true',
    style: props.open === true ? { ...styles.chevron, ...styles.chevronOpen } : styles.chevron,
  }, h('path', {
    d: 'M3.5 5.25 7 8.75l3.5-3.5',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }))
}

/**
 * Whether a field applies to the selected provider.
 * @param {{ providers?: string[] }} field
 * @param {string} provider
 */
function appliesTo(field, provider) {
  return field.providers === undefined || field.providers.includes(provider)
}

/**
 * One labelled control. `children` is a plain array so both call sites pass the
 * same shape — `createElement` treats extra arguments as variadic children, and
 * a single element there is not iterable.
 * @param {{ label: string, hint?: string, children: unknown[] }} props
 */
function Field(props) {
  return h('label', { style: styles.field }, [
    h('span', { style: styles.label, key: 'label' }, props.label),
    ...props.children,
    props.hint === undefined ? null : h('span', { style: styles.muted, key: 'hint' }, props.hint),
  ])
}

/**
 * The card component registered into `settings.plugin.item`.
 *
 * `props.initial` and `props.defaultOpen` exist so a harness can render either
 * disclosure state without a live bridge; the host renderer passes no props.
 * @param {{ initial?: { settings: object, credentials: object }, defaultOpen?: boolean }} [props]
 */
export function HunyuanSettingsCard(props) {
  const initial = props?.initial ?? null
  const [settings, setSettings] = useState(initial?.settings ?? null)
  const [credentials, setCredentials] = useState(initial?.credentials ?? null)
  const [draft, setDraft] = useState({})
  const [secrets, setSecrets] = useState({})
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(props?.defaultOpen === true)
  const [provider, setProvider] = useState(initial?.settings?.provider ?? 'compatible')
  const [concurrency, setConcurrency] = useState(initial?.concurrency ?? null)
  const mounted = useRef(true)
  const saveStarted = useRef(false)

  const dirty = Object.keys(draft).length > 0 || Object.values(secrets).some(value => value !== '')

  /** Collapse only after a settled, successful save. */
  useEffect(() => {
    if (busy) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!dirty && status?.ok === true) setOpen(false)
  }, [busy, dirty, status])

  const adopt = (payload) => {
    if (mounted.current !== true) return
    setSettings(payload.settings)
    setCredentials(payload.credentials)
    if (payload.concurrency !== undefined) setConcurrency(payload.concurrency)
    setProvider(payload.settings?.provider ?? 'compatible')
    setDraft({})
    setSecrets({})
  }

  useEffect(() => {
    mounted.current = true
    // A harness-supplied initial state stands in for the bridge read.
    if (initial !== null) return () => { mounted.current = false }
    bridge('/settings').then(adopt).catch((error) => {
      if (mounted.current) setStatus({ ok: false, message: `读取设置失败：${error.message}` })
    })
    return () => { mounted.current = false }
  }, [])

  if (settings === null) {
    return h('li', { style: styles.card, 'data-hunyuan-card': true, 'data-open': undefined }, h('div', { style: styles.header }, h('span', { style: styles.headText }, [
      h('span', { style: styles.name, key: 'name' }, TITLE),
      h('span', { style: styles.description, key: 'desc' }, status?.message ?? '正在读取设置…'),
    ])))
  }

  const valueOf = (key) => draft[key] ?? settings[key] ?? ''

  const save = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const typed = { ...draft, provider }
      for (const field of NUMBER_FIELDS) {
        if (typed[field.key] !== undefined && typed[field.key] !== '') typed[field.key] = Number(typed[field.key])
      }
      const saved = await bridge('/settings', { method: 'POST', body: JSON.stringify({ settings: typed }) })
      if (saved.ok !== true) {
        setStatus({ ok: false, message: saved.message ?? '保存失败' })
        return
      }
      adopt(saved)

      // Credentials are written one reference at a time, and only when typed:
      // an untouched field must never clear a stored key.
      const written = []
      for (const field of CREDENTIAL_FIELDS) {
        if (!appliesTo(field, provider)) continue
        const value = (secrets[field.role] ?? '').trim()
        if (value === '') continue
        const result = await bridge('/credentials', { method: 'POST', body: JSON.stringify({ role: field.role, action: 'set', value }) })
        if (result.ok !== true) {
          setStatus({ ok: false, message: `${field.label} 保存失败：${result.message ?? ''}` })
          return
        }
        written.push(field.label)
        setCredentials(result.credentials)
      }
      setSecrets({})
      setStatus({ ok: true, message: written.length === 0 ? '设置已保存。' : `设置已保存，密钥已更新：${written.join('、')}。` })
    } catch (error) {
      setStatus({ ok: false, message: `保存失败：${error.message}` })
    } finally {
      setBusy(false)
    }
  }

  const discard = () => {
    setDraft({})
    setSecrets({})
    setStatus({ ok: true, message: '已放弃未保存的改动。' })
  }

  const clear = async (role, label) => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await bridge('/credentials', { method: 'POST', body: JSON.stringify({ role, action: 'unset' }) })
      if (result.ok !== true) {
        setStatus({ ok: false, message: `清除 ${label} 失败：${result.message ?? ''}` })
        return
      }
      setCredentials(result.credentials)
      setStatus({ ok: true, message: `${label} 已清除。` })
    } catch (error) {
      setStatus({ ok: false, message: `清除 ${label} 失败：${error.message}` })
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setStatus({ ok: true, message: '正在测试连接…' })
    try {
      const result = await bridge('/test', { method: 'POST', body: '{}' })
      setStatus({ ok: result.ok === true, message: result.message ?? '' })
    } catch (error) {
      setStatus({ ok: false, message: `测试失败：${error.message}` })
    } finally {
      setBusy(false)
    }
  }

  const providerRow = h('div', { style: styles.field, key: 'provider' }, [
    h('span', { style: styles.label, key: 'label' }, '接口方式'),
    h('select', {
      key: 'select',
      style: styles.input,
      value: provider,
      onChange: event => setProvider(event.target.value),
    }, PROVIDERS.map(option => h('option', { key: option.value, value: option.value }, option.label))),
    h('span', { style: styles.muted, key: 'hint' },
      PROVIDERS.find(option => option.value === provider)?.hint ?? ''),
  ])

  const credentialRows = CREDENTIAL_FIELDS.filter(field => appliesTo(field, provider)).map((field) => {
    const info = credentials?.[field.role]
    const configured = info?.configured === true
    return h('div', { style: styles.field, key: field.role }, [
      h('div', { style: styles.row, key: 'head' }, [
        h('span', { style: styles.label, key: 'label' }, field.label),
        h('span', { style: styles.badge, key: 'badge' },
          configured ? `已配置${info?.source === 'environment' ? '（来自环境变量）' : ''}` : '未配置'),
        h('span', { style: { flex: 1 }, key: 'spacer' }),
        configured && info?.writable === true
          ? h('button', { style: styles.button, key: 'clear', type: 'button', disabled: busy, onClick: () => { void clear(field.role, field.label) } }, '清除')
          : null,
      ]),
      h('input', {
        key: 'input',
        style: styles.input,
        type: 'password',
        autoComplete: 'off',
        placeholder: configured ? '输入新值以覆盖' : '粘贴以保存',
        value: secrets[field.role] ?? '',
        onChange: event => setSecrets(current => ({ ...current, [field.role]: event.target.value })),
      }),
      h('span', { style: styles.muted, key: 'hint' }, field.hint),
    ])
  })

  const header = h('button', {
    type: 'button',
    style: styles.header,
    'aria-expanded': open,
    'aria-label': `${open ? '折叠' : '展开'}: ${TITLE}`,
    onClick: () => setOpen(!open),
  }, [
    h('span', { style: styles.headText, key: 'text' }, [
      h('span', { style: styles.name, key: 'name' }, TITLE),
      h('span', { style: styles.description, key: 'desc' }, concurrency === null
        ? DESCRIPTION
        : `${DESCRIPTION} · 占用 ${concurrency.active}/${concurrency.maxConcurrency}${concurrency.queued > 0 ? `，排队 ${concurrency.queued}` : ''}`),
    ]),
    dirty ? h(Tag, { tone: 'neutral', key: 'pending' }, '未保存') : null,
    h(Chevron, { open, key: 'chevron' }),
  ])

  const body = open
    ? h('div', { style: styles.body }, [
      h('span', { style: styles.muted, key: 'hint' }, '密钥保存在 dsh 凭据库（.credentials.yaml），不写入设置文件；设置改动立即生效。'),
      h('div', { style: styles.grid, key: 'text' }, [...TEXT_FIELDS, ...NATIVE_FIELDS].filter(field => appliesTo(field, provider)).map(field => h(Field, { key: field.key, label: field.label, hint: field.hint }, [
        h('input', {
          key: 'input',
          style: styles.input,
          value: valueOf(field.key),
          placeholder: settings[field.key] ?? '',
          onChange: event => setDraft(current => ({ ...current, [field.key]: event.target.value })),
        }),
      ]))),
      h('div', { style: styles.grid, key: 'numbers' }, NUMBER_FIELDS.map(field => h(Field, { key: field.key, label: field.label, hint: field.hint }, [
        h('input', {
          key: 'input',
          style: styles.input,
          inputMode: 'numeric',
          value: draft[field.key] ?? String(settings[field.key] ?? ''),
          onChange: event => setDraft(current => ({ ...current, [field.key]: event.target.value })),
        }),
      ]))),
      providerRow,
    h('div', { style: styles.grid, key: 'credentials' }, credentialRows),
      h('div', { style: { ...styles.row, gap: '8px' }, key: 'actions' }, [
        h('button', { style: styles.button, key: 'save', type: 'button', disabled: busy, onClick: () => { void save() } }, busy ? '处理中…' : '保存'),
        h('button', { style: styles.button, key: 'discard', type: 'button', disabled: !dirty || busy, onClick: discard }, '放弃改动'),
        h('button', { style: styles.button, key: 'test', type: 'button', disabled: busy, onClick: () => { void test() } }, '测试连接'),
        h('button', {
          style: styles.button,
          key: 'reload',
          type: 'button',
          disabled: busy,
          onClick: () => { void bridge('/settings').then(adopt) },
        }, '重新读取'),
      ]),
      status === null ? null : h('span', {
        key: 'status',
        style: { ...styles.status, color: status.ok ? 'inherit' : '#e5534b' },
      }, status.message),
    ])
    : null

  return h('li', {
    style: open ? { ...styles.card, ...styles.cardOpen } : styles.card,
    'data-hunyuan-card': true,
    'data-open': open ? 'true' : undefined,
  }, [
    h('span', { key: 'header', style: { display: 'contents' } }, header),
    body,
  ])
}

/**
 * Browser-half plugin entry. `slots` is the only service needed: the card draws
 * its own internals and reaches the host through the plugin's HTTP bridge.
 */
export const inject = ['slots']

export function apply(ctx) {
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
  }, HunyuanSettingsCard))
}
