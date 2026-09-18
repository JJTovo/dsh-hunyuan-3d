/**
 * Result-schema validation for the standalone acceptance check.
 *
 * Prefers dsh's own validator so the CLI asserts exactly what the harness will
 * assert. When the dsh checkout is absent it falls back to a small walker that
 * covers the constructs these schemas use (object/array/string/integer/number/
 * boolean, additionalProperties, required) — enough to catch a broken result,
 * and deliberately not a general JSON Schema implementation.
 */

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DSH_TOOLS_LIB = process.env.DSH_TOOLS_LIB ?? 'E:/deepseek_harness/packages/core/tools/lib/index.js'

const dshTools = existsSync(DSH_TOOLS_LIB) ? await import(pathToFileURL(DSH_TOOLS_LIB).href) : undefined

/**
 * @param {Record<string, unknown>} schema
 * @param {unknown} value
 * @returns {string[]} path-qualified violations, empty when valid.
 */
export function validateResult(schema, value) {
  if (dshTools !== undefined) {
    return dshTools.validateJsonSchemaValue(schema, value, '')
  }
  return walk(schema, value, '$')
}

/** @param {Record<string, any>} schema @param {unknown} value @param {string} at */
function walk(schema, value, at) {
  const violations = []
  const type = schema.type
  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at}: expected object`]
    const properties = schema.properties ?? {}
    for (const name of schema.required ?? []) {
      if (!(name in value)) violations.push(`${at}.${name}: required property is missing`)
    }
    for (const [name, child] of Object.entries(value)) {
      const childSchema = properties[name]
      if (childSchema === undefined) {
        if (schema.additionalProperties === false) violations.push(`${at}.${name}: unexpected property`)
        continue
      }
      violations.push(...walk(childSchema, child, `${at}.${name}`))
    }
    return violations
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${at}: expected array`]
    if (schema.items === undefined) return violations
    for (const [index, entry] of value.entries()) violations.push(...walk(schema.items, entry, `${at}[${index}]`))
    return violations
  }
  if (type === 'string' && typeof value !== 'string') return [`${at}: expected string`]
  if (type === 'integer' && !Number.isInteger(value)) return [`${at}: expected integer`]
  if (type === 'number' && typeof value !== 'number') return [`${at}: expected number`]
  if (type === 'boolean' && typeof value !== 'boolean') return [`${at}: expected boolean`]
  return violations
}
