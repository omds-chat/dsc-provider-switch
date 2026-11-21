# 豆包（火山方舟 Ark）对话与工具接口调研记录

> 调研对象：火山引擎火山方舟（Volcengine Ark）平台上的豆包（Doubao）模型。
> 调研目的：为 `schemas/examples/doubao.descriptor.json` 提供事实依据。
> 调研方式：只读公开文档。未登录控制台、未申请 API Key、未调用任何真实接口、未安装依赖。
> 采集时间：2026-11-21（北京时间）。
> 说明：方舟文档站在浏览器里是前端渲染页面，本次通过官方文档站自带的 llms.txt 索引（[S13]）取得同一批文档的 `.md` 正文，链接均指向官方文档页。

## 一、来源清单

| 编号 | 标题 | 链接 | 本文用途 |
|:---:|:---|:---|:---|
| S1 | Base URL 及鉴权 | <https://docs.volcengine.com/docs/zh/ark/base-url-and-authentication> | 基址、鉴权头、Access Key 与 Endpoint ID 的关系 |
| S2 | 对话（Chat）API | <https://docs.volcengine.com/docs/zh/ark/chat-api> | 请求/响应字段、参数取值范围、多模态内容块、流式协议 |
| S3 | 深度思考 | <https://docs.volcengine.com/docs/zh/ark/deep-thinking> | thinking 开关、reasoning_effort 档位、思考内容回传 |
| S4 | 联网搜索工具 | <https://docs.volcengine.com/docs/zh/ark/web-search> | 豆包搜索 Custom 版与联网内容插件的调用形态 |
| S5 | 工具概述 | <https://docs.volcengine.com/docs/zh/ark/tools-overview> | 内置工具清单与各工具支持的 API |
| S6 | 图片理解 | <https://docs.volcengine.com/docs/zh/ark/image-understanding> | 图片三种传入方式与体积限制 |
| S7 | 文档理解 | <https://docs.volcengine.com/docs/zh/ark/document-understanding> | PDF 在 Chat API 里的内容块形态 |
| S8 | 模型列表 | <https://docs.volcengine.com/docs/zh/ark/model-list> | Model ID、能力标签、各模型长度限制 |
| S9 | Models API | <https://docs.volcengine.com/docs/zh/ark/models-api> | 模型列表端点 |
| S10 | 上传文件（Files API） | <https://docs.volcengine.com/docs/zh/ark/upload-files-api> | 文件端点，file-id 输入依赖 |
| S11 | 迁移到方舟官方 SDK | <https://docs.volcengine.com/docs/zh/ark/migrate-ark-runtime-sdk> | 新旧 SDK 差异 |
| S12 | 快速入门 | <https://docs.volcengine.com/docs/zh/ark/quick-start> | OpenAI SDK 直连方舟的官方示例 |
| S13 | 火山方舟文档索引（llms.txt） | <https://docs.volcengine.com/docs/zh/ark/llms.txt> | 文档取得路径 |
| S14 | 流式输出 | <https://docs.volcengine.com/docs/zh/ark/streaming-output> | SSE 增量帧与聚合方式 |

## 二、基础形态

| 项目 | 事实 | 来源 |
|:---:|:---|:---|
| 是否 OpenAI 兼容 | 是。Chat API 在官方文档中被明确写作"Chat API（兼容 OpenAI Chat Completions 接口协议）"；快速入门给出用 OpenAI 官方 Python SDK 把 `base_url` 指向方舟即可调用的示例 | [S4]、[S12] |
| 数据面基址 | `https://ark.cn-beijing.volces.com/api/v3` | [S1] |
| 管控面基址 | `https://ark.cn-beijing.volcengineapi.com/`（管理 API Key、接入点等，与对话无关） | [S1] |
| 对话路径 | `POST https://ark.cn-beijing.volces.com/api/v3/chat/completions` | [S2] |
| 鉴权头 | `Authorization: Bearer $ARK_API_KEY`（API Key 鉴权，官方推荐）；另可选 Access Key 签名鉴权 | [S1] |
| 模型列表路径 | `GET https://ark.cn-beijing.volces.com/api/v3/models` | [S9] |
| 文件路径 | `POST https://ark.cn-beijing.volces.com/api/v3/files` | [S10] |
| 模型命名 | `model` 字段填 Model ID（如 `doubao-seed-2-1-pro-260915`）；多应用与精细管理场景官方推荐改填推理接入点 ID（Endpoint ID，`ep-` 前缀） | [S2] |
| 流式形态 | `stream=true` 时按 SSE 逐块返回，增量在 `choices[].delta`，以一条 `data: [DONE]` 结束；`stream_options.include_usage` 可在结束前补一个只含 `usage` 的帧 | [S2]、[S14] |
| 另有两套并行协议 | Responses API（`/api/v3/responses`，OpenAI Responses 协议）与 Messages API（`/api/compatible/v1/messages`，Anthropic Messages 协议）。本文与描述文件只覆盖 Chat API | [S4]、[S5] |

## 三、参数差异（与 OpenAI 对照）

| 维度 | OpenAI | 豆包 Chat API | 描述文件落点 |
|:---:|:---|:---|:---|
| 温度 | `temperature`，0..2 | `temperature`，**取值 [0, 2]，默认 1.0**；`doubao-seed-2-0-pro-260215`、`doubao-seed-2-0-lite-260215` 固定 1.0，传其它值被忽略 | `limits.temperature` = 0..2，default 1 |
| 核采样 | `top_p`，默认 1 | `top_p`，**取值 [0, 1]，默认 0.7**；上述两款 2.0 模型固定 0.95 | `limits.topP` = 0..1，default 0.7 |
| 输出上限（旧名） | `max_tokens` 已由 `max_completion_tokens` 取代 | 两个字段都在：`max_tokens` **默认 4096**，上界逐模型不同（模型列表里最大回答为 32K / 128K / 256K 不等）；该字段只算回答长度，不含思维链 | `params.maxTokens` = `max_tokens`；`limits.maxTokens` 只给 min 1 与 default 4096，**不给 max** |
| 输出上限（新名） | `max_completion_tokens` | `max_completion_tokens`，**取值 [1, 65536]**，含回答与思维链；**不可与 `max_tokens` 同时设置**，配置后 `max_tokens` 的默认值失效 | 未采用，理由见第七节 |
| 停止词 | `stop` | `stop`，`string / string[]`，默认最多 4 个（DeepSeek V4 系列 16 个、Kimi 系列 5 个）；**带深度思考能力标签的模型默认不支持该参数**（DeepSeek V4 与 Kimi 例外） | `params.stop` = `stop` |
| 思考开关 | 无同名机制 | `thinking: { type: "enabled" \| "disabled" }`，各模型默认值不同，豆包系多数默认 `enabled` | `reasoning:think`（`type-toggle`，field `thinking`） |
| 思考深度 | `reasoning_effort`：minimal/low/medium/high | `reasoning_effort`：**none / minimal / low / medium / high / xhigh / max 共 7 档**；默认值按模型为 `high` 或 `medium`，部分档位会按映射表折算（如 `none` 映射为 `minimal`，`xhigh`/`max` 映射为 `high`） | 未采用，理由见第七节 |
| 思考内容回传 | 不回传 | 响应含 `choices.message.reasoning_content` 与流式 `choices.delta.reasoning_content`；部分模型另回 `encrypted_content`（思考内容加密原文，工具调用场景须原样回传） | `type-toggle` 无法承载 responseField，见第七节 |
| 工具调用 | `tools[].type: function`、`tool_choice`、`parallel_tool_calls` | 同形：`tools[].type` 固定 `function`（`function.name / description / parameters / strict`）；`tool_choice` 为 `none / auto / required` 或指定函数；`parallel_tool_calls` 默认 true | 无对应能力 id（schema 只认 `tool:web-search` 与 `tool:read-url`），不声明 |
| 惩罚项 | `frequency_penalty` / `presence_penalty`，-2..2 | 字段存在，但 **`doubao-seed-2.0` 及后续系列不支持**；仅反映在文档，不进描述文件 | 无对应逻辑参数，不声明 |
| 对数概率 | `logprobs` / `top_logprobs` | 字段存在，但**深度思考能力模型不支持** | 同上 |
| top_k | 不支持 | 未查到（Chat API 请求参数表无 `top_k`） | 不声明 |
| 响应格式 | `response_format` | `response_format.type` 为 `text / json_object / json_schema`（json_schema 为 beta） | 无对应能力 id，不声明 |
| 系统提示 | `messages` 的 `system` 角色 | 同形：`messages` 中 `role: "system"` 的"系统消息" | `prompt:system`（`message-role`，`system`） |

## 四、多模态

| 模态 | 形态 | 来源 |
|:---:|:---|:---|
| 图片 | 内容块 `{"type": "image_url", "image_url": {...}}`；`image_url.url` 接受图片链接或 `data:image/<FORMAT>;base64,{data}`，`image_url.file_id` 接受 Files API 上传后的文件 ID（二选一）；另有 `detail`（low/high/xhigh）与 `image_pixel_limit`（min_pixels/max_pixels） | [S2]、[S6] |
| 图片体积 | Base64 与 URL 方式单张小于 10 MB、请求体不超过 64 MB；Files API 上传不超过 512 MB | [S6] |
| 文档 | Chat API 用内容块 `{"type": "file", "file": {"file_id": "..."}}` 传 PDF（须先经 Files API 上传且状态为 active）；Responses API 另有 `input_file` + `file_data`（Base64）/ `file_url` | [S7] |
| 视频 | 内容块 `{"type": "video_url", "video_url": {...}}`，支持 `url` 与 `file_id`，`fps` 取值 [0.2, 5] | [S2] |
| 音频 | 内容块 `{"type": "input_audio", "input_audio": {...}}`，支持 `data` / `url` / `file_id`，单文件不超过 25 MB | [S2] |

结论：图片与文档可以并入现有 schema 的 `vision:image` 与 `document:read`；视频与音频没有对应能力 id，本版不声明（按 schema 规则不得自造取值）。

## 五、工具与联网搜索

| API | 联网方式 | 是否具名工具 | 来源 |
|:---:|:---|:---|:---|
| Chat API | 顶层字段 `web_search_options`：传 `{}` 或任意子字段即触发搜索准入判定，模型自行决定是否检索；`search_context_size`、`user_location` 当前不生效；同时传 `tools` 时 **优先保留自定义工具，联网搜索不生效** | 否，请求体里没有工具名 | [S2]、[S4] |
| Responses API | `tools: [{"type": "web_search", "sources": ["doubao"]}]`（豆包搜索 Custom 版）；`tools: [{"type": "web_search"}]`（联网内容插件） | 是，`type` 即 `web_search` | [S4]、[S5] |
| Messages API | `tools: [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}]` | 是，`name` 为 `web_search` | [S4] |
| 其他内置工具 | `image_process`、`knowledge_search`、`mcp`、`doubao_app` | 是，但仅 Responses API 支持 | [S5] |

结论：Chat API 的联网搜索是"字段触发、无工具名"，而 schema 的 `tool:web-search` 要求 `names` 非空且原样写入请求体。按"只声明确实支持的"原则，豆包描述文件**不声明** `tool:web-search`；是否为此类形态扩展 schema 见第九节。

## 六、与自家 SDK 的关系

| 项 | 事实 | 来源 |
|:---:|:---|:---|
| SDK 包名 | 新版为 `arkruntime`（Python / Go / Java）；旧版 `volcengine-python-sdk[ark]` 里的 `volcenginesdkarkruntime` 已被取代。两套包名与 import 路径不同，不可混用请求/响应类型 | [S11] |
| 客户端初始化 | Python `Ark(base_url=...)`、Go `WithBaseUrl(...)`，官方示例都显式传入 `https://ark.cn-beijing.volces.com/api/v3`，SDK 不自带该基址 | [S11]、[S12] |
| 是否必须走 Endpoint ID | **不必须**。API Key 鉴权下 `model` 可直接填 Model ID；多应用与精细管理场景官方"推荐"改填 Endpoint ID。只有 **Access Key 签名鉴权**时，文档明确要求 `model` 配为 Endpoint ID | [S1]、[S2] |
| 与通用 OpenAI SDK 的关系 | 官方快速入门把"OpenAI SDK + 方舟 base_url"列为可用接入方式，说明协议层兼容，接入方不依赖方舟自家 SDK | [S12] |
| 与描述文件的关系 | 描述文件只描述线上协议（基址、路径、鉴权头、字段名），与用哪套 SDK 无关；换 SDK 不需要改描述文件 | 本仓库 `docs/spec.md` 第一节 |

## 七、描述文件取值与理由

| 字段 | 取值 | 理由 |
|:---:|:---|:---|:---|
| `format` | `openai-compatible` | 路径 `/chat/completions`、Bearer 鉴权、`messages` 数组、`choices[].delta` 流式帧，均为 OpenAI Chat Completions 形态；官方文档亦直接写明"兼容 OpenAI Chat Completions 接口协议" |
| `endpoints.base` | `https://ark.cn-beijing.volces.com/api/v3` | 官方数据面基址，末尾无斜杠，与 `/chat/completions` 直接拼接即得官方示例地址 |
| `endpoints.files` | `/files` | 声明了 `file-id` 输入，跨字段规则第 4 条要求该端点存在；官方 Files API 为 `POST /api/v3/files` |
| `credential` | `Authorization` + `Bearer ` | 官方 API Key 鉴权写法；Access Key 签名鉴权属另一形态，本版不支持按端点覆盖凭据 |
| `params.maxTokens` | `max_tokens` | 官方文档的主字段（默认 4096，逐模型上界见模型列表）；`max_completion_tokens` 与之互斥，只能取其一 |
| `limits.maxTokens` | `min 1`、`default 4096`、不给 `max` | 上界随模型而变（32K/128K/256K），schema 允许省略 `max` 表示"上界随模型而变" |
| `limits.temperature` | 0..2，default 1 | 官方取值 [0, 2]、默认 1.0 |
| `limits.topP` | 0..1，default 0.7 | 官方取值 [0, 1]、默认 0.7（与 OpenAI 默认 1 不同） |
| `reasoning:think` | `type-toggle`，field `thinking`，on `enabled`，off `disabled` | 所有带"深度思考"标签的豆包模型都支持该开关；未声明 `adaptiveValue`，因官方 Chat API 文档只列 enabled/disabled |
| `vision:image` | `image_url`，inputs `url / base64 / file-id` | 三种传入方式官方均支持，含 `detail` 与像素限制 |
| `document:read` | `file`，inputs `file-id` | Chat API 只有 `type: "file"` + `file_id` 一种已被官方示例演示的方式；Base64 与 URL 的文档示例只出现在 Responses API |
| 不声明 `tool:*` | — | 见第五节：Chat API 端无具名服务端工具；函数调用没有对应能力 id |

## 八、未查到的项

| 项 | 状态 | 说明 |
|:---:|:---|:---|
| `top_k` 是否支持 | 未查到 | Chat API 请求参数表中没有该字段，也没有"不支持"的明文表述 |
| `thinking.type` 是否支持 `auto` | 未查到 | 官方 Chat API 与深度思考文档只列 `enabled` / `disabled`；旧版 Python SDK 的类型定义里有 `auto`，但无文档背书，故不声明 |
| 系统提示是否支持 `developer` 角色 | 未查到 | 文档只描述 `system` 角色的"系统消息" |
| 深度思考模型的 `stop` 是否有开关可恢复 | 未查到 | 文档写"默认不支持该参数"，未说明可否开启 |
| 各模型 `max_tokens` 上界的完整清单 | 部分查到 | 模型列表给出"最大回答"值，但表格随模型上下线变动，故描述文件不写死 max |
| 文档在 Chat API 下是否支持 Base64 与 URL 直传 | 未查到 | 官方 Base64 与 URL 示例均使用 `/responses`；Chat API 只有 `file_id` 示例 |
| 联网搜索在 Chat API 的服务端工具名 | 未查到（且疑似不存在） | Chat API 用 `web_search_options` 字段触发，请求体无工具名 |
| 免费额度、限流与计费 | 不查 | 属账户侧事实，按规范不进描述文件 |

## 九、需要人工确认的项

| 编号 | 事项 | 建议 |
|:---:|:---|:---|
| 1 | 豆包描述文件不声明 `tool:web-search`，是否会漏掉使用者预期 | 若必须表达，需要 schema 新增"字段触发的服务端工具"分支（`names` 可空并以 `requestField` 表达），或改为对 Responses API 另立来源后声明 `web_search` |
| 2 | `reasoning:think` 同一 id 至多一条，而豆包同时支持 `thinking.type` 与 `reasoning_effort` | 本文件选了 `type-toggle`（覆盖面最广）；若产品侧要暴露"思考深度"滑杆，需要 schema 支持同一 id 声明两种 style |
| 3 | `maxTokens` 选 `max_tokens` 还是 `max_completion_tokens` | 本文件选 `max_tokens`（平台主字段、官方示例最常用）；若读取方需要"回答+思维链"合并上限，应改选 `max_completion_tokens`（[1, 65536]） |
| 4 | 是否要把 Responses API 另立一条来源（如 `doubao-responses`） | Chat API 与 Responses API 协议形态不同，按 spec 3.2 应为两个来源；本任务只做 Chat API |
| 5 | `document:read.contentType` 取 `file` 是否被读取方接受 | 该取值原样来自 Chat API 内容块 `type`；若读取方按 OpenAI 的 `file` 语义理解，需确认兼容 |
| 6 | `format` 是否该用 `deepseek-compatible` | 未采用：该取值的语义是"OpenAI 基础字段 + 官方扩展"，豆包确实有 `thinking`、`web_search_options`、`reasoning_content` 等扩展，但取值名绑定 DeepSeek，用作豆包会误导。是否新增通用取值需规范层决策 |
| 7 | 是否需要接管控面 API 校验密钥 | 本版只用数据面 `GET /models` 校验可达性；管控面需 Access Key 签名，超出本版凭据形态 |

## 十、发现但没改的问题

| 位置 | 问题 | 为何没改 |
|:---:|:---|:---|
| `docs/spec.md` 第五节 | "三家差异对照"只有 DeepSeek / OpenAI / Anthropic，加入豆包后未更新 | 属规范文本扩写，超出本任务"调研 + 新增示例"范围，且改动会牵动多处口径 |
| `docs/spec.md` 第七节 | "当前校验输出"仍是 3 份示例的旧快照 | 同上，需随规范一次成批更新 |
| `docs/spec.md` 附录文件清单 | 只列三份示例 | 同上 |
| `scripts/validate-specs.mjs` 第 4 步 | 语义抽查硬编码 anthropic / deepseek / openai 三家断言，无豆包抽查项 | 改脚本会改变 CI 口径；新示例已能通过现有四步检查 |
| `schemas/source-descriptor.schema.json` `$defs.dialect` | `deepseek-compatible` 的描述是通用表述（"OpenAI 基础字段之外另有官方扩展"），但取值名绑定厂商，导致豆包这类"OpenAI 兼容 + 自有扩展"的来源无处安放 | 新增/删除枚举取值须升 `schemaVersion`，属破坏性变更，需人工决策 |

## 十一、复核命令

```bash
node scripts/validate-specs.mjs
```

输出（节选）：

```text
通过  schemas/examples/doubao.descriptor.json
      doubao [openai-compatible] text:generate,prompt:system,reasoning:think,vision:image,document:read
自检通过: 1 份 Schema,1 条内联实例,4 份示例
```
