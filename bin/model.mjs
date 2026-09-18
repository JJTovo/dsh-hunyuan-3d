/**
 * Standalone acceptance check: drive the real plugin end to end with only Node
 * builtins, so the check works in any checkout (no dsh runtime required).
 *
 *   node bin/model.mjs --prompt "一只宝箱"
 *   node bin/model.mjs --image ./ref.png --mode rapid --wait
 *   node bin/model.mjs --job mock-job-pro-1 --query
 *   node bin/model.mjs --prompt x --dry-run          # print the request instead
 *
 * Environment:
 *   TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY   credentials (required)
 *   DSH_HUNYUAN3D_ENDPOINT / _SCHEME / _SERVICE        override host, e.g. a mock
 *   DSH_HUNYUAN3D_RESULT_DIR                          where assets are written
 *
 * Against a real account this spends credits; against tests/mock-ai3d.mjs it is
 * free. Exit code 0 means the call completed and the result satisfied the tool's
 * declared schema.
 */

import { parseArgs } from 'node:util'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { validateResult } from './validate-result.mjs'

const { values } = parseArgs({
  options: {
    prompt: { type: 'string' },
    image: { type: 'string' },
    'image-url': { type: 'string' },
    mode: { type: 'string' },
    'generate-type': { type: 'string' },
    model: { type: 'string' },
    format: { type: 'string' },
    'face-count': { type: 'string' },
    pbr: { type: 'boolean' },
    'no-wait': { type: 'boolean' },
    query: { type: 'boolean' },
    job: { type: 'string' },
    'timeout-ms': { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean' },
  },
  allowPositionals: false,
})

if (values.help === true) {
  process.stdout.write('See the header of bin/model.mjs for usage.\n')
  process.exit(0)
}

/** @type {Map<string, any>} */
const tools = new Map()
const ctx = {
  tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
  credentials: { resolve: async () => undefined },
}
const { apply } = await import('../src/index.js')
const resultDir = process.env.DSH_HUNYUAN3D_RESULT_DIR ?? path.join(process.cwd(), '.dsh-hunyuan-3d')
apply(ctx, {
  ...(process.env.DSH_HUNYUAN3D_ENDPOINT === undefined ? {} : { endpoint: process.env.DSH_HUNYUAN3D_ENDPOINT }),
  ...(process.env.DSH_HUNYUAN3D_SCHEME === undefined ? {} : { scheme: process.env.DSH_HUNYUAN3D_SCHEME }),
  ...(process.env.DSH_HUNYUAN3D_SERVICE === undefined ? {} : { service: process.env.DSH_HUNYUAN3D_SERVICE }),
  ...(process.env.DSH_HUNYUAN3D_REGION === undefined ? {} : { region: process.env.DSH_HUNYUAN3D_REGION }),
  ...(process.env.DSH_HUNYUAN3D_POLL_MS === undefined ? {} : { pollIntervalMs: Number(process.env.DSH_HUNYUAN3D_POLL_MS) }),
  resultDir,
})

if (tools.size === 0) throw new Error('the plugin registered no tools')

/** Build tool arguments from the command line. */
const args = {}
if (values.query === true) {
  if (values.job === undefined) throw new Error('--query needs --job <JobId>')
  Object.assign(args, { job_id: values.job, wait: values['no-wait'] !== true, ...(values.mode === undefined ? {} : { mode: values.mode }) })
} else {
  Object.assign(args, values.prompt === undefined ? {} : { prompt: values.prompt })
  Object.assign(args, values.image === undefined ? {} : { image_path: path.resolve(values.image) })
  Object.assign(args, values['image-url'] === undefined ? {} : { image_url: values['image-url'] })
  Object.assign(args, values.mode === undefined ? {} : { mode: values.mode })
  Object.assign(args, values['generate-type'] === undefined ? {} : { generate_type: values['generate-type'] })
  Object.assign(args, values.model === undefined ? {} : { model: values.model })
  Object.assign(args, values.format === undefined ? {} : { result_format: values.format })
  Object.assign(args, values['face-count'] === undefined ? {} : { face_count: Number(values['face-count']) })
  Object.assign(args, values.pbr === true ? { enable_pbr: true } : {})
  Object.assign(args, values['no-wait'] === true ? { wait: false } : {})
  Object.assign(args, values['timeout-ms'] === undefined ? {} : { timeout_ms: Number(values['timeout-ms']) })
}

const toolName = values.query === true ? 'hunyuan_3d_query' : 'hunyuan_3d_model'
const tool = tools.get(toolName)
if (tool === undefined) throw new Error(`tool ${toolName} was not registered`)

if (values['dry-run'] === true) {
  process.stdout.write(`${JSON.stringify({ tool: toolName, arguments: args, parameters: tool.parameters }, null, 2)}\n`)
  process.exit(0)
}

await mkdir(resultDir, { recursive: true })
process.stderr.write(`[hunyuan-3d] ${toolName} -> ${process.env.DSH_HUNYUAN3D_ENDPOINT ?? 'ai3d.tencentcloudapi.com'}\n`)

let value
try {
  value = await tool.execute(args, { signal: undefined })
} catch (error) {
  process.stderr.write(`[hunyuan-3d] FAILED ${error.code ?? ''} ${error.message}\n`)
  process.exit(1)
}

// The canonical result must satisfy the schema the model was shown.
const violations = validateResult(tool.output.schema, value)
process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
if (violations.length > 0) {
  process.stderr.write(`[hunyuan-3d] result violated its declared schema: ${violations.join('; ')}\n`)
  process.exit(1)
}
process.stderr.write(`[hunyuan-3d] OK status=${value.status} files=${value.files.length}\n`)
