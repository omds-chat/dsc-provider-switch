# 供应端点注册与调用封装设计

> 状态:内置端点、注册、运行时校验、两条封装与设置表面(settings:surface)已落地;端点选择语义、设置值变更推送与编辑后的重新注册时机仍是缺口,见第六节缺口清单。
> 本文记录机制与取舍理由;描述文件的结构口径见 [../spec.md](../spec.md),规范与 Schema 见 [../../specs/README.md](../../specs/README.md);三者冲突时以实现为准并当轮对齐。

## 一、定位与边界

dsc-provider-switch 把「一个模型来源的端点描述」做成可注册的插件资产:激活时把内置端点描述登记给宿主(`context.provider.registerSource`),并为本插件自己发起调用提供两条 `context.provider.run` 封装(文本生成与模型列表)。

| 做 | 不做 |
|:---:|:---:|
| 内置三份端点描述并在激活时注册 | 不改写宿主的任何一次会话请求:不申请 `chat:request`,不声明挂载点 |
| 提供文本生成与模型列表两条执行封装,执行前按设置过滤停用端点 | 不做端点选择:选择权在宿主,本版取注册表里该能力的第一个端点 |
| 经 `settings:surface` 登记设置表面 | 不读、不存、不传任何密钥:凭证由用户在宿主设置页填写,引擎在执行时读取,插件连「是否已配置」都看不到 |
| 注册前对内置描述做一次运行时校验 | 不自行造 DOM:字段描述交宿主渲染,插件不碰控件、样式与 i18n |
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

### 设置表面与启停过滤

宿主的插件设置表面(`settings:surface`,实现在引擎 `pluginSettings.ts`)已落地,本插件按它接通端点配置:

| 环节 | 落点 | 说明 |
|:---:|:---:|:---|
| 字段描述 | `src/sources/settings.ts` 的 `SETTING_DESCRIPTOR` | 8 个字段:每个内置端点一个 `switch`(默认启用)与一个 `secret`(API Key,无默认值),加两个可选 `text`(自定义 OpenAI/Anthropic 兼容端点 baseUrl,默认空串,留空即不注册)。label 由插件直给,不占用宿主字典的 labelKey |
| 登记 | `activate` → `registerSettingsSurface` | 与 `registerSource` 同法:只登记描述、不交控件;引擎整份拒绝(如 `PluginSettingsError`)时只写日志继续,不拖住端点注册;释放函数随引擎 disposer 集合,停用随引擎清理 |
| 读侧 | `context.settings.values()` | 只读自身命名空间:覆盖值优先,否则默认值;`secret` 字段完全不返回,连「是否已配置」也不可见 |
| 执行过滤 | `run.ts` 的 `resolveTargetDescriptor` | 每次 run 前重读 `values()` 推导启停:目标端点被停用按 `endpoint-disabled` 拒绝,不发 run、不花额度;未传描述时取「启用的内置端点 + 自定义端点」的第一个,全部停用同样拒绝 |
| 自定义端点 | `CUSTOM_OPENAI_SOURCE` / `CUSTOM_ANTHROPIC_SOURCE` 模板 | 按设置的 baseUrl 实例化(去空白与尾部斜杠),过一遍 `validateSourceDescriptor` 后注册;模板只声明 `text:generate` 与 `prompt:system` 的最小能力集,不带 limits 与未经验证的能力 |

可用性判定分两层,口径刻意不重叠:

- **插件层只判启停。** 开关字段的读取口径是 `!== false` 即启用:缺省与类型异常都按默认启用,设置读取失败(如能力异常)时整份按未配置处理,不让设置表面的故障挡住执行主链路。
- **引擎层判密钥。** `secret` 字段对插件完全不可见,插件不猜、也不问「有没有 Key」;无 Key 的端点由引擎在执行时抛 `PluginProviderRunError` 的 `credential-missing`,两条封装原样上抛。停用优先于凭证:端点被停用时连执行都不发起,轮不到凭证判定。

两条能力分开申请的理由不变;`settings:surface` 单独第三条:它只交描述,写侧在宿主的 `engine.pluginSettings(pluginId)` 门面,插件读不到密钥,与前两条互不授受。

## 六、缺口与未定稿

| 缺口 | 现状 | 需要什么 |
|:---:|:---|:---|
| **设置值变更推送待宿主** | 宿主本轮没有变更推送能力:`settings.register` 只登记描述,没有值变化的回调或订阅。插件不轮询后台、也不自建缓存,而是在两条封装里每次 run 前重读一遍 `context.settings.values()`;启停过滤因此是准时的,但代价是每次执行多一次设置读取(同窗口 60 次/10 秒的限流内) | 宿主提供设置值变更事件或回调;落地后封装可改为登记回调 + 缓存,去掉逐次读取 |
| **编辑后的重新注册时机** | 自定义端点按激活时的设置值注册进引擎注册表;设置页改动后,执行侧(`resolveTargetDescriptor`)立即跟随新值,但注册表里的登记还是激活时的旧值——填了 baseUrl 的自定义端点要等插件重新激活才进注册表,取消填写的自定义端点登记也不会撤销 | 宿主提供重新激活或声明刷新途径;落地后 `registerCustomSources` 可在变更时重跑 |
| **自定义端点没有密钥字段** | 设置表面只给两个自定义 baseUrl 文本输入,没有对应的 `secret` 字段:用户填了 baseUrl 却无处填 Key,自定义端点执行时必然报 `credential-missing`;内置端点的密钥字段清单按任务口径固定为三条,不擅自扩 | 确认自定义端点的密钥填写口径:补两个 `secret` 字段,或宿主把凭证填写统一收进端点详情页 |
| 端点选择语义 | 本版引擎取注册表里该能力的第一个端点,插件不能指定端点;多插件同时声明时归属随激活顺序变化,引擎文档已把这列为待决项。本插件的启停过滤只能决定「要不要拒绝」,不能决定「用哪个端点」 | 宿主明确「可选集合按插件限定」还是「由用户指定本次用哪个端点」 |
| `openai-chat` 执行缺口 | 内核没有 `openai-chat` 的执行分支,内置的 openai 端点与自定义 OpenAI 兼容端点登记后今天调不通;转换层与校验已就绪 | 内核补齐 `openai-chat` 分支前,这两类端点仅作声明占位 |
| doubao 未内置 | `schemas/examples/doubao.descriptor.json` 已按调研落成方言示例,但豆包的 `reasoning:think` 形态(type-toggle 加 effort-level 并存、responseField)超出本版 Schema 的单分叉表达,未内置注册 | Schema 演进后再评估;见 docs/spec.md 第八节 |

## 七、与宿主实现的对齐依据

| 结论 | 证据 |
|:---:|:---|
| `provider:source` / `provider:run` 的能力与限流 | 引擎 `dsc-plugin-engine/capabilities.ts` 第 67、70 行的策略表;build-a-plugin.md 的能力清单表 |
| `registerSource` 的描述形态 | `dsc-core/source-catalog.ts` 的 `CoreSourceDescriptor`:{id, label, format, baseUrl, capabilities, endpoints?} |
| 执行错误码 | `dsc-plugin-engine/providerRun.ts` 的七类 `ProviderRunErrorCode` |
| 流式事件与模型清单形态 | `dsc-core/sources.ts`:text / thinking / title / end 四类事件;models 只含 id |
| DeepSeek Anthropic 形态路径与鉴权 | `services/api/client.ts` 第 15 行(/anthropic/v1)、第 85 行(x-api-key)、`verifyApiKey`(`GET /models`) |
| `settings:surface` 能力与上下文成员 | 引擎 `dsc-plugin-engine/capabilities.ts` 的 'settings:surface' 策略行(登记与读取共用 60 次/10 秒)与 `settings.register` / `settings.values` 的装配;`types.ts` 的 `SettingsCapability` |
| 设置字段的类型与校验 | 引擎 `dsc-plugin-engine/pluginSettings.ts`:`SettingFieldType` 五类、`SETTING_KEY_PATTERN`、secret 无默认值(default-forbidden)、非 secret 必有 default(invalid-default)、上限 32 字段 / 8 KB |
| 值的两层语义与 secret 不可见 | `pluginSettings.ts` 的 `pluginSettingValuesForPlugin`:secret 字段对插件完全不返回;`PluginSettingsFacade.values()` 的 `secretConfigured` 只给宿主门面,不进插件上下文 |
