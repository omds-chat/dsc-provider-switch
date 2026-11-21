# 来源描述文件规范

> 适用对象：`schemas/source-descriptor.schema.json` 与 `schemas/examples/*.descriptor.json`。
> 结构版本：`schemaVersion` 为 `1`。
> 规范文本版本：与 Schema 同批发布，版本演进规则见第八节。
> 本文件只描述结构与取值口径，不含实现代码；任何密钥、令牌、证书、私钥都不得写入描述文件。

## 一、这份文件是什么

来源描述文件是一份 JSON 文档，用来声明**一个模型来源**的四件事：端点在哪个基址的哪条路径上、请求怎么鉴权、支持哪些能力、每项能力在线上请求里对应哪个字段名和什么取值边界。

它的用途是让读取方（宿主、插件、切换器）不必为每个厂商写死一张表：读一份描述，就知道该往哪个地址发请求、该加哪个鉴权头、该用 `max_tokens` 还是 `max_completion_tokens`、该把系统提示词放顶层字段还是放进 `messages`、以及这个来源到底能不能看图或读文档。

它不承担以下职责，这些事不属于本格式：

| 不属于 | 原因 |
|:---:|:---|
| 密钥仓库 | 描述文件公开分发，`credential` 只写“密钥放在哪个头、带什么前缀”，不写密钥本身 |
| 实现代码 | 不描述重试、超时、并发、路由与降级策略 |
| 模型清单 | 模型列表由 `endpoints.models` 运行时拉取，不写进描述 |
| 提示词内容 | 只声明系统提示词的位置，不声明内容 |
| 计费与配额 | 属于账户侧事实，随供应商变化，不做静态声明 |

读取方**不加载**本 Schema。Schema 是给作者、评审与 CI 用的书面契约；读取方只认 `schemaVersion` 与本文档。

## 二、文件形态与命名

| 项 | 规则 |
|:---:|:---|
| 位置 | 仓库内 `schemas/examples/<id>.descriptor.json`；Schema 本体在 `schemas/source-descriptor.schema.json` |
| 文件名 | 去掉 `.descriptor.json` 后必须等于文件内的 `id` |
| 编码 | UTF-8，无 BOM，两个空格缩进，对象键按本规范顺序排列 |
| 语法 | 严格 JSON：不允许注释、尾逗号、单引号、`NaN` |
| 键名 | 结构字段用 camelCase（`schemaVersion`、`maxTokens`），线上字段名只出现在字符串值里 |
| 语言 | `description` 与文档用中文；`name` 用双语文案；键名与线上字段名保持原样，不翻译 |

## 三、顶层字段

| 字段 | 类型 | 必填 | 约束 | 说明 |
|:---:|:---:|:---:|:---:|:---|
| `schemaVersion` | integer | 是 | `const 1` | 结构版本；非 1 一律按不可读处理 |
| `id` | string | 是 | `^[a-z][a-z0-9-]{2,63}$` | 来源稳定标识，发布后不改 |
| `name` | object | 是 | `zh-CN` / `en-US` 至少一侧，各 1..64 字符且非空白 | 展示名，缺失侧由读取方补齐 |
| `format` | string | 是 | 三取值枚举 | 线上协议方言 |
| `endpoints` | object | 是 | 需 `base`、`chat`、`models`；`files` 可选 | 端点集合 |
| `credential` | object | 是 | `kind` 只接受 `api-key`；`headers` 1..4 项 | 鉴权头的位置与格式 |
| `capabilities` | array | 是 | 1..32 项，元素按 `id` 判别，全局封闭 | 能力与参数映射 |

顶层 `additionalProperties` 为 `false`：多一个字段即校验失败。新增顶层字段视为结构变更，必须升 `schemaVersion`。

### 3.1 `schemaVersion`

整数，当前只有 `1`。它是**结构**版本，不表示数据的新旧，也不表示来源版本。读取方遇到非 1 的取值必须按不可读处理并报错，禁止静默降级、禁止按字段猜测。

### 3.2 `id`

全局唯一、发布后不再改动。读取方以它作为持久化配置的键，因此改名必须另附旧 id 到新 id 的映射表并迁移，不能在原地改。正则与插件 id、资产包 id 同一形态：小写字母开头，只含小写字母、数字与连字符，长度 3 到 64。

同一个厂商的不同协议形态是**两个来源**，用两个 id，例如 `deepseek`（OpenAI 形态）与将来的 `deepseek-anthropic`（Anthropic 形态），不得靠改 `format` 复用同一个 id。

### 3.3 `name`

双语文案对象，`zh-CN` 与 `en-US` 至少给出一侧，两侧都给时各自独立。该对象封闭，不接受 `ja-JP` 之类的额外语言键；需要新语言属于结构变更。缺失的一侧由读取方用另一侧补齐，不得显示为空。

### 3.4 `format`

只接受三个取值，含义按协议形态而不是按厂商名界定：

| 取值 | 协议形态 | 典型端点 | 流式帧 |
|:---:|:---|:---:|:---|
| `anthropic-compatible` | `/v1/messages` 形态：`x-api-key`、顶层 `system`、`content` 块、具名 SSE 事件 | `/v1/messages` | `message_start` / `content_block_delta` / `message_stop` |
| `openai-compatible` | `/v1/chat/completions` 形态：`Authorization: Bearer`、`messages` 数组、`choices[].delta` | `/chat/completions` | `data: {choices:[{delta}]}` |
| `deepseek-compatible` | `openai-compatible` 基础字段之外另有官方扩展：响应字段 `reasoning_content`、自有服务端工具名 | `/chat/completions` | 同 `openai-compatible` |

判定口径：**仅基址或路径不同、协议形态相同者，不得另立取值**，应作为另一条来源描述。反过来，同一厂商若同时提供两种协议形态（例如 Anthropic 形态与 OpenAI 形态各一套端点），就必须拆成两份描述文件。

### 3.5 `endpoints`

| 字段 | 类型 | 必填 | 说明 |
|:---:|:---:|:---:|:---|
| `base` | string | 是 | 基址，`http` 或 `https` 绝对地址，不带查询串与片段，**末尾不带斜杠** |
| `chat` | object | 是 | 对话补全端点 |
| `models` | object | 是 | 模型列表端点，也用于校验密钥可达性 |
| `files` | object | 否 | 文件端点，仅当某能力以 `file-id` 作为输入时不可缺 |

每个端点对象只有两个字段：`path` 必填，以斜杠开头、不含协议/主机/查询串/片段；`headers` 可选，是与密钥无关的固定请求头数组，每项 `{name, value}`。

**拼接规则**：完整地址等于 `base` 直接拼接 `path`，不做 URL 相对解析。这条规则必须成文，因为按 RFC 3986 的相对解析会在 `base` 带路径段时丢掉路径：

| base | path | 完整地址 |
|:---:|:---:|:---|
| `https://api.deepseek.com` | `/chat/completions` | `https://api.deepseek.com/chat/completions` |
| `https://api.openai.com/v1` | `/chat/completions` | `https://api.openai.com/v1/chat/completions` |
| `https://api.anthropic.com` | `/v1/messages` | `https://api.anthropic.com/v1/messages` |

固定头按端点声明，本版没有“全局默认头”这一层。Anthropic 的 `anthropic-version` 需要随每次请求发送，因此在每个端点的 `headers` 里各写一次；漏写即视为该端点不带该头。把固定头提升为根级默认值是第八节的待决策项。

### 3.6 `credential`

| 字段 | 类型 | 必填 | 说明 |
|:---:|:---:|:---:|:---|
| `kind` | string | 是 | 只接受 `api-key`；新增类型须升 `schemaVersion` |
| `headers` | array | 是 | 1..4 项，每项 `{name, prefix?}`，按顺序全部写入 |

`headers[].name` 是承载密钥的 HTTP 头名，`prefix` 可选，写入头值时前置；需要分隔空格时把空格写进前缀，例如 `Bearer ` 带一个尾随空格。缺省 `prefix` 表示密钥原样作为头值。**不用空串表示“无前缀”**：旧草案的 `prefix: ""` 就是被推翻的写法，缺省即省略字段。

同一来源接受多种鉴权形态时逐项列出（例如聊天用 `x-api-key`、校验密钥用 `Authorization: Bearer`）。本版不支持按端点覆盖凭据，见第八节。

### 3.7 `capabilities`

数组，不得为空，每项一个能力对象。每个对象用 `id` 判别，`id` 一律 `namespace:verb` 冒号形态，与全生态 `sessions:list`、`net:fetch` 同一写法；旧草案的点分写法（`text.generate`）已推翻。

同一个 `id` 至多一条：按属性去重由校验脚本保证，数组的 `uniqueItems` 只拦逐字重复。未在本数组出现的能力，一律视为该来源不支持。

同类能力内部再有形态差异时，用第二个判别键（`prompt:system` 的 `mode`、`reasoning:think` 的 `style`）继续分叉，每个分叉的字段集合独立封闭。

## 四、能力逐项说明

| 能力 id | 判别键 | 必填字段 | 可选字段 | 用来说明 |
|:---:|:---:|:---|:---|:---|
| `text:generate` | `stream` | `id`、`stream` | `params`、`requiredParams`、`limits` | 文本生成与参数映射 |
| `prompt:system` | `mode` | `id`、`mode`；`top-level-field` 还需 `field`，`message-role` 还需 `role` | 无 | 系统提示词放在哪 |
| `reasoning:think` | `style` | `id`、`style`、`field`；`type-toggle` 还需 `onValue`、`offValue`，`effort-level` 还需 `levels` | `adaptiveValue`、`budgetField`、`budgetMin`、`budgetCountsInMaxTokens`、`defaultLevel`、`responseField` | 思考开关的形态与取值 |
| `vision:image` | — | `id`、`contentType`、`inputs` | `mediaTypeField` | 图片理解 |
| `document:read` | — | `id`、`contentType`、`inputs` | 无 | 文档阅读 |
| `tool:web-search` | — | `id`、`kind`、`names` | `requestField` | 联网搜索 |
| `tool:read-url` | — | `id`、`kind`、`names` | `requestField` | 读取网页 |

### 4.1 `text:generate`

三家都有，是唯一必有的能力。`stream` 枚举 `sse-anthropic` / `sse-openai` / `none`，须与 `format` 的帧方言一致（`none` 豁免），不一致由脚本报错。

`params` 是“逻辑参数名到线上字段名”的映射表，键封闭为五项，至少给出一项；未列出的键表示该来源不支持该项，键名不得自造：

| 逻辑参数 | 含义 | 三家线上名 |
|:---:|:---|:---|
| `maxTokens` | 输出上限 | DeepSeek `max_tokens`；OpenAI `max_completion_tokens`（`max_tokens` 为旧名）；Anthropic `max_tokens` |
| `temperature` | 温度 | 三家均 `temperature` |
| `topP` | 核采样 | 三家均 `top_p` |
| `topK` | top_k 采样 | 仅 Anthropic `top_k`，另两家不支持 |
| `stop` | 停止词 | Anthropic `stop_sequences`；OpenAI 与 DeepSeek `stop` |

系统提示词不在这张表里，它由 `prompt:system` 声明，理由见第六节。

`requiredParams` 列出必须随每次请求发送的逻辑参数，取自 `params` 的键；例如 Anthropic 的 `maxTokens`。缺省表示没有必填参数。

`limits` 声明取值边界，键与逻辑参数名一致，每项 `{min, max?, default?}`：`min` 必填；`max` 可选，缺省表示上界随模型而变；`default` 可选，须落在区间内。只声明边界，不声明采样策略。

### 4.2 `prompt:system`

系统提示词有三家不同的位置语义，因此独立成能力，而不是塞进 `params` 的一个键：

| `mode` | 必填字段 | 含义 | 用于 |
|:---:|:---:|:---|:---|
| `top-level-field` | `field` | 作为请求体顶层字段，例如 `system` | `anthropic-compatible` |
| `message-role` | `role` | 作为 `messages` 数组里的一条消息，`role` 枚举 `system` / `developer` | `openai-compatible`、`deepseek-compatible` |

声明 `text:generate` 时必须同时声明 `prompt:system`，这条交叉规则由脚本检查。

### 4.3 `reasoning:think`

思考能力有两种形态，用 `style` 分叉：

| `style` | 必填字段 | 可选字段 | 含义 | 用于 |
|:---:|:---|:---|:---|:---|
| `type-toggle` | `field`、`onValue`、`offValue` | `adaptiveValue`、`budgetField`、`budgetMin`、`budgetCountsInMaxTokens` | 一个字段的枚举取值表示开、关与自适应 | Anthropic `thinking.type` |
| `effort-level` | `field`、`levels` | `defaultLevel`、`responseField` | 一个字段取若干档位之一，无独立关闭取值，缺省即不开启 | OpenAI 与 DeepSeek `reasoning_effort` |

Anthropic 的事实落点：`onValue` 为 `enabled`、`offValue` 为 `disabled`、`adaptiveValue` 为 `adaptive`、`budgetField` 为 `budget_tokens`、`budgetMin` 为 `1024`、`budgetCountsInMaxTokens` 为 `true`（预算与正文共享 `max_tokens`，因此预算越大可用正文越少）。

OpenAI 与 DeepSeek 的事实落点：`field` 为 `reasoning_effort`，`levels` 按由低到高排列；DeepSeek 另填 `responseField` 为 `reasoning_content`（响应里回传思考内容），OpenAI 不返回该字段故省略。

### 4.4 `vision:image` 与 `document:read`

`contentType` 是内容块类型取值，原样写入 `content`：Anthropic 为 `image` / `document`，OpenAI 为 `image_url`。`inputs` 是传入方式的数组，至少一项：`base64` 内联编码、`url` 远程地址、`file-id` 先上传再引用。任一项为 `file-id` 时 `endpoints.files` 必须存在。

能力缺省即“不支持”。DeepSeek 当前只有文本，因此不声明这两项；OpenAI 声明 `vision:image` 为 `image_url`，不声明 `document:read`（本版没有可采用的文档块事实）。

### 4.5 `tool:web-search` 与 `tool:read-url`

`kind` 说明工具由谁执行：`server-tool` 由服务端执行、名字由厂商固定；`request-tools` 在请求的 `tools` 字段里声明、由宿主或客户端执行。`requestField` 是承载工具声明的请求字段名（通常为 `tools`），`names` 是工具名数组，不得为空且不得重复。工具名按方言各写各的，不得跨方言套用。

## 五、三家差异对照

以下十项是三家实际参数差异，以及它们在本格式里的落点。

| 维度 | DeepSeek | OpenAI | Anthropic | 描述文件落点 |
|:---:|:---|:---|:---|:---|
| 鉴权头 | `Authorization: Bearer` | `Authorization: Bearer` | `x-api-key` | `credential.headers` |
| 协议版本固定头 | 无 | 无 | 必须带 `anthropic-version`（本示例取 `2023-06-01`） | `endpoints.<名>.headers` |
| 系统提示 | `messages` 的 `system` 角色 | `messages` 的 `system` 角色 | 顶层 `system` 字段 | `prompt:system.mode` |
| 最大输出 | `max_tokens`，范围 1..393216 | `max_completion_tokens`（`max_tokens` 为旧名） | `max_tokens`，必填 | `params.maxTokens`、`limits.maxTokens`、`requiredParams` |
| 停止词 | `stop` | `stop` | `stop_sequences` | `params.stop` |
| 温度范围 | 0..2，默认 1 | 0..2 | 0.0..1.0 | `limits.temperature` |
| 思考 | `reasoning_effort`，响应回传 `reasoning_content` | `reasoning_effort`，不回传思考内容 | `thinking{type: enabled 或 disabled 或 adaptive, budget_tokens >= 1024，计入 max_tokens}` | `reasoning:think.style` 及其字段 |
| 额外采样 | 无 `top_k` | 无 `top_k` | 另有 `top_k` | `params.topK`、`limits.topK` |
| 多模态 | 仅文本 | `image_url` 内容块 | `image` 与 `document` 内容块 | `vision:image`、`document:read` 的有无 |
| 服务端工具 | 自有工具名（`deepseek_web_search`、`deepseek_read_url`） | 走请求 `tools` 字段 | 自有工具名（`web_search`、`web_fetch`） | `tool:*` 的 `kind`、`requestField`、`names` |
| 流式 | `data: {choices:[{delta}]}` | `data: {choices:[{delta}]}` | 具名事件 `message_start` / `content_block_delta` / `message_stop` | `text:generate.stream` |

示例文件的取值（豆包与 deepseek-anthropic 的取值依据见 [docs/doubao-ark-research.md](doubao-ark-research.md) 与 [docs/design/provider-sources.md](design/provider-sources.md)）：

| 文件 | id | format | base | chat path | 能力数 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| `schemas/examples/deepseek.descriptor.json` | `deepseek` | `deepseek-compatible` | `https://api.deepseek.com` | `/chat/completions` | 5 |
| `schemas/examples/deepseek-anthropic.descriptor.json` | `deepseek-anthropic` | `anthropic-compatible` | `https://api.deepseek.com` | `/anthropic/v1/messages` | 3 |
| `schemas/examples/openai.descriptor.json` | `openai` | `openai-compatible` | `https://api.openai.com/v1` | `/chat/completions` | 5 |
| `schemas/examples/anthropic.descriptor.json` | `anthropic` | `anthropic-compatible` | `https://api.anthropic.com` | `/v1/messages` | 7 |
| `schemas/examples/doubao.descriptor.json` | `doubao` | `openai-compatible` | `https://ark.cn-beijing.volces.com/api/v3` | `/chat/completions` | 5 |

## 六、两处刻意的取舍

| 取舍 | 做法 | 理由 |
|:---:|:---|:---|
| 系统提示独立成能力 | 不把 `system` 放进 `params` 的逻辑参数表 | `params` 的一张表只能表达“字段名不同”，表达不了“位置不同”：顶层字段与 `messages` 里的一条消息是两种结构，用同一张表描述会让读取方不得不猜 |
| 思考拆两种形态 | `type-toggle` 与 `effort-level` 各一个分支 | 开关式有独立的关闭取值，档位式只能靠缺省关闭；硬塞进一套字段会出现“必填但无意义”的字段 |

## 七、校验方式

本仓库自带零依赖校验脚本，不依赖 Schema 校验库，也不联网：

```bash
node scripts/validate-specs.mjs
```

脚本做六件事，任一失败即以退出码 1 结束：

| 步骤 | 内容 | 失败示例 |
|:---:|:---|:---|
| 1 | 规范版本与 Schema 路径：`specs/spec-version.json` 的版本与 `schemas` 映射同磁盘文件一致 | `必须指向 schemas/manifest/...` |
| 2 | 清单与 meta Schema 静态检查：关键字白名单、`$ref` 可解析、`pattern` 可编译、`$schema` 恒为 draft 2020-12、`$id` 以文件路径结尾 | `未支持的 schema 关键字 propertyNames` |
| 3 | 来源描述 Schema 静态检查与内联 `examples` 校验 | `内联 example[0]: 取值必须为 ...` |
| 4 | 校验 `schemas/examples/*.descriptor.json` 的来源描述正例（含八条跨字段规则） | `不允许的字段 ...`、`跨字段: ...` |
| 5 | 清单与 meta 的正例通过、`schemas/examples/invalid/` 反例被拒 | `反例 ... 未发现任何错误` |
| 6 | 语义一致性抽查与本仓库数据：方言与能力覆盖、`package.json` 派生的 meta、构建产物 `dist/meta.json`（存在时） | `deepseek 不声明 vision:image` |

关键字白名单与 `$id` 规则与 `dsc-plugin-template/scripts/validate-specs.mjs` 逐条一致，因此本项目 Schema 可以直接迁进模板仓库的规范区。白名单只有 31 个关键字，`patternProperties`、`propertyNames`、`if/then` 不可用，这也是能力表必须写成数组而不能写成开放键映射的直接原因。

以下八条是 Schema 表达不了的跨字段规则，写在 Schema 顶层 `$comment` 里，由脚本的跨字段检查执行：

| 编号 | 规则 |
|:---:|:---|
| 1 | `capabilities` 内同一 `id` 至多一条 |
| 2 | `text:generate.stream` 须与 `format` 一致：`anthropic-compatible` 对 `sse-anthropic`，`openai-compatible` 与 `deepseek-compatible` 对 `sse-openai`，`none` 豁免 |
| 3 | 声明 `text:generate` 时必须同时声明 `prompt:system` |
| 4 | 任一能力的 `inputs` 含 `file-id` 时 `endpoints.files` 必须存在 |
| 5 | 未声明 `vision:image` 与 `document:read` 时 `endpoints.files` 冗余但不报错 |
| 6 | `requiredParams` 的每个键必须同时出现在 `params` 中 |
| 7 | `limits` 每项给出 `max` 时 `min` 不得大于 `max`，`default` 须落在区间内 |
| 8 | `base` 末尾不带斜杠、`path` 以斜杠开头，二者直接拼接，不做 URL 相对解析 |

分工原则：Schema 表达结构，脚本表达结构与跨字段约束，本文档表达语义。三者冲突时以本文档为准，并同时修改另外两处，不允许只改一处。

当前校验输出：

```text
[1/6] 规范版本与 Schema 文件
通过  规范版本与 Schema 路径: spec_version 1.0.0,dsc_core 1.0.0
[2/6] 清单与 meta Schema 结构
通过  schemas/manifest/plugin-manifest.schema.json
通过  schemas/runtime/meta.json
[3/6] 来源描述 Schema 自身静态检查: schemas/source-descriptor.schema.json
通过  Schema 关键字白名单、$ref、pattern、$id 与必备顶层字段
通过  内联 example[0] deepseek
[4/6] 来源描述正例: schemas/examples
通过  schemas/examples/anthropic.descriptor.json
通过  schemas/examples/deepseek-anthropic.descriptor.json
通过  schemas/examples/deepseek.descriptor.json
通过  schemas/examples/doubao.descriptor.json
通过  schemas/examples/openai.descriptor.json
[5/6] 清单与 meta 正反例
通过  正例 schemas/examples/manifest.full.valid.json
通过  正例 schemas/examples/manifest.valid.json
通过  正例 schemas/examples/meta.valid.json
通过  反例 schemas/examples/invalid/manifest.bad-id.json 已被拒绝
      （其余 15 个反例逐条列出）
[6/6] 语义一致性与本仓库数据
通过  anthropic 声明 vision:image 与 document:read
通过  deepseek 不声明 vision:image 与 document:read
通过  deepseek 用 max_tokens 且声明 1..393216
通过  anthropic 用 x-api-key 且带 anthropic-version 固定头
通过  openai 用 Bearer 且 max_completion_tokens
通过  deepseek-anthropic 走 /anthropic/v1/messages 且用 x-api-key
通过  package.json 派生的 meta.json
通过  构建产物 meta.json
自检通过: 1 份来源描述 Schema,1 条内联实例,5 份来源描述正例,3 份清单与 meta 正例,16 个反例
```

## 八、版本演进规则

`schemaVersion` 是结构版本，只有它能决定读取方是否认得这份文件。规则如下。

### 8.1 什么时候升版本

| 变更 | 是否升 `schemaVersion` | 说明 |
|:---:|:---:|:---|
| 新增顶层字段、端点、能力分支或任一分叉 | 升 | 读取方按 `const 1` 处理，不认识的字段会被旧读取方忽略，语义就可能错 |
| 新增或删除枚举取值（`format`、`stream`、`kind`、`inputs`、`role`） | 升 | 枚举封闭，增删都会改变合法实例集合 |
| 字段从可选改必填，或删除字段 | 升 | 既有文件会失效，属破坏性变更 |
| 字段语义、单位、默认值口径变化 | 升 | 结构没变但含义变了，等价于破坏性变更 |
| 新增可选字段 | 升 | 保证“版本号相同即字段集合相同”这一条对读取方成立 |
| 仅改 `description`、`$comment`、`title` 文案 | 不升 | 不改变任何合法实例的集合 |
| 仅调整 `$defs` 拆分、`$ref` 组织方式 | 不升 | 对外结构等价 |
| 新增或修订示例文件 | 不升 | 示例是数据不是结构 |

一句话判据：**只要合法实例集合或某个字段的含义发生变化，就升 `schemaVersion`。**

### 8.2 怎么升

| 步骤 | 动作 |
|:---:|:---|
| 1 | 递增 `schemaVersion` 的 `const` 值，并同步写入 Schema 顶层 `description` |
| 2 | 在本文件新增一节“版本 2 相对版本 1 的变更”，逐条列出增删改与迁移方式 |
| 3 | 为每个实例文件标注新版本，旧版本文件不改写、不回溯迁移 |
| 4 | 读取方在过渡期内同时支持两版；不支持旧版时须明确报“版本不受支持”，不得静默降级 |
| 5 | 能力标识与字段名一经发布不得复用旧名表达新语义；需要废弃时先标 `deprecated`，下一个版本再删除 |

### 8.3 读取方对版本的处理

| 情形 | 行为 |
|:---:|:---|
| `schemaVersion` 等于自己支持的值 | 按本规范解析，未知字段按字段封闭规则报错 |
| `schemaVersion` 未知 | 整份文件按不可读处理，报错并提示升级，禁止猜测字段 |
| 文件缺 `schemaVersion` | 按不可读处理 |
| 出现未知能力 `id` | 该能力按不支持处理，其余能力照常可用 |
| 出现未知枚举取值 | 该字段所在对象按不可读处理 |

### 8.4 与规范版本锁定的关系

本仓库已建立 `specs/`（从 dsc-plugin-template 复制的运行时与开发规范副本）与 `specs/spec-version.json`（记录 `spec_version`、`dsc_core` 与清单、运行时 meta 两份 Schema 的仓库内路径）。来源描述 Schema 不在该登记表内，它的路径仍由 `$id` 锁定为 `https://omds-chat.github.io/dsc-provider-switch/schemas/source-descriptor.schema.json`，改名等于破坏发布契约，须升 `schemaVersion` 并在变更说明中给出旧路径。

## 九、本版未纳入的事项

| 事项 | 现状 | 建议 |
|:---:|:---|:---|
| 根级默认请求头 | 固定头只能逐端点声明 | 若后续出现三个以上端点共用同一头，再评估加根级 `headers`，同时升版本 |
| 逐端点凭据 | `credential.headers` 只能全部写入 | 保留待决策；一旦出现同一来源“聊天用 A 头、校验用 B 头”且不能同时发送，需要新增覆盖字段 |
| 基址兜底数组 | `base` 只允许单值 | 若需要 CDN 与源站兜底，须改成有序数组并定义降级顺序，属破坏性变更 |
| `deepseek-compatible` 的边界 | 在 `format` 枚举内保留 | 若判定该形态不存在，删除取值并升版本；删除前不得让实例依赖它 |
| `specs/` 与 `spec-version.json` | 已建立 | 规范副本与清单、meta Schema 已从模板仓库同步；本文件仍承担来源描述的权威口径，第七、八节留在原地，迁入 `specs/` 属后续任务 |
| 反例样例 | 未建 | 需要时按 `schemas/examples/invalid/<对象>.<理由>.json` 组织，每个反例只演示一条规则 |

## 附录：文件清单

| 文件 | 作用 |
|:---:|:---|
| `schemas/source-descriptor.schema.json` | 结构契约，draft 2020-12，自包含，含 1 条内联实例 |
| `schemas/examples/deepseek.descriptor.json` | DeepSeek 实例，OpenAI 形态，不含视觉与文档能力 |
| `schemas/examples/deepseek-anthropic.descriptor.json` | DeepSeek 实例，Anthropic 形态，本插件内置注册并调用的端点 |
| `schemas/examples/openai.descriptor.json` | OpenAI 实例，含 `image_url` 与 `max_completion_tokens` |
| `schemas/examples/anthropic.descriptor.json` | Anthropic 实例，含 `x-api-key`、`top_k`、`thinking`、文档块 |
| `schemas/examples/doubao.descriptor.json` | 豆包实例，依据 docs/doubao-ark-research.md 的调研取值 |
| `schemas/manifest/`、`schemas/runtime/` 及其正反例 | 从 dsc-plugin-template 同步的清单与运行时 meta Schema，随 specs 副本一并校验 |
| `scripts/validate-specs.mjs` | 零依赖校验脚本：来源描述的静态检查、内联实例、正例与八条跨字段规则，加清单、meta 的正反例与本仓库 meta 校验 |
| `specs/` | 运行时规范与开发规范的模板仓库副本，含 spec-version.json 与已知差异表 |
| `docs/spec.md` | 本文件 |
| `docs/design/provider-sources.md` | 供应端点注册与调用封装的设计定稿，含方言选择理由与缺口清单 |
