# dsc-provider-switch

[简体中文](README.md) | [English]

dsc-provider-switch is a dsc plugin that picks a provider endpoint for every model capability along capability dimensions: the plugin ships three built-in endpoint descriptors, registers them with the host through `context.provider.registerSource` on activation, and provides two `context.provider.run` wrappers for its own calls, one for text generation and one for model listing. Each descriptor declares which model capabilities the endpoint supports (text generation, system prompt, thinking, vision input and so on), endpoints slot in by capability dimension, and the host decides which one to use.

The documentation index lives in [docs/README.md](docs/README.md); the settled mechanics and their rationale are recorded in [docs/design/provider-sources.md](docs/design/provider-sources.md) (Chinese).

## Positioning

| Item | Description |
|:---:|:---:|
| Audience | dsc users and hosts that need to pick a provider endpoint per model capability |
| Registration | Registers the built-in endpoint descriptors with the host via `context.provider.registerSource` on activation |
| Wrappers | `runTextGenerate` and `runModelsList`, which validate a protocol-agnostic request against the descriptor before handing it to `context.provider.run` |
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

- **Endpoints register automatically after installation.** Activation registers the three endpoints in the built-in order; declaring makes no network request. Whether an endpoint is enabled and how credentials are filled in is decided by the host and the user; the plugin never sees the key.
- **Two wrappers for callers.** `runTextGenerate` validates parameter declarations, value ranges and capability support before assembling the payload, and throws a `SourceAssemblyError` with a `code` on failure; `runModelsList` collapses the model list into an array of model ids. Engine errors are never swallowed, retried or downgraded — they are rethrown to the caller as-is.
- **The settings UI awaits a host surface.** Endpoint listing, enable/disable toggles, key input and endpoint picking have no plugin-side entry today: the host does not yet expose a plugin settings capability, and the plugin does not build its own DOM. The gap list lives in section 6 of [docs/design/provider-sources.md](docs/design/provider-sources.md) (Chinese).

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
│   │   └── sources.test.ts   # tests for built-in descriptors, conversion and wrappers
│   └── validate-specs.mjs    # zero-dependency spec validation script
├── specs/                    # spec copies: runtime spec, development spec and version info
└── src/
    ├── index.ts              # activate and deactivate entry; registers built-in endpoints on activation
    ├── manifest.ts           # runtime manifest
    ├── types.ts              # contract types
    └── sources/
        ├── descriptor.ts     # dialect descriptor to engine CoreSourceDescriptor
        ├── register.ts       # built-in endpoint registration
        ├── run.ts            # the two wrappers for text generation and model listing
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
