# 来源描述草案与全生态 Schema 惯例审计报告

> 审计对象：`docs/draft-source-descriptor.json`（57 行，未提交的草案实例）。
> 对照对象：DeepSeek-Chat-Enhanced、dsc-plugin-template、dsc-humanize-asset-template、awesome-dsc-plugin、dsc-plugin-set-template、dsc-inner-plugin 的 Schema、校验脚本与规范文本，全部只读。
> 产出：本报告 + `docs/source-descriptor.schema.draft.json`（修订后的草案 Schema，含修订后的实例作为 examples）。未创建最终 Schema 目录，未改动任何对照仓库。

## 一、结论摘要

| 项 | 结论 |
|:---:|:---:|
| 总体判定 | **需按建议修改后采用**，不可直接采用 |
| 冲突（违反成文惯例，必须改） | 6 条：能力表为开放键映射、标识分隔符、字段封闭缺失、顶层 required/additionalProperties 缺失、id 与 name 无约束、$schema/$id/title/description/examples 缺失 |
| 偏离（与惯例不一致或欠定义，建议改） | 10 条：端点拼接口径、路径无 pattern、空串哨兵、单头凭据、单值基址、逻辑参数键、stream 冗余、结构版本演进、跨字段规则无人认领、wire 字段名载体分散 |
| 可直接沿用的部分 | 顶层字段集合与命名（schemaVersion / id / name / format / endpoints / credential / capabilities）、`schemaVersion: 1` 整数形式、base 与 path 分离、能力→参数映射这一设计意图 |
| 修订后草案 | `docs/source-descriptor.schema.draft.json`，612 行，draft 2020-12，自包含，仅使用组织校验器的 31 个受支持关键字，2 个内置正例均通过 |

## 二、全生态既有惯例（问题 1）

以下每条都给出可复核的位置，行号取自当前工作区文件。

| 编号 | 惯例 | 证据 |
|:---:|:---:|:---:|
| C1 | `$schema` 恒为 `https://json-schema.org/draft/2020-12/schema`，且被校验脚本强制 | 全部 23 份 Schema 第 2 行；`dsc-plugin-template/scripts/validate-specs.mjs:339` 校验相等 |
| C2 | `$id` 恒为 `https://omds-chat.github.io/<仓库>/schemas/<路径>`，且**必须以该文件在仓库内的相对路径结尾** | `dsc-plugin-template/schemas/manifest/plugin-manifest.schema.json:3`；`dsc-plugin-set-template/schemas/README.md:35`；`validate-specs.mjs:342-346`。DCE 的 `certs/schemas/` 是唯一变体：用 `https://github.com/omds-chat/...` 前缀，同样以文件路径结尾（`certs/schemas/trust-index.schema.json:3`） |
| C3 | 顶层必有 `title` 与 `description`；`description` 用来指向规范正文，Schema 只表达结构 | `dsc-humanize-asset-template/schemas/asset-package.schema.json:4-5`；`schemas/content/labels.schema.json:5`；`dsc-plugin-set-template/schemas/README.md:22-23` |
| C4 | 每个 object 都写 `additionalProperties: false`，字段封闭被视为契约而非可选项 | `plugin-manifest.schema.json:55`；`schemas/runtime/meta.json:81`；`asset-package.schema.json:63`；`awesome-dsc-plugin/schemas/catalog-index.schema.json:33,89,99,171,181`；`manifest.schema.json:33,66`；反例 `schemas/examples/invalid/meta.extra-field.json` 专门演示多一个字段即失败 |
| C5 | `required` 逐项显式列出，不用默认值补齐 | `plugin-manifest.schema.json:49-54`；`meta.json:72-80`；`asset-package.schema.json:54-62` |
| C6 | 结构版本有两种家族，各管一段、不混用：分发清单类用整数 `schemaVersion` + `const`；资产包类用三段数字 `formatVersion` | 整数家族：`dsc-plugin-set-template/schemas/manifest.schema.json:8-12`（`schemaVersion` + `const 1`）、`awesome-dsc-plugin/schemas/catalog-index.schema.json:8-11`、DCE `certs/schemas/plugin-set-manifest.schema.json:13-16`（`const 1`）、`certs/schemas/trust-index.schema.json:14-17`（`const 2`）；三段数字家族：`asset-package.schema.json:8-11` 与 `dsc-humanize-asset-template/specs/asset-package-spec.md:288-309` |
| C7 | 未知结构版本一律按不可读处理，不做静默升级 | `DeepSeek-Chat-Enhanced/src/components/dsc-market/removed.ts:88`；同仓库 `src/services/trust/fetch.ts:84`、`src/services/integrity/manifest.ts:125`；`src/components/dsc-market/README.md:175`（其它版本按不可读处理）；`asset-package-spec.md:307` |
| C8 | 枚举封闭，且在 `description` 里写明「不接受……之外的取值」 | `plugin-manifest.schema.json:93-111`；`asset-package.schema.json:83-92`；`meta.json:114-127` |
| C9 | 能力/贡献点标识用 `namespace:verb` 冒号形式，未知取值按未知能力拒绝 | `DeepSeek-Chat-Enhanced/src/components/dsc-core/types.ts:27-38`（`sessions:list`、`net:fetch`、`chat:request`）；`plugin-manifest.schema.json:95-104`；`src/components/dsc-core/types.ts:21` 注释「插件申请时按未知能力拒绝」 |
| C10 | `pattern` 一律锚定 `^...$`、无 flags（JSON Schema 无 flags）、与校验脚本常量逐字一致；大小写不敏感需求写成 `[a-zA-Z0-9]` 并配 `maxLength` | `dsc-plugin-set-template/schemas/README.md:36`；`plugin-manifest.schema.json:59,68,77`；`versions.schema.json:31` |
| C11 | 复用一律走本地 `$defs` + 内部 `$ref`，Schema 自包含，不跨文件引用 | `schemas/README.md:36`；`trust-index.schema.json:41-67`；`asset-package.schema.json:64-93` |
| C12 | 示例两处组织：Schema 内联 `examples`（1 条完整实例）；仓库内 `schemas/examples/<对象>.<名称>.json` 为正例、`schemas/examples/invalid/<对象>.<理由>.json` 为反例，反例只演示一条规则、与正例同构 | 内联：`manifest.schema.json:34-45`、`catalog-index.schema.json:182-221`、`catalog-plugin.schema.json:53-62`、`$defs` 级 `examples`（`plugin-manifest.schema.json:61-64`）；文件：`validate-specs.mjs:18-19,380,422-443` 与 `schemas/examples/` 实际文件（14 个样例中 11 个反例、3 个正例，反例文件名形如 `manifest.bad-id.json`、`meta.extra-field.json`） |
| C13 | 版本演进要成文，并有三件套：规范版本、格式/结构版本、Schema 路径锁定 | `asset-package-spec.md:288-309`（三版本各管一段 + 次/主/修订三档规则）；`dsc-plugin-template/specs/spec-version.json`（`spec_version`、`dsc_core`、`schemas` 映射）；`dsc-humanize-asset-template/specs/spec-version.json` 增加 `format_version` |
| C14 | Schema 是书面契约、脚本是权威实现，二者必须同改；Schema 表达不了的约束只由脚本保证，并写进 `description` 或 `$comment` | `dsc-plugin-set-template/schemas/README.md:22-30`；`versions.schema.json:26`（`$comment` 记录 uniqueItems 与降序的分工） |
| C15 | 组织校验器只认 31 个关键字，出现其它关键字直接报错；因此 `patternProperties`、`propertyNames`、`if/then` 不可用 | `dsc-plugin-template/scripts/validate-specs.mjs:22-54`（白名单）与 `:294-298`（未支持关键字即 error） |
| C16 | 双语对象惯用形态是 `{zh-CN, en-US}` + `anyOf` 至少一侧 + `additionalProperties: false`，缺失侧由读取方补齐 | `dsc-plugin-template/schemas/runtime/meta.json:134-159`；`DeepSeek-Chat-Enhanced/src/components/dsc-market/types.ts:37`（`LocalizedText`）；`src/components/dsc-market/removed.ts:61-75`（单语字符串或双语对象，缺失侧互补） |
| C17 | 「来源」在生态内的既有建模是 `{ id, name, baseUrls: string[], builtin }`：id 与合集目录名一致，baseUrls 为有序兜底数组，持久化配置容忍解析并带旧 id 迁移表 | `src/components/dsc-market/types.ts:21-27`；`src/components/dsc-market/sources.ts:8-23`（规范化：去查询与片段、补尾斜杠）、`:41-47`（`LEGACY_IDS`）、`:51-70`（`DEFAULT_SOURCES` 优先级）、`:119-150`（`parseSources` 容错） |
| C18 | 站点基址类字段用 `pattern` 钉死形态（http/https 绝对地址、以斜杠结尾） | `awesome-dsc-plugin/schemas/catalog-plugin.schema.json:29-34` |
| C19 | 请求参数的逻辑名表是既有资产：`temperature`、`topP`、`maxTokens`、`stop`、`systemPromptAppend`、`systemPromptReplace`，并带取值范围 | `DeepSeek-Chat-Enhanced/src/components/dsc-plugin-engine/requestPatch.ts:7-14` |
| C20 | 同类产物若没有版本位，被视为不可扩展的缺陷并写进文档 | `dsc-inner-plugin/docs/design/pages-artifacts.md:71`、`:132`（`build-info.json` 没有 schema 版本号，不能作为对外契约） |

## 三、草案与惯例的冲突与偏离（问题 2）

位置列指向 `docs/draft-source-descriptor.json` 的行号；建议列的「修订草案」行号指向 `docs/source-descriptor.schema.draft.json`。

| 编号 | 位置 | 惯例 | 偏离点 | 建议改法 |
|:---:|:---:|:---:|:---:|:---:|
| F1 | 20-56 | C4、C8、C15 | `capabilities` 是「能力名→配置」的开放键映射，任意键都被接受；既无法枚举，也无法在组织校验器里用 `patternProperties`/`propertyNames` 收口（C15 直接禁用这两个关键字） | 改为数组 `items`，按 `id` 用 `oneOf` + `const` 判别，每个分支字段封闭（修订草案 30-39、588-610） |
| F2 | 20-56 | C9 | 能力标识用点分（`text.generate`、`tool.web-search`），生态既有能力一律冒号分（`sessions:list`、`net:fetch`） | 改为 `text:generate`、`reasoning:think`、`vision:image`、`document:read`、`tool:web-search`、`tool:read-url` |
| F3 | 21-29、31-36、37-40、41-43、44-49、50-55 | C4、C5 | 六项能力的字段集合各自不同，但草案没有任何一处书面定义字段边界；新增一个字段不会有人察觉 | 每个能力一个 `$defs` 分支，`required` 与 `additionalProperties: false` 逐项写全（修订草案 413-587） |
| F4 | 3 | C10、C18 | `id` 无 `pattern`，可写大写、中文、空格；也没有「发布后不再改动」的稳定键语义 | 复用插件/资产包同一正则 `^[a-z][a-z0-9-]{2,63}$`（修订草案 171-178） |
| F5 | 4-7 | C16 | 双语对象两侧都必填、无 `anyOf`、无 `additionalProperties: false`，可加任意语言键 | 照抄 `meta.json:134-159` 的 idiom（修订草案 180-212） |
| F6 | 全文 | C4、C5 | 草案既无顶层 `required`，也无顶层 `additionalProperties: false`；这是全生态 23 份 Schema 无一例外的两条 | 补齐（修订草案 40-49） |
| F7 | 8 | C8 | `format` 三个取值里，`deepseek-compatible` 与 `openai-compatible` 的边界未定义；而 DCE 对 DeepSeek 实际只调用 Anthropic 形态（`src/services/api/client.ts:15,141`），说明「厂商名」不等于「方言」 | 保留三个取值但逐个写明协议形态，并规定「仅基址或路径不同者不得另立取值」（修订草案 213-224） |
| F8 | 10-13 | C17、C18 | `base` 无尾斜杠、`chat/models/files` 以 `/` 开头，这是与生态 `base_url`（必须尾斜杠）相反的一套拼接口径，但草案没写规则；一旦 `base` 带路径段（如 `https://api.example.com/v1` 配 `/chat/completions`），按 URL 相对解析会把 `/v1` 丢掉得到错误地址 | 规定「直接拼接、不做相对解析」并写进 `$comment`（修订草案 50 第 5 条、293-318） |
| F9 | 11-13 | C18 | 端点无 `pattern`，可写整段绝对地址、可写空串、可带查询串 | `base` 用 `baseUrl`，路径用 `endpointPath`（修订草案 226-246） |
| F10 | 18 | C16、C17 | `prefix: ""` 用空串表示「无前缀」；生态对「缺省」统一用 `null` 或省略字段（`catalog-index.schema.json:21-27`、`trust-index.schema.json:22-32`、`removed.ts:61-75`） | `prefix` 改为可选，省略即无前缀，并设 `minLength 1`（修订草案 320-339） |
| F11 | 15-19 | C17 + 实测 | 单一 `header` + 单一 `prefix` 表达不了实测事实：聊天用 `x-api-key`，校验密钥用 `Authorization: Bearer`（`client.ts:85-99`），文件端点还要固定头 `anthropic-beta: files-api-2025-04-14`（`client.ts:17,89`） | `credential.headers` 改有序数组（多形态并列写）；与密钥无关的固定头放在 `endpoints.<名>.headers`（修订草案 248-292、341-367） |
| F12 | 10 | C17 | 来源基址是单值；生态的 `baseUrls` 是有序兜底数组（`sources.ts:51-70`），CDN 失败退 raw、再退 Pages | 建议（非阻塞）：允许 `base` 为数组；若坚持单值，须在 specs 写明「本格式不提供兜底」，避免读取方自行发明优先级 |
| F13 | 2 | C6、C7、C13 | 只有裸数字 `1`：没说未知版本的处置，没有演进规则，也没有规范版本/Schema 路径的锁定文件 | `const: 1` 写进 Schema，未知版本按不可读处理写进 `description`；另建 `specs/spec-version.json` 与演进表（本次未建，见第六节） |
| F14 | 23-29 | C19 | `params` 的键含 `system`，而生态的逻辑参数名表是 `temperature/topP/maxTokens/stop/systemPromptAppend/systemPromptReplace`，没有 `system`；且键集开放 | 键收敛为 `systemPrompt/maxTokens/temperature/topP/stop` 五项并 `additionalProperties: false`（修订草案 385-399） |
| F15 | 22 | C14 | `stream` 与 `format` 表达同一件事，且只列了一个取值 `sse-anthropic`，属两处同步点 | 保留但枚举化（`sse-anthropic`/`sse-openai`/`none`），并在 `$comment` 写明须与 `format` 一致（修订草案 405-414、50 第 2 条） |
| F16 | 12 与 37-42 | C14 | `vision.image`/`document.read` 声明 `input: file-id` 依赖 `files` 端点，但草案没有把这条依赖写在任何地方；反之 `files` 端点也可孤立存在 | 作为跨字段规则写入 `$comment` 第 3、4 条，并留给未来脚本（修订草案 50） |
| F17 | 39 | C10、C14 | `mediaTypeField` 是「线上字段名」的载体，与 `params` 里的 wire 名同类，却放在能力对象顶层，字段名也带 `Field` 后缀 | 建议二期并入 `params` 或统一命名为 `params` 风格的映射表；本次保留原位以免一次性改动过大，已在 description 注明其语义 |

## 四、草案缺失的必备元素（问题 3）

| 元素 | 是否有 | 生态依据 | 修订草案位置 |
|:---:|:---:|:---:|:---:|
| `$schema` | 缺 | C1、`validate-specs.mjs:339` | 2 |
| `$id` | 缺 | C2、`validate-specs.mjs:342-346` | 3 |
| `title` | 缺 | C3 | 4 |
| `description`（含指向规范的句子） | 缺 | C3、`asset-package.schema.json:5` | 5 |
| `examples` | 缺 | C12 | 51-169（2 条：收窄后的 DeepSeek 实例与一条最小 openai 形态实例） |
| 顶层 `required` | 缺 | C5 | 40-48 |
| 顶层 `additionalProperties: false` | 缺 | C4 | 49 |
| 每个枚举取值的边界说明 | 缺 | C8 | 213-224、341-347 等 |
| `$comment`（跨字段规则与脚本分工） | 缺 | C14 | 50 |
| `$defs` + 内部 `$ref` 的复用骨架 | 缺 | C11 | 170-611 |
| 规范版本与 Schema 路径的锁定 | 缺 | C13 | 未见文件（本次不建 `specs/`，见第六节第 6 条） |
| 结构版本演进规则 | 缺 | C6、C7、C13 | 仅写进 8-11 的 `description`，成文表格待 specs 落地 |

## 五、修订后的草案说明

`docs/source-descriptor.schema.draft.json` 的取舍原则：只使用组织校验器的受支持关键字（C15），每个 object 封闭，每个枚举有边界说明，跨字段规则一律进 `$comment` 并注明「只由校验脚本保证」（C14）。

主要结构变化：

| 维度 | 草案 | 修订后 |
|:---:|:---:|:---:|
| `capabilities` | 对象（开放键） | 数组，`items` 按 `id` 判别，6 个封闭分支 |
| 能力标识 | `text.generate` 等 | `text:generate`、`reasoning:think`、`vision:image`、`document:read`、`tool:web-search`、`tool:read-url` |
| `endpoints.chat/models/files` | 字符串 | 对象 `{path, headers?}`；`base` 仍为字符串 |
| `credential` | `{kind, header, prefix}` | `{kind, headers: [{name, prefix?}]}` |
| `name` | 两侧皆必填 | `anyOf` 至少一侧 + 封闭 |
| 逻辑参数键 | `maxTokens/system/temperature/topP/stop` | `systemPrompt/maxTokens/temperature/topP/stop`，封闭 |

修订后实例的核心片段（与 Schema 内置 `examples[0]` 一致）：

```json
{
  "schemaVersion": 1,
  "id": "deepseek",
  "name": { "zh-CN": "DeepSeek 官方", "en-US": "DeepSeek official" },
  "format": "anthropic-compatible",
  "endpoints": {
    "base": "https://api.deepseek.com",
    "chat": { "path": "/anthropic/v1/messages" },
    "models": { "path": "/models" },
    "files": {
      "path": "/anthropic/v1/files",
      "headers": [{ "name": "anthropic-beta", "value": "files-api-2025-04-14" }]
    }
  },
  "credential": { "kind": "api-key", "headers": [{ "name": "x-api-key" }] },
  "capabilities": [
    { "id": "text:generate", "stream": "sse-anthropic",
      "params": { "systemPrompt": "system", "maxTokens": "max_tokens",
                  "temperature": "temperature", "topP": "top_p", "stop": "stop_sequences" } },
    { "id": "reasoning:think", "field": "thinking", "onValue": "enabled",
      "offValue": "disabled", "budgetField": "budget_tokens" },
    { "id": "vision:image", "input": "file-id", "mediaTypeField": "media_type" },
    { "id": "document:read", "input": "file-id" },
    { "id": "tool:web-search", "kind": "server-tool", "names": ["deepseek_web_search"] },
    { "id": "tool:read-url", "kind": "server-tool", "names": ["deepseek_read_url"] }
  ]
}
```

## 六、结论（问题 4）

**需按建议修改后采用。** 草案的设计意图（一份文件声明来源的端点、鉴权与能力参数映射）与生态理念不冲突，冲突集中在「表达方式」：开放键映射、点分标识、缺字段封闭与版本演进，正好是生态 23 份 Schema 里被反复固化的几条。

采用的前置条件（建议作为评审门槛）：

| 门槛 | 对应条目 | 状态 |
|:---:|:---:|:---:|
| `capabilities` 数组化、按 `id` 判别、每分支字段封闭 | F1、F2、F3 | 修订草案已完成 |
| `credential` 支持多鉴权头，固定头下沉到端点 | F11 | 修订草案已完成 |
| `$schema`/`$id`/`title`/`description`/`examples`/`required`/`additionalProperties` 齐备 | C1-C5、问题 3 | 修订草案已完成 |
| base 与 path 的拼接口径成文 | F8 | 已写入 `$comment`，仍需在 specs 里给示例 |
| 结构版本演进表与 `specs/spec-version.json` | F13 | 未完成，属下一个任务的输入 |
| 跨字段规则落到校验脚本 | F16、C14 | 未完成，本仓库尚无 `scripts/` |

另需注意一处形式问题：修订草案的 `$id` 指向未来的 `schemas/source-descriptor.schema.json`。按 `validate-specs.mjs:344` 的「`$id` 必须以文件路径结尾」，该 Schema 只有真正落到 `schemas/` 时才能通过自检；在 `docs/` 下直接用该脚本校验会报 `$id` 路径不符。本次遵守「不建最终 Schema 目录」的约束，故保留正确形态并在此标注。

## 七、发现但没改的问题

| 编号 | 问题 | 证据 | 为什么没改 |
|:---:|:---:|:---:|:---:|
| N1 | `dsc-plugin-template` 的能力枚举落后于 `dsc-core`：模板列 8 项，实现有 10 项（缺 `assets:read`、`chat:request`） | `plugin-manifest.schema.json:95-104` 对 `dsc-core/types.ts:27-38` | 属他人仓库，跨仓库改动不在本任务范围 |
| N2 | 市场的来源配置（`market-sources`）没有 `schemaVersion`，靠容错解析兜底，与「分发给宿主读取的结构必须带版本位」的惯例相悖 | `sources.ts:119-150`、`types.ts:21-27`；对照 `pages-artifacts.md:132` 对无版本位的批评 | 属既有实现；本草案不复制该写法，但也不改它 |
| N3 | 生态把「来源 id」同时当作合集目录名，并用 `LEGACY_IDS` 迁移旧 id | `sources.ts:41-47` | 本草案把 id 定义为稳定键、不承担目录名职责；若将来要与市场来源合流，必须先定迁移表，属产品决策 |
| N4 | 同一来源不同端点要求不同鉴权头时，`credential.headers` 只能「全部写入」，无法逐端点覆盖 | `client.ts:85-99`（聊天与校验用不同头） | 加 `endpoints.<名>.credential` 会让格式复杂度上一个台阶；暂列为待决策 |
| N5 | `format` 的 `deepseek-compatible` 取值保留了，但它的协议边界仍需 specs 定义；若判定它不存在，应删除该取值 | `client.ts:15,141` 未出现非 Anthropic 形态 | 删取值属产品裁定，且删掉会让枚举回到两项；已在 `description` 里限定「仅基址不同者不得另立取值」 |
| N6 | 本仓库尚无 `specs/`（规范正文、`spec-version.json`）与 `scripts/`（校验器、跨字段规则） | 仓库内只有 `docs/` 与本报告 | 任务限定「只写报告与一份修订后的草案」，不建其他目录 |
| N7 | 既有 Schema 的字段命名本身不统一：结构字段 camelCase（`schemaVersion`、`current_version`、`plugin_count`），元数据字段 snake_case（`base_url`、`repo_link`、`removed_in`） | `catalog-index.schema.json:138`、`catalog-plugin.schema.json:24-33`、`removed.ts:115` | 本草案沿用 camelCase 一族（与 `schemaVersion` 同族）；命名分裂是生态既有问题，需在规范层统一，非本草案能修 |

## 附录 A 命令与输出

A1 列出全生态 Schema 文件（只读盘点）：

```
$ find DeepSeek-Chat-Enhanced/certs/schemas dsc-plugin-template/schemas \
       dsc-humanize-asset-template/schemas awesome-dsc-plugin/schemas \
       dsc-plugin-set-template/schemas -name '*.json' | sort | wc -l
37   # 其中 23 份 Schema（含两份 runtime/meta.json），14 份 schemas/examples 样例
$ find dsc-inner-plugin -name "*.schema.json" | wc -l
0    # dsc-inner-plugin 无 Schema，只有 dist/ 产物与设计文档，故只作文档对照
```

A2 抽取 $schema/$id/title 形态（23 份逐份命中，无例外）：

```
$ for f in <上述 23 份>; do grep -n '"\$id"\|"\$schema"\|"title"' "$f" | head -3; done
2:  "$schema": "https://json-schema.org/draft/2020-12/schema",
3:  "$id": "https://omds-chat.github.io/<仓库>/schemas/<路径>",
4:  "title": "...",
```

A3 校验脚本的硬规则（关键字白名单与 $id 形态）：

```
$ grep -n "SUPPORTED_KEYWORDS\|\$id 必须\|未支持的 schema 关键字" \
       dsc-plugin-template/scripts/validate-specs.mjs
22: const SUPPORTED_KEYWORDS = new Set([
295: if (!SUPPORTED_KEYWORDS.has(key)) {
296:   errors.push(... '未支持的 schema 关键字 ' + key)
344: } else if (!document.$id.endsWith(relativePath)) {
```

A4 修订草案的自检（run_code 内联 Node 程序，逻辑对齐 `validate-specs.mjs` 的白名单与 `validateNode` 语义：type/const/enum/pattern/minLength/maxLength/required/additionalProperties/items/uniqueItems/minItems/minProperties/anyOf/allOf/oneOf/$ref）：

```
== 1. Schema 自身静态检查 ==
通过: 无未支持关键字,$schema/$id/title/description/examples/required/additionalProperties 齐备

== 2. 内置 examples 校验 ==
example[0] deepseek: 通过
example[1] example-openai-gateway: 通过

== 3. 原始草案 docs/draft-source-descriptor.json 对新 Schema ==
拒绝原因共 7 条:
  - #/endpoints/chat: 类型应为 object,实际 string
  - #/endpoints/models: 类型应为 object,实际 string
  - #/endpoints/files: 类型应为 object,实际 string
  - #/credential: 缺少必填字段 headers
  - #/credential: 不允许的字段 header
  - #/credential: 不允许的字段 prefix
  - #/capabilities: 类型应为 array,实际 object
```

说明：第 3 组输出是「修订后 Schema 对原草案」的结果，用于证明改动面，不代表原草案本身不可用。

## 附录 B 证据索引

| 证据 | 位置 | 本报告引用处 |
|:---:|:---:|:---:|
| $schema/$id/title 三件套 | `dsc-plugin-template/schemas/manifest/plugin-manifest.schema.json:2-5` | C1、C2、C3 |
| 字段封闭与 required | `plugin-manifest.schema.json:49-55`、`schemas/runtime/meta.json:72-81` | C4、C5、F6 |
| 整数 schemaVersion + const | `dsc-plugin-set-template/schemas/manifest.schema.json:8-12`、`certs/schemas/trust-index.schema.json:14-17` | C6、F13 |
| 未知版本即拒绝 | `src/components/dsc-market/removed.ts:88`、`src/services/trust/fetch.ts:84` | C7、F13 |
| 能力标识冒号形态 | `src/components/dsc-core/types.ts:27-38` | C9、F2 |
| 正则与脚本逐字一致 | `dsc-plugin-set-template/schemas/README.md:36`、`versions.schema.json:31` | C10 |
| 示例与反例组织 | `validate-specs.mjs:18-19,380,422-443`、`schemas/examples/invalid/` | C12、问题 3 |
| 三版本演进 | `dsc-humanize-asset-template/specs/asset-package-spec.md:288-309` | C13、F13 |
| Schema 与脚本分工 | `dsc-plugin-set-template/schemas/README.md:22-30`、`versions.schema.json:26` | C14、F16 |
| 关键字白名单 | `validate-specs.mjs:22-57,294-298` | C15、F1 |
| 双语对象 idiom | `dsc-plugin-template/schemas/runtime/meta.json:134-159`、`src/components/dsc-market/types.ts:37` | C16、F5 |
| 来源建模与兜底 | `src/components/dsc-market/sources.ts:8-23,41-47,51-70,119-150`、`types.ts:21-27` | C17、F8、F12、N2、N3 |
| 基址 pattern | `awesome-dsc-plugin/schemas/catalog-plugin.schema.json:29-34` | C18、F9 |
| 逻辑参数名表 | `src/components/dsc-plugin-engine/requestPatch.ts:7-14` | C19、F14 |
| 鉴权与固定头实测 | `src/services/api/client.ts:15,17,85-99,141` | F7、F11、N4、N5 |
| 无版本位的批评 | `dsc-inner-plugin/docs/design/pages-artifacts.md:71,132` | C20、N2 |

## 附录 C 修订草案的字段清单

| 位置 | 字段 | 类型 | 必填 |
|:---:|:---:|:---:|:---:|
| 根 | `schemaVersion` | integer const 1 | 是 |
| 根 | `id` | string，`^[a-z][a-z0-9-]{2,63}$` | 是 |
| 根 | `name` | object `{zh-CN?, en-US?}`，至少一侧 | 是 |
| 根 | `format` | enum 三取值 | 是 |
| 根 | `endpoints` | object `{base, chat, models, files?}` | 是 |
| 根 | `credential` | object `{kind, headers[]}` | 是 |
| 根 | `capabilities` | array，minItems 1，uniqueItems | 是 |
| endpoints | `base` | string，http(s) 绝对地址、无尾斜杠 | 是 |
| endpoints | `chat` / `models` | `{path, headers?}` | 是 |
| endpoints | `files` | `{path, headers?}` | 否 |
| capability | `text:generate` | `{id, stream, params?}` | — |
| capability | `reasoning:think` | `{id, field, onValue, offValue, budgetField?}` | — |
| capability | `vision:image` | `{id, input, mediaTypeField?}` | — |
| capability | `document:read` | `{id, input}` | — |
| capability | `tool:web-search` / `tool:read-url` | `{id, kind, names[]}` | — |
| params | `systemPrompt` / `maxTokens` / `temperature` / `topP` / `stop` | string（线上字段名），至少一项 | — |
