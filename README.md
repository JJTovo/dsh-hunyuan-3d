# dsh-hunyuan-3d

Tencent Cloud Hunyuan 3D (混元生3D, the `ai3d` OpenAPI) as dsh agent tools:
text-to-3D and image-to-3D job submission, result polling, and on-disk asset
download so later turns and other tools (Blender, format converters) can consume
a real file path.

## Tools

| Tool | Purpose |
| --- | --- |
| `hunyuan_3d_model` | Submit a modeling job and, by default, wait for it and download the assets. |
| `hunyuan_3d_query` | Re-check a job started with `wait: false`, or recover a result later. |

Both return the same canonical result: `job_id`, `mode`, `status`
(`WAIT`/`RUN`/`FAIL`/`DONE`), `message`, optional `error_code` /
`error_message` / `credits_consumed` / `credit_details`, and `files[]` with the
downloaded `path`, `bytes`, `type`, `source_url` and `preview_image_url`.

Result URLs expire 24 hours after generation, so a job that finished long ago
must be re-run rather than re-downloaded.

## Two API doors

Tencent publishes the same 3D service behind two front doors, and the plugin
supports both — pick one in the settings card:

| | OpenAI-compatible (default) | Native cloud API |
| --- | --- | --- |
| Base URL | `https://api.ai3d.cloud.tencent.com` | `https://ai3d.tencentcloudapi.com` |
| Submit | `POST /v1/ai3d/submit` | `POST /` + `X-TC-Action: SubmitHunyuanTo3DProJob` |
| Query | `POST /v1/ai3d/query` | `POST /` + `X-TC-Action: QueryHunyuanTo3DProJob` |
| Auth | `Authorization: <api key>` (console "API KEY" page) | TC3-HMAC-SHA256 (SecretId/SecretKey/Region) |
| Credentials | one key, `HUNYUAN3D_API_KEY` | `TENCENTCLOUD_SECRET_ID` + `TENCENTCLOUD_SECRET_KEY` (+ optional token) |
| Modes | `pro` only — the compatibility layer publishes no rapid endpoint | `pro` and `rapid` |

The API key is sent as the bare `Authorization` value, which is what the
documentation's cURL example uses. A gateway that refuses that shape is retried
once with `Bearer `, so OpenAI-style clients work unchanged.

The base URL may be pasted as the origin, `…/v1`, `…/v1/ai3d`, or the full
`…/v1/ai3d/submit`: the API path is stripped rather than duplicated, because a
doubled path is a routing failure the service answers with an unhelpful 4xx.

Failures report the service's own response body and status, so a rejected call
is diagnosable from the settings card without a separate request log.

Both doors share the request/response vocabulary (`Prompt`, `ImageUrl`,
`MultiViewImages`, `FaceCount`, `Status`, `ResultFile3Ds`, …), so tool arguments
and results are identical whichever you choose. Responses are read tolerantly: a
bare body and a `Response`-wrapped one both parse, and key casing is ignored.


## In-app configuration

The plugin registers a settings card under **Settings → Plugins → Configurable**
("腾讯云混元生3D"). It edits the plugin's `hunyuan-3d` settings namespace and, for
the credentials, writes through the host credential store.

| Card control | Where it lands |
| --- | --- |
| API Key (compatible) or SecretId / SecretKey / STS Token (native) | dsh credential store (`.credentials.yaml`), write-only |
| provider, baseUrl, region, endpoint | `settings.yaml` under `hunyuan-3d` |
| resultDir, pollIntervalMs, defaultWaitMs, httpTimeoutMs | `settings.yaml` under `hunyuan-3d` |

Two rules the card follows, matching dsh's shipped configuration cards:

- **A credential value never travels host → browser.** The card learns only
  whether a reference is configured and whether it is writable; typing a value
  posts it one-way. An untouched field never clears a stored key.
- **Settings take effect immediately.** The tools read the resolved section on
  every call, so a saved change applies to the next call without a restart.

The card talks to the host through a loopback-fenced bridge:

| Route | Purpose |
| --- | --- |
| `GET/POST /api/dsh-hunyuan-3d/settings` | read the resolved section + credential status; save a patch |
| `POST /api/dsh-hunyuan-3d/credentials` | `{ role, action: set \| unset, value? }` |
| `POST /api/dsh-hunyuan-3d/test` | authenticate against the live endpoint without billing (compatible: `POST /v1/ai3d/query` on a job id that cannot exist; native: `QueryHunyuanTo3DProJob` on the same) |

Non-loopback callers (foreign host, non-loopback peer address, `cross-site`
fetch metadata) get `403`; any other method gets `405`.

## Credentials

The card is the normal path; environment variables still work and win when both
are set. The plugin resolves, in order:

1. the dsh credential store (`ctx.credentials.resolve`), then
2. the process environment.

| Setting | Default reference |
| --- | --- |
| SecretId | `TENCENTCLOUD_SECRET_ID` |
| SecretKey | `TENCENTCLOUD_SECRET_KEY` |
| STS token (optional) | `TENCENTCLOUD_TOKEN` |

The contributing account needs 混元生3D activated for the region you call;
missing activation or an unauthorized action surfaces as an API error code, not
a silent failure.

Requests are signed in-process with TC3-HMAC-SHA256 (`src/tc3.js`), so no
Tencent Cloud SDK is shipped or required.

## Concurrency

The service grants a fixed number of simultaneous jobs — **three**, per the
product documentation — and answers anything beyond it with
`RequestLimitExceeded`. The plugin therefore gates submissions locally instead of
spending a round trip to learn what it already knows.

- Up to `maxConcurrency` jobs hold a service slot. Further calls **queue**.
- A slot is held for as long as the job occupies the service, not merely while a
  call is in flight. `wait: false` returns at once, and the job keeps its slot
  until a later `hunyuan_3d_query` observes `DONE` or `FAIL`.
- A call whose wait budget expires keeps its slot too, for the same reason; the
  status message says so and names the query that frees it.
- A full queue is refused with the retryable `concurrency-queue-full`; a queued
  call that waits past `queueTimeoutMs` fails with `concurrency-wait-timeout`
  and reports that **nothing was submitted**.

| Setting | Default | Meaning |
| --- | --- | --- |
| `maxConcurrency` | `3` | Simultaneous jobs. Lower it to 1 to serialize. |
| `queueLimit` | `32` | Calls allowed to wait in line before new ones are refused. |
| `queueTimeoutMs` | `600000` | How long a queued call waits before giving up. |

All three are editable in the settings card, which also shows live usage
(`占用 1/3，排队 2`). The limits are read per call, so a change applies to the
next submission without a restart.

**Abandoned jobs.** A job started with `wait: false` and never queried would hold
its slot indefinitely, which is the correct reading of "the service is still
working on it" but worth knowing: query a background job, or let
`queueTimeoutMs` bound the waiters behind it.

## Verification

```bash
npm test                            # 26 tests, no network, no credits
```

Part 1 pins the wire format: the hand-written schemas must satisfy dsh's own
schema compiler and `assertSupportedJsonSchema`, and the registered definitions
must survive dsh's `register()` guard.

Part 2 drives the real plugin against `tests/mock-ai3d.mjs` — a local double
that implements the verified envelope contract and rejects badly signed
requests — covering submit, poll, download, background mode, rapid mode, local
image inlining, cancellation, job failure, missing credentials and invalid
arguments.

The browser half is verified without a browser: `tests/client.test.mjs` runs the
real built `lib/client.js` against a loader double, renders the card with real
React, and asserts the field set, the write-only credential inputs, and that
React stays external.

The dsh checkout supplying the schema compiler defaults to
`E:/deepseek_harness/packages/core/tools/lib/index.js`; override with
`DSH_TOOLS_LIB` or those assertions skip.

### Acceptance check without dsh

```bash
node tests/mock-ai3d.mjs --port 1731 --delay-ms 400 &
TENCENTCLOUD_SECRET_ID=AKIDmock TENCENTCLOUD_SECRET_KEY=SECRETmock \
DSH_HUNYUAN3D_ENDPOINT=127.0.0.1:1731 DSH_HUNYUAN3D_SCHEME=http \
DSH_HUNYUAN3D_POLL_MS=150 DSH_HUNYUAN3D_RESULT_DIR=/tmp/hy3d-out \
  node bin/model.mjs --prompt "一只低多边形风格的宝箱" --format GLB
```

Exit code 0 means the call completed and the returned value satisfied the same
schema the model is shown. `--dry-run` prints the arguments and schema without
calling anything; `--query --job <JobId>` exercises the recovery path.

Against a real account, drop the `DSH_HUNYUAN3D_*` overrides and use real
credentials — that spends credits.

## Installing into a dsh profile

From this repository:

```bash
git clone git@github.com:JJTovo/dsh-hunyuan-3d.git
# or, without an SSH key: https://github.com/JJTovo/dsh-hunyuan-3d.git

cd "$DSH_HOME/profiles/web"
pnpm add "github:JJTovo/dsh-hunyuan-3d"
```

A git dependency runs the package's `prepare` script, so `lib/client.js` is
rebuilt from `src/client/index.js` at install time.

From a local checkout:

```bash
cd "$DSH_HOME/profiles/web"
pnpm add "file:/absolute/path/to/dsh-hunyuan-3d"
```

Then add the bundle (or the plugin row) to `cordis.patch.yml`:

```yaml
- insert:
    - id: hunyuan-3d
      name: 'dsh-hunyuan-3d'
      config:
        region: ap-guangzhou
```

A `file:` dependency is copied at install time, so re-run `pnpm add` (or
reinstall) after editing the plugin source. See `cordis.patch.yml` in this
package for the same row written as a bundle patch.


## Portability across machines

The plugin is vendored **inside the profile** and referenced by a relative path:

```json
"dsh-hunyuan-3d": "file:./plugins/dsh-hunyuan-3d"
```

so `pnpm-lock.yaml` records `directory: plugins/dsh-hunyuan-3d` — a path that
does not name a drive, a user, or an absolute location. Moving the harness home
to another machine (or another drive on the same machine) keeps it valid.

### Moving to a new machine

1. Copy the whole harness home (`$DSH_HOME`, by default `~/.dsh`) — it holds the
   profile, this plugin's source, `settings.yaml` and `.credentials.yaml`.
2. In `profiles/web`, reinstall dependencies:

   ```bash
   cd "$DSH_HOME/profiles/web"
   pnpm install
   ```

   `node_modules` may be copied or rebuilt; either works. Deleting it first is
   the cleanest, because pnpm's store paths are machine-local.
3. If you did **not** copy `.credentials.yaml`, re-enter the API key in
   Settings > Plugins > 腾讯云混元生3D.

No build step is required: `lib/client.js` (the browser half) is committed
alongside the source, so the plugin runs as shipped. `npm run build` only
regenerates it after editing `src/client/`.

### What is machine-independent

| Piece | Portable? |
| --- | --- |
| `src/`, `lib/`, `cordis.patch.yml` | yes — no absolute paths, no runtime dependencies |
| Profile dependency specifier | yes — relative (`file:./plugins/dsh-hunyuan-3d`) |
| `settings.yaml` (`provider`, `baseUrl`) | yes — non-secret, no paths |
| `.credentials.yaml` API key | travels with `$DSH_HOME`; otherwise re-enter it |
| `node_modules/` | machine-local by nature; reinstall it |
| `resultDir` | resolves from `$DSH_HOME` at runtime, never stored as an absolute path |

### Known machine-local exception

`bin/validate-result.mjs` and `tests/hunyuan3d.test.mjs` default their
`DSH_TOOLS_LIB` to a developer checkout path
(`E:/deepseek_harness/packages/core/tools/lib/index.js`). That is **test-only**:
without it those two assertions skip and everything else still runs. Set
`DSH_TOOLS_LIB` to point at your own checkout when you want the strict schema
assertions.

### When a restart is required

Editing `src/` changes files on disk, but a running host keeps the module it
already imported. dsh's `patchReload: live` re-reads patch files; it does **not**
re-import a plugin's module. After changing plugin code:

```bash
cd "$DSH_HOME/profiles/web" && pnpm install   # re-materialize the vendored copy
# then restart dsh
```

Settings changes are different — the tools read the resolved section per call,
so a saved setting applies to the next call with no restart.

### Verifying a move

```bash
cd "$DSH_HOME/profiles/web/plugins/dsh-hunyuan-3d"
npm test                       # 27 tests, no network, no credits
dsh --profile web --no-open --port 0
# expect: zero "did not activate" warnings, and the settings card lists 腾讯云混元生3D
```

## Boundaries

- **Billing.** Every completed job consumes credits; a failed job reports
  `error_code` instead of retrying, so the caller decides.
- **No retry loops.** Timeouts and network errors are marked `retryable` and
  reported; the plugin never re-submits on its own, because a retried submit can
  bill twice.
- **Concurrency.** The service allows limited simultaneous jobs per account;
  `RequestLimitExceeded` surfaces as an API error.
- **Result expiry.** Download happens within the same call that observes `DONE`,
  which keeps the plugin inside the 24-hour URL window.
- **Image inputs.** `prompt` and an image are mutually exclusive unless
  `generate_type: Sketch`; `pro` mode additionally accepts `multi_view_images`.
- **Formats.** `result_format` is a preference: the service may return OBJ plus
  GLB, or a `data:` URL, both handled on download.
