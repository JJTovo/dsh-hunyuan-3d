window.__ModuleLoader__.load({
	id: "dsh-hunyuan-3d",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client/index.js
		var index_exports = {};
		__export(index_exports, {
		  HunyuanSettingsCard: () => HunyuanSettingsCard,
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(index_exports);
		var import_react = require("react");
		var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		var BRIDGE = "/api/dsh-hunyuan-3d";
		var NS = "hunyuan-3d";
		var TITLE = "\u817E\u8BAF\u4E91\u6DF7\u5143\u751F3D";
		var DESCRIPTION = "\u6DF7\u5143\u751F3D \u5EFA\u6A21\uFF1A\u63A5\u53E3\u65B9\u5F0F\u3001\u5BC6\u94A5\u4E0E\u751F\u6210\u53C2\u6570";
		var PROVIDERS = [
		  { value: "compatible", label: "OpenAI \u517C\u5BB9\u63A5\u53E3\uFF08API Key\uFF09", hint: "api.ai3d.cloud.tencent.com/v1/ai3d/*\uFF0C\u7528\u63A7\u5236\u53F0\u521B\u5EFA\u7684 API Key" },
		  { value: "native", label: "\u539F\u751F\u4E91 API\uFF08TC3 \u7B7E\u540D\uFF09", hint: "ai3d.tencentcloudapi.com\uFF0C\u7528 SecretId/SecretKey \u7B7E\u540D" }
		];
		var TEXT_FIELDS = [
		  { key: "baseUrl", label: "OpenAI \u517C\u5BB9 base URL", hint: "\u9ED8\u8BA4 https://api.ai3d.cloud.tencent.com", providers: ["compatible"] },
		  { key: "resultDir", label: "\u6A21\u578B\u4FDD\u5B58\u76EE\u5F55", hint: "\u7559\u7A7A\u5219\u5199\u5165 $DSH_HOME/hunyuan-3d" }
		];
		var NATIVE_FIELDS = [
		  { key: "region", label: "\u533A\u57DF (region)", hint: "\u4F8B\u5982 ap-guangzhou", providers: ["native"] },
		  { key: "endpoint", label: "\u63A5\u53E3\u57DF\u540D (endpoint)", hint: "\u9ED8\u8BA4 ai3d.tencentcloudapi.com", providers: ["native"] }
		];
		var NUMBER_FIELDS = [
		  { key: "maxConcurrency", label: "\u5E76\u53D1\u4E0A\u9650", hint: "\u670D\u52A1\u7AEF\u9650\u5236\u4E3A 3\uFF1B\u8C03\u5C0F\u53EF\u7701\u989D\u5EA6\u5360\u7528" },
		  { key: "queueLimit", label: "\u6392\u961F\u4E0A\u9650" },
		  { key: "queueTimeoutMs", label: "\u6392\u961F\u8D85\u65F6 (ms)" },
		  { key: "pollIntervalMs", label: "\u8F6E\u8BE2\u95F4\u9694 (ms)" },
		  { key: "defaultWaitMs", label: "\u9ED8\u8BA4\u7B49\u5F85\u4E0A\u9650 (ms)" },
		  { key: "httpTimeoutMs", label: "\u5355\u6B21\u8BF7\u6C42\u8D85\u65F6 (ms)" }
		];
		var CREDENTIAL_FIELDS = [
		  { role: "apiKey", label: "API Key", hint: "\u63A7\u5236\u53F0\u300CAPI KEY\u300D\u9875\u521B\u5EFA\uFF0C\u5F62\u5982 sk-xxxx\uFF08\u4EC5\u5199\u5165\uFF0C\u4E0D\u56DE\u663E\uFF09", providers: ["compatible"] },
		  { role: "secretId", label: "SecretId", hint: "\u817E\u8BAF\u4E91\u8BBF\u95EE\u5BC6\u94A5 ID", providers: ["native"] },
		  { role: "secretKey", label: "SecretKey", hint: "\u817E\u8BAF\u4E91\u8BBF\u95EE\u5BC6\u94A5 Key\uFF08\u4EC5\u5199\u5165\uFF0C\u4E0D\u56DE\u663E\uFF09", providers: ["native"] },
		  { role: "token", label: "STS Token", hint: "\u4EC5\u4F7F\u7528\u4E34\u65F6\u51ED\u636E\u65F6\u9700\u8981", providers: ["native"] }
		];
		async function bridge(path, init) {
		  const response = await fetch(`${BRIDGE}${path}`, {
		    credentials: "same-origin",
		    headers: { "content-type": "application/json" },
		    ...init
		  });
		  if (!response.ok) throw new Error(`HTTP ${response.status}`);
		  return await response.json();
		}
		var styles = {
		  card: {
		    listStyle: "none",
		    border: "0.5px solid var(--dsw-alias-border-l4)",
		    borderRadius: "16px",
		    background: "var(--dsw-alias-bg-layer-3)",
		    transition: "border-color .16s, background .16s",
		    margin: "0 0 8px"
		  },
		  cardOpen: { background: "var(--dsw-alias-bg-layer-2)", borderColor: "var(--dsw-alias-label-dimmed)" },
		  header: {
		    width: "100%",
		    appearance: "none",
		    border: 0,
		    background: "none",
		    font: "inherit",
		    color: "inherit",
		    textAlign: "left",
		    cursor: "pointer",
		    display: "flex",
		    alignItems: "center",
		    gap: "12px",
		    padding: "14px 16px",
		    borderRadius: "12px"
		  },
		  headText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" },
		  name: { fontSize: "15px", fontWeight: 600, lineHeight: 1.4, color: "var(--dsw-alias-label-primary)" },
		  description: { fontSize: "13px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" },
		  chevron: { flex: "none", color: "var(--dsw-alias-label-tertiary)", transition: "transform .16s" },
		  chevronOpen: { transform: "rotate(180deg)" },
		  body: {
		    borderTop: "0.5px solid var(--dsw-alias-border-l2)",
		    margin: "0 16px",
		    padding: "12px 0",
		    display: "flex",
		    flexDirection: "column",
		    gap: "14px",
		    fontSize: "13px",
		    lineHeight: 1.5
		  },
		  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px 16px" },
		  field: { display: "flex", flexDirection: "column", gap: "4px" },
		  label: { fontWeight: 500 },
		  muted: { opacity: 0.65, fontSize: "12px" },
		  input: {
		    padding: "6px 8px",
		    borderRadius: "6px",
		    border: "1px solid var(--dsw-alias-border-l4)",
		    background: "var(--dsw-alias-bg-layer-3)",
		    color: "inherit",
		    fontSize: "13px",
		    fontFamily: "inherit"
		  },
		  row: { display: "flex", alignItems: "flex-end", gap: "8px" },
		  button: {
		    padding: "6px 14px",
		    borderRadius: "6px",
		    border: "1px solid var(--dsw-alias-border-l4)",
		    background: "var(--dsw-alias-bg-layer-3)",
		    color: "inherit",
		    cursor: "pointer",
		    fontSize: "13px",
		    fontFamily: "inherit"
		  },
		  badge: {
		    borderRadius: "999px",
		    padding: "1px 8px",
		    fontSize: "11px",
		    border: "1px solid var(--dsw-alias-border-l4)",
		    color: "var(--dsw-alias-label-tertiary)"
		  },
		  status: { fontSize: "12px" }
		};
		function Chevron(props) {
		  return (0, import_react.createElement)("svg", {
		    viewBox: "0 0 14 14",
		    width: 14,
		    height: 14,
		    "aria-hidden": "true",
		    style: props.open === true ? { ...styles.chevron, ...styles.chevronOpen } : styles.chevron
		  }, (0, import_react.createElement)("path", {
		    d: "M3.5 5.25 7 8.75l3.5-3.5",
		    fill: "none",
		    stroke: "currentColor",
		    strokeWidth: 1.4,
		    strokeLinecap: "round",
		    strokeLinejoin: "round"
		  }));
		}
		function appliesTo(field, provider) {
		  return field.providers === void 0 || field.providers.includes(provider);
		}
		function Field(props) {
		  return (0, import_react.createElement)("label", { style: styles.field }, [
		    (0, import_react.createElement)("span", { style: styles.label, key: "label" }, props.label),
		    ...props.children,
		    props.hint === void 0 ? null : (0, import_react.createElement)("span", { style: styles.muted, key: "hint" }, props.hint)
		  ]);
		}
		function HunyuanSettingsCard(props) {
		  const initial = props?.initial ?? null;
		  const [settings, setSettings] = (0, import_react.useState)(initial?.settings ?? null);
		  const [credentials, setCredentials] = (0, import_react.useState)(initial?.credentials ?? null);
		  const [draft, setDraft] = (0, import_react.useState)({});
		  const [secrets, setSecrets] = (0, import_react.useState)({});
		  const [status, setStatus] = (0, import_react.useState)(null);
		  const [busy, setBusy] = (0, import_react.useState)(false);
		  const [open, setOpen] = (0, import_react.useState)(props?.defaultOpen === true);
		  const [provider, setProvider] = (0, import_react.useState)(initial?.settings?.provider ?? "compatible");
		  const [concurrency, setConcurrency] = (0, import_react.useState)(initial?.concurrency ?? null);
		  const mounted = (0, import_react.useRef)(true);
		  const saveStarted = (0, import_react.useRef)(false);
		  const dirty = Object.keys(draft).length > 0 || Object.values(secrets).some((value) => value !== "");
		  (0, import_react.useEffect)(() => {
		    if (busy) {
		      saveStarted.current = true;
		      return;
		    }
		    if (!saveStarted.current) return;
		    saveStarted.current = false;
		    if (!dirty && status?.ok === true) setOpen(false);
		  }, [busy, dirty, status]);
		  const adopt = (payload) => {
		    if (mounted.current !== true) return;
		    setSettings(payload.settings);
		    setCredentials(payload.credentials);
		    if (payload.concurrency !== void 0) setConcurrency(payload.concurrency);
		    setProvider(payload.settings?.provider ?? "compatible");
		    setDraft({});
		    setSecrets({});
		  };
		  (0, import_react.useEffect)(() => {
		    mounted.current = true;
		    if (initial !== null) return () => {
		      mounted.current = false;
		    };
		    bridge("/settings").then(adopt).catch((error) => {
		      if (mounted.current) setStatus({ ok: false, message: `\u8BFB\u53D6\u8BBE\u7F6E\u5931\u8D25\uFF1A${error.message}` });
		    });
		    return () => {
		      mounted.current = false;
		    };
		  }, []);
		  if (settings === null) {
		    return (0, import_react.createElement)("li", { style: styles.card, "data-hunyuan-card": true, "data-open": void 0 }, (0, import_react.createElement)("div", { style: styles.header }, (0, import_react.createElement)("span", { style: styles.headText }, [
		      (0, import_react.createElement)("span", { style: styles.name, key: "name" }, TITLE),
		      (0, import_react.createElement)("span", { style: styles.description, key: "desc" }, status?.message ?? "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026")
		    ])));
		  }
		  const valueOf = (key) => draft[key] ?? settings[key] ?? "";
		  const save = async () => {
		    setBusy(true);
		    setStatus(null);
		    try {
		      const typed = { ...draft, provider };
		      for (const field of NUMBER_FIELDS) {
		        if (typed[field.key] !== void 0 && typed[field.key] !== "") typed[field.key] = Number(typed[field.key]);
		      }
		      const saved = await bridge("/settings", { method: "POST", body: JSON.stringify({ settings: typed }) });
		      if (saved.ok !== true) {
		        setStatus({ ok: false, message: saved.message ?? "\u4FDD\u5B58\u5931\u8D25" });
		        return;
		      }
		      adopt(saved);
		      const written = [];
		      for (const field of CREDENTIAL_FIELDS) {
		        if (!appliesTo(field, provider)) continue;
		        const value = (secrets[field.role] ?? "").trim();
		        if (value === "") continue;
		        const result = await bridge("/credentials", { method: "POST", body: JSON.stringify({ role: field.role, action: "set", value }) });
		        if (result.ok !== true) {
		          setStatus({ ok: false, message: `${field.label} \u4FDD\u5B58\u5931\u8D25\uFF1A${result.message ?? ""}` });
		          return;
		        }
		        written.push(field.label);
		        setCredentials(result.credentials);
		      }
		      setSecrets({});
		      setStatus({ ok: true, message: written.length === 0 ? "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002" : `\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u5BC6\u94A5\u5DF2\u66F4\u65B0\uFF1A${written.join("\u3001")}\u3002` });
		    } catch (error) {
		      setStatus({ ok: false, message: `\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}` });
		    } finally {
		      setBusy(false);
		    }
		  };
		  const discard = () => {
		    setDraft({});
		    setSecrets({});
		    setStatus({ ok: true, message: "\u5DF2\u653E\u5F03\u672A\u4FDD\u5B58\u7684\u6539\u52A8\u3002" });
		  };
		  const clear = async (role, label) => {
		    setBusy(true);
		    setStatus(null);
		    try {
		      const result = await bridge("/credentials", { method: "POST", body: JSON.stringify({ role, action: "unset" }) });
		      if (result.ok !== true) {
		        setStatus({ ok: false, message: `\u6E05\u9664 ${label} \u5931\u8D25\uFF1A${result.message ?? ""}` });
		        return;
		      }
		      setCredentials(result.credentials);
		      setStatus({ ok: true, message: `${label} \u5DF2\u6E05\u9664\u3002` });
		    } catch (error) {
		      setStatus({ ok: false, message: `\u6E05\u9664 ${label} \u5931\u8D25\uFF1A${error.message}` });
		    } finally {
		      setBusy(false);
		    }
		  };
		  const test = async () => {
		    setBusy(true);
		    setStatus({ ok: true, message: "\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026" });
		    try {
		      const result = await bridge("/test", { method: "POST", body: "{}" });
		      setStatus({ ok: result.ok === true, message: result.message ?? "" });
		    } catch (error) {
		      setStatus({ ok: false, message: `\u6D4B\u8BD5\u5931\u8D25\uFF1A${error.message}` });
		    } finally {
		      setBusy(false);
		    }
		  };
		  const providerRow = (0, import_react.createElement)("div", { style: styles.field, key: "provider" }, [
		    (0, import_react.createElement)("span", { style: styles.label, key: "label" }, "\u63A5\u53E3\u65B9\u5F0F"),
		    (0, import_react.createElement)("select", {
		      key: "select",
		      style: styles.input,
		      value: provider,
		      onChange: (event) => setProvider(event.target.value)
		    }, PROVIDERS.map((option) => (0, import_react.createElement)("option", { key: option.value, value: option.value }, option.label))),
		    (0, import_react.createElement)(
		      "span",
		      { style: styles.muted, key: "hint" },
		      PROVIDERS.find((option) => option.value === provider)?.hint ?? ""
		    )
		  ]);
		  const credentialRows = CREDENTIAL_FIELDS.filter((field) => appliesTo(field, provider)).map((field) => {
		    const info = credentials?.[field.role];
		    const configured = info?.configured === true;
		    return (0, import_react.createElement)("div", { style: styles.field, key: field.role }, [
		      (0, import_react.createElement)("div", { style: styles.row, key: "head" }, [
		        (0, import_react.createElement)("span", { style: styles.label, key: "label" }, field.label),
		        (0, import_react.createElement)(
		          "span",
		          { style: styles.badge, key: "badge" },
		          configured ? `\u5DF2\u914D\u7F6E${info?.source === "environment" ? "\uFF08\u6765\u81EA\u73AF\u5883\u53D8\u91CF\uFF09" : ""}` : "\u672A\u914D\u7F6E"
		        ),
		        (0, import_react.createElement)("span", { style: { flex: 1 }, key: "spacer" }),
		        configured && info?.writable === true ? (0, import_react.createElement)("button", { style: styles.button, key: "clear", type: "button", disabled: busy, onClick: () => {
		          void clear(field.role, field.label);
		        } }, "\u6E05\u9664") : null
		      ]),
		      (0, import_react.createElement)("input", {
		        key: "input",
		        style: styles.input,
		        type: "password",
		        autoComplete: "off",
		        placeholder: configured ? "\u8F93\u5165\u65B0\u503C\u4EE5\u8986\u76D6" : "\u7C98\u8D34\u4EE5\u4FDD\u5B58",
		        value: secrets[field.role] ?? "",
		        onChange: (event) => setSecrets((current) => ({ ...current, [field.role]: event.target.value }))
		      }),
		      (0, import_react.createElement)("span", { style: styles.muted, key: "hint" }, field.hint)
		    ]);
		  });
		  const header = (0, import_react.createElement)("button", {
		    type: "button",
		    style: styles.header,
		    "aria-expanded": open,
		    "aria-label": `${open ? "\u6298\u53E0" : "\u5C55\u5F00"}: ${TITLE}`,
		    onClick: () => setOpen(!open)
		  }, [
		    (0, import_react.createElement)("span", { style: styles.headText, key: "text" }, [
		      (0, import_react.createElement)("span", { style: styles.name, key: "name" }, TITLE),
		      (0, import_react.createElement)("span", { style: styles.description, key: "desc" }, concurrency === null ? DESCRIPTION : `${DESCRIPTION} \xB7 \u5360\u7528 ${concurrency.active}/${concurrency.maxConcurrency}${concurrency.queued > 0 ? `\uFF0C\u6392\u961F ${concurrency.queued}` : ""}`)
		    ]),
		    dirty ? (0, import_react.createElement)(import_dsh_client_ui_primitives.Tag, { tone: "neutral", key: "pending" }, "\u672A\u4FDD\u5B58") : null,
		    (0, import_react.createElement)(Chevron, { open, key: "chevron" })
		  ]);
		  const body = open ? (0, import_react.createElement)("div", { style: styles.body }, [
		    (0, import_react.createElement)("span", { style: styles.muted, key: "hint" }, "\u5BC6\u94A5\u4FDD\u5B58\u5728 dsh \u51ED\u636E\u5E93\uFF08.credentials.yaml\uFF09\uFF0C\u4E0D\u5199\u5165\u8BBE\u7F6E\u6587\u4EF6\uFF1B\u8BBE\u7F6E\u6539\u52A8\u7ACB\u5373\u751F\u6548\u3002"),
		    (0, import_react.createElement)("div", { style: styles.grid, key: "text" }, [...TEXT_FIELDS, ...NATIVE_FIELDS].filter((field) => appliesTo(field, provider)).map((field) => (0, import_react.createElement)(Field, { key: field.key, label: field.label, hint: field.hint }, [
		      (0, import_react.createElement)("input", {
		        key: "input",
		        style: styles.input,
		        value: valueOf(field.key),
		        placeholder: settings[field.key] ?? "",
		        onChange: (event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))
		      })
		    ]))),
		    (0, import_react.createElement)("div", { style: styles.grid, key: "numbers" }, NUMBER_FIELDS.map((field) => (0, import_react.createElement)(Field, { key: field.key, label: field.label, hint: field.hint }, [
		      (0, import_react.createElement)("input", {
		        key: "input",
		        style: styles.input,
		        inputMode: "numeric",
		        value: draft[field.key] ?? String(settings[field.key] ?? ""),
		        onChange: (event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))
		      })
		    ]))),
		    providerRow,
		    (0, import_react.createElement)("div", { style: styles.grid, key: "credentials" }, credentialRows),
		    (0, import_react.createElement)("div", { style: { ...styles.row, gap: "8px" }, key: "actions" }, [
		      (0, import_react.createElement)("button", { style: styles.button, key: "save", type: "button", disabled: busy, onClick: () => {
		        void save();
		      } }, busy ? "\u5904\u7406\u4E2D\u2026" : "\u4FDD\u5B58"),
		      (0, import_react.createElement)("button", { style: styles.button, key: "discard", type: "button", disabled: !dirty || busy, onClick: discard }, "\u653E\u5F03\u6539\u52A8"),
		      (0, import_react.createElement)("button", { style: styles.button, key: "test", type: "button", disabled: busy, onClick: () => {
		        void test();
		      } }, "\u6D4B\u8BD5\u8FDE\u63A5"),
		      (0, import_react.createElement)("button", {
		        style: styles.button,
		        key: "reload",
		        type: "button",
		        disabled: busy,
		        onClick: () => {
		          void bridge("/settings").then(adopt);
		        }
		      }, "\u91CD\u65B0\u8BFB\u53D6")
		    ]),
		    status === null ? null : (0, import_react.createElement)("span", {
		      key: "status",
		      style: { ...styles.status, color: status.ok ? "inherit" : "#e5534b" }
		    }, status.message)
		  ]) : null;
		  return (0, import_react.createElement)("li", {
		    style: open ? { ...styles.card, ...styles.cardOpen } : styles.card,
		    "data-hunyuan-card": true,
		    "data-open": open ? "true" : void 0
		  }, [
		    (0, import_react.createElement)("span", { key: "header", style: { display: "contents" } }, header),
		    body
		  ]);
		}
		var inject = ["slots"];
		function apply(ctx) {
		  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
		    name: "settings.plugin.item",
		    key: NS
		  }, HunyuanSettingsCard));
		}

		return module.exports;
	}
});
