/**
 * Build the browser half into the artifact dsh's client module system serves.
 *
 * The shell materializes a plugin bundle as a lazy CJS factory, so the output
 * must be exactly one `window.__ModuleLoader__.load({ id, factory })` call whose
 * factory receives the shell's `require`. React and the dsh client packages are
 * externals: the shell already owns them, and bundling a second copy would give
 * the card a different React instance than the host UI.
 *
 * Run: node scripts/build-client.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const entry = path.join(root, 'src', 'client', 'index.js')
const outFile = path.join(root, 'lib', 'client.js')

const packageName = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).name

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'transform',
  legalComments: 'none',
  logLevel: 'warning',
  // Supplied by the shell at runtime (see dsh-client-modules).
  external: [
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    '@deepseek-ai/*',
  ],
})

const code = result.outputFiles[0].text

// The loader registers a factory; the tag makes the artifact self-describing
// when it is read straight off disk.
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(packageName)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${code.split('\n').map(line => (line === '' ? '' : `\t\t${line}`)).join('\n')}
\t\treturn module.exports;
\t}
});
`

await mkdir(path.dirname(outFile), { recursive: true })
await writeFile(outFile, wrapped, 'utf8')

const externals = [...new Set([...wrapped.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]))].sort()
console.log(`built ${path.relative(root, outFile)} (${Buffer.byteLength(wrapped)} bytes)`)
console.log(`external requires: ${externals.join(', ') || '(none)'}`)
