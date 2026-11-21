/**
 * dsc 插件契约与供应端点契约的精简类型声明。
 *
 * 插件契约部分是 dsc-plugin-template 规范的本地副本,只覆盖本插件用到的字段;
 * 供应端点部分按 DeepSeek-Chat-Enhanced 引擎的 dsc-core/source-catalog 与
 * dsc-plugin-engine/types 收录,只覆盖本插件用到的成员。
 * 若与实现源码不一致,以实现源码为准。
 * 契约速查:specs/plugin-runtime-spec.md(本仓库副本)。
 */

/* ---------- 清单 ---------- */

/** 清单中的能力名,取值来自引擎的能力表;provider:run 与 settings:surface 已在引擎实现,上游 Schema 枚举待同步 */
export type DscCapability =
  | 'sessions:list'
  | 'sessions:read'
  | 'sessions:rename'
  | 'events:session'
  | 'notify'
  | 'settings:locale'
  | 'settings:surface'
  | 'assets:read'
  | 'plugins:storage'
  | 'chat:request'
  | 'provider:source'
  | 'provider:run'

/** 挂载点:会话切换事件与请求前环节 */
export type DscMount = 'session:changed' | 'chat:before-request'

/**
 * 插件清单。
 * id 须匹配 ^[a-z][a-z0-9-]{2,63}$,version 为三段数字,capabilities 不得重复。
 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  /** 兼容的 dsc-core 版本范围,支持 ^ ~ >= <= 与精确版本 */
  engines?: string
  /** 依赖的插件 id,安装时须已存在,激活时须已激活 */
  dependencies?: string[]
  /** 冲突的插件 id,同时安装会被拒绝 */
  conflicts?: string[]
  capabilities: DscCapability[]
  mounts?: DscMount[]
}

/* ---------- 供应端点描述(引擎形态) ---------- */

/** 供应端点的能力标识,引擎按它分派;线上协议形态由描述的 format 决定 */
export type SourceCapabilityId =
  | 'text.generate'
  | 'reasoning.think'
  | 'vision.image'
  | 'document.read'
  | 'audio.asr'
  | 'audio.tts'
  | 'tool.web-search'
  | 'tool.read-url'
  | 'models.list'

/** 线上协议格式;本版引擎只接通这两种,描述侧方言到它的映射见 sources/descriptor.ts */
export type EngineSourceFormat = 'anthropic-messages' | 'openai-chat'

/**
 * 供应端点描述,插件只交这一份描述,不交执行代码。
 * 形状对齐引擎的 CoreSourceDescriptor:执行、凭证与合并都在引擎与内核,插件拿不到执行侧标识。
 */
export interface EngineSourceDescriptor {
  /** 供应端点 id;注册表按它判重与合并,冲突也按它判定 */
  readonly id: string
  /** 展示名称;只用于界面展示,不参与冲突判定 */
  readonly label: string
  /** 线上协议格式 */
  readonly format: EngineSourceFormat
  /** 规范化后的端点基址,例如 https://api.deepseek.com */
  readonly baseUrl: string
  /** 该供应端点可提供的能力清单;注册表按并集合并,执行前再校验一次 */
  readonly capabilities: readonly SourceCapabilityId[]
  /** 端点路径覆盖;缺省按 format 推导,只允许站内绝对路径 */
  readonly endpoints?: Readonly<Partial<Record<SourceCapabilityId, string>>>
}

/* ---------- 供应端点执行(provider.run) ---------- */

/** 用户消息内容块;文件块是否可接受由描述声明的能力决定 */
export type SourceContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image' | 'document'; readonly fileId: string }

/** 与协议无关的消息形态;roles 与引擎载荷一致 */
export type SourceMessage =
  | { readonly role: 'latest_reminder'; readonly content: string }
  | { readonly role: 'user'; readonly content: string | readonly SourceContentBlock[] }
  | { readonly role: 'assistant'; readonly content: readonly { readonly type: 'text'; readonly text: string }[] }

/** text.generate 的载荷;系统提示词只给一份与协议无关的字符串,落位由内核按 format 决定 */
export interface TextGeneratePayload {
  readonly model: string
  readonly system: string
  readonly messages: readonly SourceMessage[]
  readonly thinking?: boolean
  readonly search?: boolean
  readonly title?: boolean
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
}

/** models.list 的载荷;本版没有可选参数 */
export type ModelsListPayload = Record<string, never>

/** 与协议无关的回流事件 */
export type SourceStreamEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string }
  | { readonly type: 'title'; readonly title: string }
  | { readonly type: 'end'; readonly stopReason: string | null }

/** 模型清单条目;只含 id */
export interface SourceModel {
  readonly id: string
}

/** 一次按端点执行的结果;本版只有这两种形态 */
export type ProviderRunResult =
  | { readonly kind: 'stream'; readonly events: AsyncIterable<SourceStreamEvent> }
  | { readonly kind: 'models'; readonly models: readonly SourceModel[] }

/**
 * 能力 provider:source 与 provider:run 暴露的上下文成员。
 * registerSource 只登记描述(限流 50 次/10 秒,仅登记);run 发起执行
 * (限流 10 次/10 秒,15 秒只覆盖建立调用,流式回流惰性产出)。
 * 未申请对应能力时调用抛 PluginCapabilityError;执行失败抛引擎的
 * PluginProviderRunError,按 error.code 区分原因。
 */
export interface PluginProviderApi {
  registerSource(descriptor: EngineSourceDescriptor): void
  run(
    capability: 'text.generate',
    payload: TextGeneratePayload,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ProviderRunResult>
  run(
    capability: 'models.list',
    payload: ModelsListPayload,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ProviderRunResult>
  run(
    capability: SourceCapabilityId,
    payload: TextGeneratePayload | ModelsListPayload,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ProviderRunResult>
}

/* ---------- 设置表面(settings:surface) ---------- */

/** 设置字段的类型;控件形态由宿主按类型渲染,插件只交描述、不交控件 */
export type SettingFieldType = 'switch' | 'select' | 'number' | 'text' | 'secret'

/** 设置值;只有标量 */
export type SettingValue = string | number | boolean

/**
 * 单个设置字段的描述,只收录本插件用到的成员,完整契约以引擎的
 * dsc-plugin-engine/pluginSettings.ts 为准。
 * secret 字段不得有 default:密钥明文只写不读,读侧只回答「是否已配置」。
 */
export interface SettingFieldDescriptor {
  /** 字段键,也是设置存储的键;同一份描述内不得重复 */
  readonly key: string
  readonly type: SettingFieldType
  /** 插件直给的文案(1 到 40 字符);labelKey 走宿主字典,本插件不占用 */
  readonly label?: string
  /** 默认值;非 secret 字段必填,secret 字段不得有 */
  readonly default?: SettingValue
  /** text 的长度上限 */
  readonly maxLength?: number
}

/** 一份设置表面描述;同一插件只保留最后登记的一份 */
export interface SettingDescriptor {
  readonly fields: readonly SettingFieldDescriptor[]
}

/**
 * 能力 settings:surface 暴露的上下文成员。
 * register 在激活期登记字段描述,返回释放函数,停用随引擎清理;
 * values 只读自身设置值:用户覆盖值优先,否则默认值,secret 字段不返回任何值
 * (连「是否已配置」也不可见),密钥的存在性由引擎在执行时判定。
 * 写侧不在插件上下文:改动只由用户在宿主设置页保存,插件读不到变更推送。
 */
export interface PluginSettingsApi {
  register(descriptor: SettingDescriptor): () => void
  values(): Record<string, SettingValue>
}

/* ---------- 上下文与插件对象 ---------- */

/**
 * 激活时注入的上下文。
 * 本插件申请 provider:source、provider:run 与 settings:surface,
 * 声明 provider 与 settings 两个能力对象;locale 走 settings:locale,
 * 本插件未申请,不声明该成员。
 */
export interface PluginContext {
  /** 当前插件 id,与清单一致 */
  readonly id: string
  /** 当前插件版本,与清单一致 */
  readonly version: string
  /** 写入该插件的日志,可在插件面板的「查看日志」中读取 */
  log(message: string): void
  readonly provider: PluginProviderApi
  readonly settings: PluginSettingsApi
}

/** 插件对象;activate 超时 5 秒,deactivate 超时 3 秒,返回值均被忽略 */
export interface DscPlugin {
  activate(context: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
