# dsc-provider-switch

[简体中文](README.md) | [English]

dsc-provider-switch is a dsc plugin that picks a provider endpoint for every model capability along capability dimensions: the plugin ships three built-in endpoint descriptors, registers them with the host through `context.provider.registerSource` on activation, and provides two `context.provider.run` wrappers for its own calls, one for text generation and one for model listing. Each descriptor declares which model capabilities the endpoint supports (text generation, system prompt, thinking, vision input and so on), endpoints slot in by capability dimension, and the host decides which one to use. The plugin also declares its settings surface through `settings:surface`: endpoint toggles, API keys and custom compatible-endpoint base URLs are all filled in on the host settings page.

The documentation index lives in [docs/README.md](docs/README.md); the settled mechanics and their rationale are recorded in [docs/design/provider-sources.md](docs/design/provider-sources.md) (Chinese).

## Positioning

| Item | Description |
|:---:|:---:|
| Audience | dsc users and hosts that need to pick a provider endpoint per model capability |
| Registration | Registers the built-in endpoint descriptors with the host via `context.provider.registerSource` on activation, and the settings field descriptors via `settings:surface` for the host settings page |
| Wrappers | `runTextGenerate` and `runModelsList`, which validate a protocol-agnostic request against the descriptor, filter endpoints disabled in settings, and hand the payload to `context.provider.run` |
| Not done | Never rewrites any host conversation request; does not pick endpoints; never reads, stores or passes any credentials |

## Built-in endpoints

The three built-in descriptors are ordered by priority, and the order is the registration order at activation; the JSON copies live under [schemas/examples/](schemas/examples/), and tests assert that the in-memory objects match the copies verbatim so neither side can drift.

| Order | id | Dialect | Base URL | Chat path | Capabilities |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `deepseek-anthropic` | `anthropic-compatible` | `https://api.deepseek.com` | `/anthropic/v1/messages` | 3 |
| 2 | `openai` | `openai-compatible` | `https://api.openai.com/v1` | `/chat/completions` | 5 |
| 3 | `anthropic` | `anthropic-compatible` | `https://api.anthropic.com` | `/v1/messages` | 7 |

Capability coverage of the three endpoints:

| Capability | deepseek-anthropic | openai | anthropic |
|:---:|:---:|:---:|:---:|
| `text:generate` text generation | yes | yes | yes, `max_tokens` required |
| `prompt:system` system prompt | yes, top-level field | yes, `system` message | yes, top-level field |
| `reasoning:think` thinking | yes, `type-toggle` | yes, `effort-level` | yes, `type-toggle` with thinking budget |
| `vision:image` image input | no | yes | yes, base64, URL and file-id |
| `document:read` document input | no | no | yes, base64 and file-id |
| `tool:web-search` web search | no | yes, request-side tool | yes, server tool |
| `tool:read-url` URL reading | no | no | yes, server tool |

Why DeepSeek uses the `anthropic-compatible` dialect and how dialects map to engine descriptors are covered by the comparison tables in sections 2 and 3 of [docs/design/provider-sources.md](docs/design/provider-sources.md) (Chinese); the engine execution layer only implements the `anthropic-messages` route in this version, so the openai endpoint is registered but not yet callable — see the gap list in section 6 of the design document.

## Usage

- **Endpoints register automatically after installation.** Activation registers the three endpoints in the built-in order; declaring makes no network request. The plugin never sees credentials — keys are read by the engine only at execution time.
- **Configure on the host settings page.** Installed plugin list → click the plugin name to open its detail page → the host renders the form from the descriptor. Each built-in endpoint gets an enable toggle and an API Key input (write-only; whether a key is configured is known to the host alone). Two optional inputs, "custom OpenAI-compatible endpoint baseUrl" and "custom Anthropic-compatible endpoint baseUrl", register a custom endpoint when filled in and register nothing when left empty. Setting values are persisted by the host and take effect after saving.
- **Two wrappers for callers.** `runTextGenerate` validates parameter declarations, value ranges and capability support before assembling the payload, and throws a `SourceAssemblyError` with a `code` on failure; before every run it re-reads the settings and filters disabled endpoints (the host has no change-push capability this round, so the plugin polls the settings before each run) and refuses a disabled endpoint with `endpoint-disabled` without issuing a request or spending quota. `runModelsList` collapses the model list into an array of model ids. Engine errors are never swallowed, retried or downgraded — they are rethrown to the caller as-is: an endpoint without a key fails at execution time with `credential-missing`.
- **Registration timing of custom endpoints.** Custom endpoints are registered from the settings values read at activation; after a settings-page edit, the run-side enable state and descriptor selection follow the settings immediately, but the registration in the engine registry waits until the plugin is reactivated. The gap list lives in section 6 of [docs/design/provider-sources.md](docs/design/provider-sources.md) (Chinese).

## Repository layout

```text
dsc-provider-switch/
├── .env.example              # local integration address template
├── .gitattributes            # unified LF across the repository
├── .gitignore
├── .npmrc
├── COPYRIGHT                 # copyright notice
├── LICENSE
├── README.md                 # Chinese main text for developers
├── README.en-US.md           # English version, maintained in sync with README.md
├── build.mjs                 # build entry: bundling and meta self-validation
├── package.json              # project metadata, the data source of meta.json
├── pnpm-workspace.yaml       # pnpm 12 build-script allowlist
├── tsconfig.json
├── docs/
│   ├── README.md             # documentation index
│   ├── spec.md               # source descriptor specification
│   ├── doubao-ark-research.md # Doubao provider research
│   ├── schema-audit-report.md # draft audit findings
│   ├── draft-source-descriptor.json # draft source descriptor sample
│   ├── source-descriptor.schema.draft.json # draft source descriptor schema
│   └── design/
│       └── provider-sources.md # provider design: dialects, registration, wrappers and gaps
├── schemas/                  # schemas and samples for source descriptors, manifest and runtime meta
├── scripts/
│   ├── test/
│   │   ├── ts-hooks.mjs      # loader hook so tests import .ts sources directly
│   │   ├── sources.test.ts   # tests for built-in descriptors, conversion and wrappers
│   │   └── settings.test.ts  # tests for the settings surface, enable filtering and missing-key handling
│   └── validate-specs.mjs    # zero-dependency spec validation script
├── specs/                    # spec copies: runtime spec, development spec and version info
└── src/
    ├── index.ts              # activate and deactivate entry; registers built-in endpoints and declares the settings surface on activation
    ├── manifest.ts           # runtime manifest
    ├── types.ts              # contract types
    └── sources/
        ├── descriptor.ts     # dialect descriptor to engine CoreSourceDescriptor
        ├── register.ts       # built-in endpoint registration
        ├── run.ts            # the two wrappers for text generation and model listing
        ├── settings.ts       # settings surface: field descriptors, enable state and custom endpoints
        └── validate.ts       # runtime validation before registration
```

## Development commands

| Command | Purpose |
|:---:|:---:|
| `pnpm run build` | Build artifacts into `dist/`: bundle `plugin.js`, generate and self-validate `meta.json` from `package.json`, write the `MUST_PLUSH_WITH_PACKAGE` marker |
| `pnpm run type` | Run `tsc --noEmit` for type checking |
| `pnpm run test` | Run the zero-dependency `node:test` suite, which loads the TypeScript sources under `src` directly |
| `pnpm run validate:specs` | Validate the spec-area schemas, positive and negative samples, and this repository's meta data |

Tests and validation are zero-dependency and run offline, with no network access and no dependency installation; running the tests needs Node 22.18 or newer (built-in type stripping).
