/**
 * TC3-HMAC-SHA256 request signing for Tencent Cloud OpenAPI.
 *
 * Mirrors the canonical algorithm shipped in `tencentcloud-sdk-nodejs-common`
 * (`tencentcloud/common/sign.js` + `common/http/http_connection.js`) so this
 * plugin carries no SDK dependency:
 *
 *   canonicalRequest = METHOD \n uri \n query \n canonicalHeaders \n signedHeaders \n sha256hex(payload)
 *   stringToSign     = "TC3-HMAC-SHA256" \n timestamp \n scope \n sha256hex(canonicalRequest)
 *   scope            = "YYYY-MM-DD/<service>/tc3_request"   (date is UTC)
 *   kSigning         = HMAC(HMAC(HMAC("TC3"+secretKey, date), service), "tc3_request")
 *   signature        = HMAC-hex(kSigning, stringToSign)
 *
 * Only `content-type` and `host` are signed, in that order, exactly as the SDK
 * builds them for a JSON POST.
 */

import { createHash, createHmac } from 'node:crypto'

/** @param {string | Buffer} message */
export function sha256Hex(message) {
  return createHash('sha256').update(message).digest('hex')
}

/**
 * @param {string | Buffer} message
 * @param {string | Buffer} secret
 * @param {'hex' | undefined} [encoding]
 */
export function hmacSha256(message, secret, encoding) {
  return createHmac('sha256', secret).update(message).digest(encoding)
}

/** UTC `YYYY-MM-DD` credential-scope date. @param {number} timestampSeconds */
export function utcDate(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

/**
 * Build the `Authorization` header for one OpenAPI call.
 * @param {object} input
 * @param {string} input.secretId
 * @param {string} input.secretKey
 * @param {string} input.service - Endpoint first label, e.g. `ai3d`.
 * @param {string} input.host - Request host, e.g. `ai3d.tencentcloudapi.com`.
 * @param {string} input.action - OpenAPI action name.
 * @param {string} input.version - API version, e.g. `2025-05-13`.
 * @param {string} input.region
 * @param {string} input.payload - Exact request body text that will be sent.
 * @param {number} input.timestamp - Unix seconds.
 * @param {string} [input.contentType]
 * @param {string} [input.token] - Optional STS token.
 * @returns {string} Authorization header value.
 */
export function buildAuthorization(input) {
  const contentType = input.contentType ?? 'application/json; charset=utf-8'
  const canonicalHeaders = `content-type:${contentType}\nhost:${input.host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.payload),
  ].join('\n')

  const date = utcDate(input.timestamp)
  const scope = `${date}/${input.service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', String(input.timestamp), scope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmacSha256(date, `TC3${input.secretKey}`)
  const kService = hmacSha256(input.service, kDate)
  const kSigning = hmacSha256('tc3_request', kService)
  const signature = hmacSha256(stringToSign, kSigning, 'hex')

  return `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}
