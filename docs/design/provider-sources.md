# 供应端点注册与调用封装设计

> 状态:内置端点、注册、运行时校验与两条封装已落地;端点选择、密钥填写与设置控件待宿主表面,见第六节缺口清单。
> 本文记录机制与取舍理由;描述文件的结构口径见 [../spec.md](../spec.md),规范与 Schema 见 [../../specs/README.md](../../specs/README.md);三者冲突时以实现为准并当轮对齐。

## 一、定位与边界

dsc-provider-switch 把「一个模型来源的端点描述」做成可注册的插件资产:激活时把内置端点描述登记给宿主(`context.provider.registerSource`),并为本插件自己发起调用提供两条 `context.provider.run` 封装(文本生成与模型列表)。

| 做 | 不做 |
|:---:|:---:|
| 内置三份端点描述并在激活时注册 | 不改写宿主的任何一次会话请求:不申请 `chat:request`,不声明挂载点 |
| 提供文本生成与模型列表两条执行封装 | 不做端点选择:选择权在宿主,本版取注册表里该能力的第一个端点 |
| 注册前对内置描述做一次运行时校验 | 不读、不存、不传任何密钥:凭证由用户填写,引擎在执行时读取,插件拿不到 |
| 记录方言与引擎协议格式之间的映射 | 不做通用联网:只能打到注册表里的端点,不走 `net:fetch` |

两条能力分开申请的理由与上游一致:声明只交描述,执行会花用户填的 Key 与端点额度,授权单位不该相同(`provider:source` 限登记 50 次/10 秒,`provider:run` 限执行 10 次/10 秒,单次建立调用 15 秒,流式回流惰性产出不占该预算)。

## 二、内置端点与方言选择

内置三份描述按优先级排列,顺序即激活时的注册顺序:

| 顺序 | id | 方言 | 基址 | 对话路径 | 能力数 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `deepseek-anthropic` | `anthropic-compatible` | `https://api.deepseek.com` | `/anthropic/v1/messages` | 3 |
| 2 | `openai` | `openai-compatible` | `https://api.openai.com/v1` | `/chat/completions` | 5 |
| 3 | `anthropic` | `anthropic-compatible` | `https://api.anthropic.com` | `/v1/messages` | 7 |

三份描述的 JSON 副本在 `schemas/examples/` 下,`scripts/test/sources.test.ts` 断言内存对象与 JSON 副本逐字相等,两边不会各自漂移。

### 2.1 DeepSeek 为什么取 anthropic-compatible

任务给过两个候选:按调查保留 `deepseek-compatible`,或改用 `anthropic-compatible` 端点形态。取后者,理由三条:

1. **执行侧只认两种协议格式。** 引擎内核的供应端点执行层本版只实现 `anthropic-messages` 与 `openai-chat` 两条线路(DeepSeek-Chat-Enhanced 的 `src/components/dsc-core/source-catalog.ts` 的 `SOURCE_FORMATS`),且请求组装与流式解析只有 Anthropic 形态一条实现(`src/components/dsc-core/sources.ts` 的 `assembleTextGenerateRequest` 与 `streamMessageAt`)。注册一份 `deepseek-compatible` 描述会被转换成 `openai-chat`,但今天没有对应的执行分支,端点登记了也调不通。
2. **Anthropic 形态是宿主已验证的生产路径。** 宿主自己的 API 客户端就是按 Anthropic 兼容形态调 DeepSeek 的:`ANTHROPIC_BASE_URL = ${API_ORIGIN}/anthropic/v1`(`src/services/api/client.ts` 第 15 行),鉴权用 `x-api-key`,且该端点不要求 `anthropic-version` 固定头。模型列表沿用 OpenAI 形态的 `GET /models`,与引擎 `anthropic-messages` 的默认路径表一致。
3. **方言不消失,只是不作为内置首选。** `deepseek-compatible`(OpenAI 形态加 `reasoning_content` 扩展)保留在 `schemas/examples/deepseek.descriptor.json` 作为方言示例与未来的注册候选;按 docs/spec.md 3.2,同一厂商的两种协议形态是两个来源,因此内置描述用独立 id `deepseek-anthropic`,不与 `deepseek` 复用。

### 2.2 与宿主既有事实的落点

| 维度 | 取值 | 依据 |
|:---:|:---|:---|
| DeepSeek 鉴权 | `x-api-key` | 该端点同时接受 `Authorization: Bearer`,取宿主既有路径的写法(client.ts 注释) |
| DeepSeek 思考 | `reasoning:think`(`type-toggle`,field `thinking`) | 宿主对 DeepSeek 端点恒发 `thinking: {type: enabled 或 disabled}`,回流含 `thinking_delta` |
| DeepSeek 视觉 | 不声明 | DeepSeek 官方 API 仅文本;宿主的图片能力依赖 Files API,未确认该端点对 DeepSeek 开放 |
| OpenAI 停止词 | `stop` | 与 `schemas/examples/openai.descriptor.json` 一致 |
| Anthropic 必填参数 | `requiredParams: [maxTokens]` | Anthropic 协议 `max_tokens` 必填 |

## 三、方言到引擎描述的转换

引擎的 `registerSource` 只认 `CoreSourceDescriptor`:点分能力标识、两种协议格式、基址加路径覆盖。转换规则(`src/sources/descriptor.ts` 的 `toEngineDescriptor`):

| 描述侧 | 引擎侧 | 说明 |
|:---:|:---:|:---:|
| `format` 三方言 | `anthropic-messages` / `openai-chat` | `anthropic-compatible` 到 `anthropic-messages`;其余两种到 `openai-chat` |
| `endpoints.chat.path` | `endpoints['text.generate']` | 路径覆盖,不依赖 format 默认表 |
| `endpoints.models.path` | `endpoints['models.list']` | 描述的 `endpoints.models` 必填,因此 `models.list` 恒声明 |
| `capabilities` 里的 `text:generate` | `capabilities` 里的 `text.generate` | 冒号形态转点分形态 |
| 其余能力(reasoning:think、vision:image 等) | 不进引擎清单 | 引擎本版没有这些能力的执行分支,声明了也无法执行 |
| `name` | `label` | 优先 `zh-CN`,缺失用 `en-US`,再缺失用 id |

## 四、注册与运行时校验

激活(`src/index.ts` 的 `activate`)只做一件事:按内置顺序逐条注册(`src/sources/register.ts`)。

- 注册前对每份描述跑 `validateSourceDescriptor`(`src/sources/validate.ts`):结构规则与跨字段规则与 Schema、脚本同口径(schemaVersion、id、name、format、端点拼接形态、credential、能力对象逐项形状、方言与 stream 一致、prompt:system 同声明、requiredParams 包含于 params、file-id 依赖 files 端点)。内置数据是写死的,但校验失败宁可抛错,不把非法描述交给引擎。
- 校验失败(内置数据缺陷)直接抛错;引擎拒绝(如 `PluginSourceError`、同 id 冲突)只写插件日志并继续,不让一个坏条目拖住其余端点。
- 这是第三道闸:发布前 `scripts/validate-specs.mjs` 校验 JSON 副本,测试断言内存对象与副本相等,注册前再校验一次即将交给引擎的对象。
- 重复激活跳过注册;停用只复位自身状态,登记由引擎注册表持有,不在 deactivate 里清空。

运行时校验不是完整 Schema 校验:它只覆盖注册前必须成立的结构与跨字段规则,完整校验仍以 `schemas/source-descriptor.schema.json` 与 `scripts/validate-specs.mjs` 为准。

## 五、两条封装

`src/sources/run.ts` 提供两条封装,把「与协议无关的请求」对照描述校验后交给 `context.provider.run`:

| 封装 | 职责 | 失败口径 |
|:---:|:---|:---|
| `runTextGenerate(context, request, descriptor?)` | 组装 `TextGeneratePayload`:model、system(缺省空串)、messages 原样透传;四个参数键必须在描述 `params` 里声明、按 `limits` 越界拒绝不裁剪;`requiredParams` 全部给出;`thinking` 须有 `reasoning:think`,`search` 须有 `tool:web-search` | 组装失败抛 `SourceAssemblyError`,按 `code` 分 `invalid-request` / `param-unsupported` / `param-out-of-range` / `param-required-missing` / `capability-unsupported` |
| `runModelsList(context)` | 调 `models.list`,把结果收敛为模型 id 数组 | 形态不符抛 `SourceAssemblyError`;引擎错误原样抛出 |

统一的两条边界:

- **descriptor 缺省用 deepseek-anthropic。** 引擎按「该能力的第一个端点」选择执行端点,本插件按内置顺序先注册 deepseek-anthropic,校验口径与预期选择一致;其他插件若抢先声明了端点,选择会变,但「校验以描述为准」的口径不变,调用方可以显式传描述。
- **引擎错误不吞、不重试、不降级。** `PluginCapabilityError`(未申请能力)、`PluginRateLimitError`(10 次/10 秒)、`PluginProviderRunError`(凭证缺失、能力未接通、协议错误等七类码)原样抛给调用方,由宿主侧的界面或调用方决定提示与降级。

系统提示词的落位(`prompt:system` 的两种 mode)不由封装分支:载荷只有一份与协议无关的 `system` 字符串,顶层字段还是 messages 里的一条消息由内核按 format 组装,描述里的 `prompt:system` 声明用于校验与文档,不参与分支。

## 六、缺口与未定稿

| 缺口 | 现状 | 需要什么 |
|:---:|:---|:---|
| **设置控件待宿主表面** | 宿主还没有提供插件设置界面能力:端点列表展示、启停切换、密钥填写、端点选择都不存在插件侧入口。插件不自行造 DOM,也不申请 `net:fetch` 或读取宿主内部状态来绕过 | 宿主的插件设置表面;落地后把密钥填写与端点启停接进宿主既有文案键,本插件只交描述与封装 |
| 端点选择语义 | 本版引擎取注册表里该能力的第一个端点,插件不能指定端点;多插件同时声明时归属随激活顺序变化,引擎文档已把这列为待决项 | 宿主明确「可选集合按插件限定」还是「由用户指定本次用哪个端点」 |
| `openai-chat` 执行缺口 | 内核没有 `openai-chat` 的执行分支,内置的 openai 端点登记后今天调不通;转换层与校验已就绪 | 内核补齐 `openai-chat` 分支前,openai 端点仅作声明占位 |
| doubao 未内置 | `schemas/examples/doubao.descriptor.json` 已按调研落成方言示例,但豆包的 `reasoning:think` 形态(type-toggle 加 effort-level 并存、responseField)超出本版 Schema 的单分叉表达,未内置注册 | Schema 演进后再评估;见 docs/spec.md 第八节 |
| 引擎 Schema 未收录 `provider:run` | 清单与 meta Schema 的能力枚举只到 `provider:source`;引擎实现已含 `provider:run` | 上游同步 Schema 枚举;差异已记入 specs/README.md 的「已知差异」表 |
| 根 README | 本仓库还没有面向人的 `README.md` / `README.en-US.md`,入口说明暂由本设计文档与 docs/README.md 承担 | 插件形态稳定后补齐中英两版 |

## 七、与宿主实现的对齐依据

| 结论 | 证据 |
|:---:|:---|
| `provider:source` / `provider:run` 的能力与限流 | 引擎 `dsc-plugin-engine/capabilities.ts` 第 67、70 行的策略表;build-a-plugin.md 的能力清单表 |
| `registerSource` 的描述形态 | `dsc-core/source-catalog.ts` 的 `CoreSourceDescriptor`:{id, label, format, baseUrl, capabilities, endpoints?} |
| 执行错误码 | `dsc-plugin-engine/providerRun.ts` 的七类 `ProviderRunErrorCode` |
| 流式事件与模型清单形态 | `dsc-core/sources.ts`:text / thinking / title / end 四类事件;models 只含 id |
| DeepSeek Anthropic 形态路径与鉴权 | `services/api/client.ts` 第 15 行(/anthropic/v1)、第 85 行(x-api-key)、`verifyApiKey`(`GET /models`) |
