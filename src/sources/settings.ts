/**
 * 设置表面:字段描述的登记与启停、自定义端点设置值的读取。
 *
 * settings:surface 的写侧在宿主:插件只交一份字段描述(context.settings.register),
 * 用户在宿主设置页(已安装插件 → 点插件名 → 表单)填写;插件读侧只有
 * context.settings.values() 的只读快照,secret 字段不返回任何值——连「是否已配置」
 * 也看不到,所以密钥的存在性不参与插件侧判定,无 Key 的端点由引擎在执行时
 * 抛 PluginProviderRunError 的 credential-missing,两条封装原样上抛。
 * 宿主本轮没有变更推送能力:插件在每次 run 前重新读一遍 values(),
 * 不依赖变更回调,也不自行缓存启停状态。
 */

import {
  ANTHROPIC_SOURCE,
  BUILTIN_SOURCES,
  CUSTOM_ANTHROPIC_SOURCE,
  CUSTOM_OPENAI_SOURCE,
  DEEPSEEK_ANTHROPIC_SOURCE,
  OPENAI_SOURCE,
  toEngineDescriptor,
  type SourceDescriptor,
} from './descriptor.js'
import { validateSourceDescriptor } from './validate.js'
import type { PluginContext, SettingDescriptor, SettingFieldDescriptor, SettingValue } from '../types.js'

/** 内置端点的启用开关字段键:<端点 id>-enabled */
export const enabledFieldKey = (id: string): string => id + '-enabled'

/** 内置端点的密钥字段键:<端点 id>-api-key;secret 字段,值只写不读 */
export const apiKeyFieldKey = (id: string): string => id + '-api-key'

/** 自定义 OpenAI 兼容端点的 baseUrl 字段键;留空即不注册该端点 */
export const CUSTOM_OPENAI_URL_FIELD_KEY = 'custom-openai-base-url'

/** 自定义 Anthropic 兼容端点的 baseUrl 字段键;留空即不注册该端点 */
export const CUSTOM_ANTHROPIC_URL_FIELD_KEY = 'custom-anthropic-base-url'

const switchField = (descriptor: SourceDescriptor): SettingFieldDescriptor => ({
  key: enabledFieldKey(descriptor.id),
  type: 'switch',
  label: '启用 ' + (descriptor.name['zh-CN'] ?? descriptor.id),
  default: true,
})

const secretField = (id: string, label: string): SettingFieldDescriptor => ({
  key: apiKeyFieldKey(id),
  type: 'secret',
  label,
})

const textBaseUrlField = (key: string, label: string): SettingFieldDescriptor => ({
  key,
  type: 'text',
  label,
  default: '',
  maxLength: 200,
})

/**
 * 设置表面描述,激活期登记给宿主渲染表单。
 * 每个内置端点一个启用开关(默认启用)与一个 API Key 输入(无默认值,
 * 引擎只在执行时读);两个自定义端点各一个可选 baseUrl 文本输入,
 * 留空即不注册。8 个字段,远离引擎的 32 字段与 8 KB 上限。
 */
export const SETTING_DESCRIPTOR: SettingDescriptor = {
  fields: [
    switchField(DEEPSEEK_ANTHROPIC_SOURCE),
    secretField('deepseek-anthropic', 'DeepSeek API Key(Anthropic 形态)'),
    switchField(OPENAI_SOURCE),
    secretField('openai', 'OpenAI API Key'),
    switchField(ANTHROPIC_SOURCE),
    secretField('anthropic', 'Anthropic API Key'),
    textBaseUrlField(
      CUSTOM_OPENAI_URL_FIELD_KEY,
      '自定义 OpenAI 兼容端点 baseUrl(留空不注册)',
    ),
    textBaseUrlField(
      CUSTOM_ANTHROPIC_URL_FIELD_KEY,
      '自定义 Anthropic 兼容端点 baseUrl(留空不注册)',
    ),
  ],
}

/**
 * 登记设置表面描述。描述是写死的内置数据,引擎整份拒绝(如 PluginSettingsError)
 * 时只写日志继续:设置表面挂不上不应拖住端点注册,执行侧按默认全启用兜底。
 * 登记返回的释放函数由引擎存进 disposer 集合,停用随引擎清理。
 */
export const registerSettingsSurface = (context: PluginContext): void => {
  try {
    context.settings.register(SETTING_DESCRIPTOR)
    context.log(
      'dsc-provider-switch: 已登记设置表面(' + String(SETTING_DESCRIPTOR.fields.length) + ' 个字段)',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    context.log('dsc-provider-switch: 设置表面登记被引擎拒绝: ' + message)
  }
}

/**
 * 一次执行前的设置快照:启用的内置端点与可用的自定义端点描述。
 * 设置读取失败按未配置处理:内置端点全部按默认启用,自定义端点不推导,
 * 不让设置表面的故障挡住执行主链路。
 */
export interface EndpointRuntimeState {
  /** 启用的内置端点 id,按内置优先级顺序排列 */
  readonly enabledBuiltinIds: readonly string[]
  /** 由设置里的 baseUrl 实例化并通过结构校验的自定义端点描述 */
  readonly customSources: readonly SourceDescriptor[]
}

/** 基址的插件侧预处理:去首尾空白与尾部斜杠;其余形态交给描述校验器判 */
const normalizeBaseUrl = (raw: string): string => raw.trim().replace(/\/+$/, '')

/** 用设置里的 baseUrl 实例化一个自定义端点描述;模板其余字段原样保留 */
export const withCustomBaseUrl = (template: SourceDescriptor, baseUrl: string): SourceDescriptor => {
  const clone = structuredClone(template)
  return { ...clone, endpoints: { ...clone.endpoints, base: baseUrl } }
}

/** 自定义端点字段与模板的对应关系;顺序即缺省选择时的先后 */
const CUSTOM_SOURCE_FIELDS: readonly (readonly [string, SourceDescriptor])[] = [
  [CUSTOM_OPENAI_URL_FIELD_KEY, CUSTOM_OPENAI_SOURCE],
  [CUSTOM_ANTHROPIC_URL_FIELD_KEY, CUSTOM_ANTHROPIC_SOURCE],
]

/**
 * 读一次设置,推导启停与自定义端点。
 * 开关字段取值 !== false 即启用(缺省、类型异常都按默认启用);
 * 自定义 baseUrl 去空白后为空即跳过;实例化后的描述过一遍结构校验,
 * 校验不过(非法基址等)不注册,不写日志——每次 run 都会读一遍,
 * 静默跳过避免刷日志,表单校验由宿主按 maxLength 承担。
 */
export const readEndpointState = (context: PluginContext): EndpointRuntimeState => {
  let values: Record<string, SettingValue> = {}
  try {
    values = context.settings.values()
  } catch {
    values = {}
  }
  const enabledBuiltinIds = BUILTIN_SOURCES.filter(
    (descriptor) => values[enabledFieldKey(descriptor.id)] !== false,
  ).map((descriptor) => descriptor.id)
  const customSources: SourceDescriptor[] = []
  for (const [fieldKey, template] of CUSTOM_SOURCE_FIELDS) {
    const raw = values[fieldKey]
    if (typeof raw !== 'string') {
      continue
    }
    const baseUrl = normalizeBaseUrl(raw)
    if (baseUrl === '') {
      continue
    }
    const source = withCustomBaseUrl(template, baseUrl)
    if (!validateSourceDescriptor(source).ok) {
      continue
    }
    customSources.push(source)
  }
  return { enabledBuiltinIds, customSources }
}

/**
 * 按激活时的设置值注册自定义端点(baseUrl 留空或非法即不注册)。
 * 引擎对同 id 冲突的合并口径在引擎侧,单条被拒只写日志并继续。
 * 这是激活期的一次性登记:设置页改动后的重新注册时机待宿主提供途径,
 * 记在设计文档第六节;两条封装在每次 run 前重新推导描述,不受此限制。
 */
export const registerCustomSources = (context: PluginContext): readonly string[] => {
  const registered: string[] = []
  for (const source of readEndpointState(context).customSources) {
    try {
      context.provider.registerSource(toEngineDescriptor(source))
      registered.push(source.id)
      context.log('dsc-provider-switch: 已注册自定义端点 ' + source.id + ' (' + source.endpoints.base + ')')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      context.log('dsc-provider-switch: 自定义端点 ' + source.id + ' 注册被引擎拒绝: ' + message)
    }
  }
  return registered
}