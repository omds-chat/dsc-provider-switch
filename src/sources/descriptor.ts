/**
 * 来源描述的内存形状、内置端点与到引擎描述的转换。
 *
 * 描述形状按 schemas/source-descriptor.schema.json 与 docs/spec.md 定义:
 * 能力标识用冒号形态,协议方言用 format 字段。引擎的 registerSource 只认
 * CoreSourceDescriptor(点分能力标识,两种协议格式),转换规则见 toEngineDescriptor。
 * 内置描述的 JSON 副本在 schemas/examples/ 下,scripts/test 断言两者逐字相等。
 */
import type { EngineSourceDescriptor, EngineSourceFormat } from '../types.js'

/** 线上协议方言;判定口径见 docs/spec.md 3.4 */
export type SourceDialect = 'anthropic-compatible' | 'openai-compatible' | 'deepseek-compatible'

/** 双语文案对象;缺失侧由读取方用另一侧补齐 */
export interface LocalizedText {
  'zh-CN'?: string
  'en-US'?: string
}

/** 端点上与密钥无关的固定请求头 */
export interface EndpointHeader {
  readonly name: string
  readonly value: string
}

/** 单个端点:path 必填且以斜杠开头,headers 可选 */
export interface SourceEndpoint {
  readonly path: string
  readonly headers?: readonly EndpointHeader[]
}

/** 端点集合;base 与各 path 直接拼接,不做 URL 相对解析 */
export interface SourceEndpoints {
  readonly base: string
  readonly chat: SourceEndpoint
  readonly models: SourceEndpoint
  readonly files?: SourceEndpoint
}

/** 凭据形态;只描述密钥放哪个头,不承载密钥内容 */
export interface SourceCredential {
  readonly kind: 'api-key'
  readonly headers: readonly { readonly name: string; readonly prefix?: string }[]
}

/** text:generate 的逻辑参数键;键封闭,未列出的键表示该来源不支持 */
export type TextParamKey = 'maxTokens' | 'temperature' | 'topP' | 'topK' | 'stop'

/** 取值边界;max 缺省表示上界随模型而变 */
export interface ParamLimit {
  readonly min: number
  readonly max?: number
  readonly default?: number
}

/** text:generate:文本生成与参数映射 */
export interface TextGenerateCapability {
  readonly id: 'text:generate'
  readonly stream: 'sse-anthropic' | 'sse-openai' | 'none'
  readonly params?: Readonly<Partial<Record<TextParamKey, string>>>
  readonly requiredParams?: readonly TextParamKey[]
  readonly limits?: Readonly<Partial<Record<TextParamKey, ParamLimit>>>
}

/** prompt:system:系统提示词放在哪 */
export type PromptSystemCapability =
  | { readonly id: 'prompt:system'; readonly mode: 'top-level-field'; readonly field: string }
  | { readonly id: 'prompt:system'; readonly mode: 'message-role'; readonly role: 'system' | 'developer' }

/** reasoning:think:思考开关的两种形态 */
export type ReasoningThinkCapability =
  | {
      readonly id: 'reasoning:think'
      readonly style: 'type-toggle'
      readonly field: string
      readonly onValue: string
      readonly offValue: string
      readonly adaptiveValue?: string
      readonly budgetField?: string
      readonly budgetMin?: number
      readonly budgetCountsInMaxTokens?: boolean
    }
  | {
      readonly id: 'reasoning:think'
      readonly style: 'effort-level'
      readonly field: string
      readonly levels: readonly string[]
      readonly defaultLevel?: string
      readonly responseField?: string
    }

/** vision:image 与 document:read 共用的形状 */
export interface ContentCapability {
  readonly id: 'vision:image' | 'document:read'
  readonly contentType: string
  readonly inputs: readonly ('base64' | 'url' | 'file-id')[]
  readonly mediaTypeField?: string
}

/** tool:web-search 与 tool:read-url 共用的形状 */
export interface ToolCapability {
  readonly id: 'tool:web-search' | 'tool:read-url'
  readonly kind: 'server-tool' | 'request-tools'
  readonly names: readonly string[]
  readonly requestField?: string
}

/** 能力对象联合;未知 id 由校验器拒绝,读取方按不支持处理 */
export type SourceCapability =
  | TextGenerateCapability
  | PromptSystemCapability
  | ReasoningThinkCapability
  | ContentCapability
  | ToolCapability

/** 来源描述文件:声明单个模型来源的端点、鉴权、能力与参数映射 */
export interface SourceDescriptor {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: LocalizedText
  readonly format: SourceDialect
  readonly endpoints: SourceEndpoints
  readonly credential: SourceCredential
  readonly capabilities: readonly SourceCapability[]
}

/* ---------- 内置端点 ---------- */

/**
 * DeepSeek 的 Anthropic 形态端点。
 *
 * 方言取 anthropic-compatible 而不是 deepseek-compatible,理由见
 * docs/design/provider-sources.md 第二节:引擎执行层本版只实现
 * anthropic-messages 一条流式线路,且 DeepSeek 官方 Anthropic 兼容端点
 * 是宿主既有发送路径已经验证的形态;deepseek-compatible(OpenAI 形态)
 * 保留在 schemas/examples/deepseek.descriptor.json 作为方言示例。
 *
 * 鉴权用 x-api-key(该端点同时接受 Authorization: Bearer,取引擎既有路径
 * 的写法);对话路径 /anthropic/v1/messages;模型列表沿用 OpenAI 形态的
 * GET /models。该端点不要求 anthropic-version 固定头,因此不写 headers。
 */
export const DEEPSEEK_ANTHROPIC_SOURCE: SourceDescriptor = {
  schemaVersion: 1,
  id: 'deepseek-anthropic',
  name: {
    'zh-CN': 'DeepSeek 官方(Anthropic 形态)',
    'en-US': 'DeepSeek official (Anthropic-compatible)',
  },
  format: 'anthropic-compatible',
  endpoints: {
    base: 'https://api.deepseek.com',
    chat: { path: '/anthropic/v1/messages' },
    models: { path: '/models' },
  },
  credential: {
    kind: 'api-key',
    headers: [{ name: 'x-api-key' }],
  },
  capabilities: [
    {
      id: 'text:generate',
      stream: 'sse-anthropic',
      params: {
        maxTokens: 'max_tokens',
        temperature: 'temperature',
        topP: 'top_p',
        stop: 'stop_sequences',
      },
      limits: {
        maxTokens: { min: 1, max: 393216 },
        temperature: { min: 0, max: 2, default: 1 },
      },
    },
    { id: 'prompt:system', mode: 'top-level-field', field: 'system' },
    {
      id: 'reasoning:think',
      style: 'type-toggle',
      field: 'thinking',
      onValue: 'enabled',
      offValue: 'disabled',
    },
  ],
}

/** OpenAI 官方预设,Anthropic 兼容形态之外的另一种标准端点 */
export const OPENAI_SOURCE: SourceDescriptor = {
  schemaVersion: 1,
  id: 'openai',
  name: {
    'zh-CN': 'OpenAI 官方',
    'en-US': 'OpenAI official',
  },
  format: 'openai-compatible',
  endpoints: {
    base: 'https://api.openai.com/v1',
    chat: { path: '/chat/completions' },
    models: { path: '/models' },
  },
  credential: {
    kind: 'api-key',
    headers: [{ name: 'Authorization', prefix: 'Bearer ' }],
  },
  capabilities: [
    {
      id: 'text:generate',
      stream: 'sse-openai',
      params: {
        maxTokens: 'max_completion_tokens',
        temperature: 'temperature',
        topP: 'top_p',
        stop: 'stop',
      },
      limits: {
        temperature: { min: 0, max: 2, default: 1 },
        topP: { min: 0, max: 1, default: 1 },
      },
    },
    { id: 'prompt:system', mode: 'message-role', role: 'system' },
    {
      id: 'reasoning:think',
      style: 'effort-level',
      field: 'reasoning_effort',
      levels: ['minimal', 'low', 'medium', 'high'],
      defaultLevel: 'medium',
    },
    { id: 'vision:image', contentType: 'image_url', inputs: ['url', 'base64'] },
    { id: 'tool:web-search', kind: 'request-tools', requestField: 'tools', names: ['web_search'] },
  ],
}

/** Anthropic 官方预设 */
export const ANTHROPIC_SOURCE: SourceDescriptor = {
  schemaVersion: 1,
  id: 'anthropic',
  name: {
    'zh-CN': 'Anthropic 官方',
    'en-US': 'Anthropic official',
  },
  format: 'anthropic-compatible',
  endpoints: {
    base: 'https://api.anthropic.com',
    chat: {
      path: '/v1/messages',
      headers: [{ name: 'anthropic-version', value: '2023-06-01' }],
    },
    models: {
      path: '/v1/models',
      headers: [{ name: 'anthropic-version', value: '2023-06-01' }],
    },
    files: {
      path: '/v1/files',
      headers: [
        { name: 'anthropic-version', value: '2023-06-01' },
        { name: 'anthropic-beta', value: 'files-api-2025-04-14' },
      ],
    },
  },
  credential: {
    kind: 'api-key',
    headers: [{ name: 'x-api-key' }],
  },
  capabilities: [
    {
      id: 'text:generate',
      stream: 'sse-anthropic',
      params: {
        maxTokens: 'max_tokens',
        temperature: 'temperature',
        topP: 'top_p',
        topK: 'top_k',
        stop: 'stop_sequences',
      },
      requiredParams: ['maxTokens'],
      limits: {
        maxTokens: { min: 1 },
        temperature: { min: 0, max: 1 },
        topP: { min: 0, max: 1 },
      },
    },
    { id: 'prompt:system', mode: 'top-level-field', field: 'system' },
    {
      id: 'reasoning:think',
      style: 'type-toggle',
      field: 'thinking',
      onValue: 'enabled',
      offValue: 'disabled',
      adaptiveValue: 'adaptive',
      budgetField: 'budget_tokens',
      budgetMin: 1024,
      budgetCountsInMaxTokens: true,
    },
    { id: 'vision:image', contentType: 'image', inputs: ['base64', 'url', 'file-id'], mediaTypeField: 'media_type' },
    { id: 'document:read', contentType: 'document', inputs: ['base64', 'file-id'] },
    { id: 'tool:web-search', kind: 'server-tool', requestField: 'tools', names: ['web_search'] },
    { id: 'tool:read-url', kind: 'server-tool', requestField: 'tools', names: ['web_fetch'] },
  ],
}

/**
 * 激活时按顺序注册的内置端点。
 * 顺序即引擎注册表的声明顺序:引擎按「该能力的第一个端点」选择执行端点,
 * deepseek-anthropic 排第一,作为本插件的默认端点。
 * doubao 描述(schemas/examples/doubao.descriptor.json)只作方言示例,不内置注册。
 */
export const BUILTIN_SOURCES: readonly SourceDescriptor[] = [
  DEEPSEEK_ANTHROPIC_SOURCE,
  OPENAI_SOURCE,
  ANTHROPIC_SOURCE,
]

/* ---------- 到引擎描述的转换 ---------- */

/** 方言到引擎协议格式的映射;deepseek-compatible 走 openai-chat */
const DIALECT_TO_ENGINE_FORMAT: Record<SourceDialect, EngineSourceFormat> = {
  'anthropic-compatible': 'anthropic-messages',
  'openai-compatible': 'openai-chat',
  'deepseek-compatible': 'openai-chat',
}

/**
 * 把来源描述转换成引擎的 CoreSourceDescriptor。
 *
 * 映射规则:
 * - format 按方言表转换;
 * - baseUrl 取 endpoints.base,端点路径转成能力键的覆盖(text.generate 与 models.list);
 * - capabilities 里 text:generate 转 text.generate;描述的 endpoints.models 必填,
 *   因此 models.list 一并声明,引擎的模型列表按该端点执行;
 * - 其余能力(reasoning:think、vision:image 等)在引擎侧尚无执行分支,不进引擎清单;
 * - 展示名优先 zh-CN,缺失用 en-US,再缺失用 id。
 */
export const toEngineDescriptor = (descriptor: SourceDescriptor): EngineSourceDescriptor => ({
  id: descriptor.id,
  label: descriptor.name['zh-CN'] ?? descriptor.name['en-US'] ?? descriptor.id,
  format: DIALECT_TO_ENGINE_FORMAT[descriptor.format],
  baseUrl: descriptor.endpoints.base,
  capabilities: ['text.generate', 'models.list'],
  endpoints: {
    'text.generate': descriptor.endpoints.chat.path,
    'models.list': descriptor.endpoints.models.path,
  },
})
