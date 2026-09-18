/**
 * Minimal Node HTTP doubles shared by the route tests.
 *
 * Both the routes suite and the concurrency suite assert on what a handler wrote,
 * so the doubles live here rather than being copied per suite.
 */

/** A ServerResponse double that records what a handler wrote. */
export function fakeResponse() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(chunk) { this.body += chunk ?? '' },
    json() { return JSON.parse(this.body) },
  }
}

/**
 * An IncomingMessage double: headers plus an async-iterable body.
 * @param {{ method?: string, url?: string, headers?: Record<string, string>, payload?: unknown, remoteAddress?: string }} [options]
 */
export function fakeRequest({ method = 'GET', url = '/', headers = {}, payload, remoteAddress = '127.0.0.1' } = {}) {
  const request = {
    method,
    url,
    headers: { host: '127.0.0.1:8080', 'sec-fetch-site': 'same-origin', ...headers },
    socket: { remoteAddress },
  }
  request[Symbol.asyncIterator] = async function* () {
    if (payload !== undefined) yield Buffer.from(JSON.stringify(payload), 'utf8')
  }
  return request
}
