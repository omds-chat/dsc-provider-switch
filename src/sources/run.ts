/**
 * context.provider.run 的两条封装:text.generate 的组装与执行、models.list 的执行。
 *
 * 组装是纯函数:把与协议无关的请求对照描述的 text:generate 声明逐项校验,
 * 产出引擎载荷;执行把载荷交给 context.provider.run,引擎选端点、读凭证、
 * 调内核,插件拿不到端点描述里的凭证与请求对象。
 * 执行前按设置过滤停用端点:每次 run 前读一遍 settings.values() 推导启停
 * (宿主没有变更推送),目标端点被停用时按 endpoint-disabled 拒绝,不发 run、不花额度。
 * 密钥的存在性不参与插件侧判定:secret 字段在 values() 里完全不出现,
 * 无 Key 的端点由引擎在执行时抛 credential-missing,本层原样上抛。
 * 引擎错误(PluginCapabilityError、PluginRateLimitError、PluginProviderRunError)原样抛出,
 * 本层不吞、不重试、不降级。
 */

import { BUILTIN_SOURCES, type SourceDescriptor } from './descriptor.js'
import { readEndpointState } from './settings.js'
import { findReasoningThinkCapability, findTextGenerateCapability, findToolCapability } from './validate.js'
import type {
  PluginContext,
  ProviderRunResult,
  SourceMessage,
  TextGeneratePayload,
} from '../types.js'

/** 组装失败的分类码 */
export type AssemblyErrorCode =
  | 'invalid-request'
  | 'param-unsupported'
  | 'param-out-of-range'
  | 'param-required-missing'
  | 'capability-unsupported'
  | 'endpoint-disabled'

/** 组装失败;code 供调用方判定,message 面向日志 */
export class SourceAssemblyError extends Error {
  readonly code: AssemblyErrorCode

  constructor(code: AssemblyErrorCode, message: string) {
    super('dsc-provider-switch: ' + code + ': ' + message)
    this.name = 'SourceAssemblyError'
    this.code = code
  }
}

/** 文本生成请求;params 的四个键即引擎载荷支持的四个逻辑参数,描述未声明则拒绝 */
export interface TextGenerateRequest {
  readonly model: string
  /** 系统提示词;缺省为空串,落位由内核按描述的 prompt:system 声明决定 */
  readonly system?: string
  readonly messages: readonly SourceMessage[]
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
  /** 是否请求思考过程;描述未声明 reasoning:think 时拒绝 */
  readonly thinking?: boolean
  /** 是否声明联网搜索;描述未声明 tool:web-search 时拒绝 */
  readonly search?: boolean
  /** 是否请求服务端生成标题;标题生成是引擎侧行为,描述无对应能力,恒放行 */
  readonly title?: boolean
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 按描述的 limits 校验一个数值参数;越界拒绝,不裁剪 */
const checkLimit = (
  descriptor: SourceDescriptor,
  key: 'temperature' | 'topP' | 'maxTokens',
  value: number,
  errors: SourceAssemblyError[],
): void => {
  const text = findTextGenerateCapability(descriptor)
  const limits = text?.limits
  const range = limits?.[key]
  if (range === undefined) {
    return
  }
  if (value < range.min || (range.max !== undefined && value > range.max)) {
    const bound = range.max === undefined ? '>=' + String(range.min) : '[' + String(range.min) + ', ' + String(range.max) + ']'
    errors.push(new SourceAssemblyError('param-out-of-range', key + ' 超出描述声明的范围 ' + bound))
  }
}

/**
 * 把请求对照描述组装成引擎载荷。
 *
 * 校验规则:
 * - model 必须是非空字符串;messages 必须是数组;
 * - 四个参数键必须在描述的 params 里声明(未声明的键表示来源不支持),给了就按 limits 校验;
 * - requiredParams 列出的键必须全部给出(例如 Anthropic 形态的 maxTokens);
 * - thinking 须有 reasoning:think,search 须有 tool:web-search,否则按 capability-unsupported 拒绝;
 * - system 缺省为空串;描述未声明 prompt:system 时按 cross-field 规则本就不该过校验,这里不再重复。
 */
export const assembleTextGeneratePayload = (
  descriptor: SourceDescriptor,
  request: TextGenerateRequest,
): TextGeneratePayload => {
  const errors: SourceAssemblyError[] = []

  if (!isNonEmpty(request.model)) {
    errors.push(new SourceAssemblyError('invalid-request', 'model 必须是非空字符串'))
  }
  if (!Array.isArray(request.messages)) {
    errors.push(new SourceAssemblyError('invalid-request', 'messages 必须是数组'))
  }

  const text = findTextGenerateCapability(descriptor)
  if (text === undefined) {
    errors.push(new SourceAssemblyError('capability-unsupported', '描述未声明 text:generate'))
  }

  const paramChecks: { key: 'temperature' | 'topP' | 'maxTokens'; value: number | undefined }[] = [
    { key: 'temperature', value: request.temperature },
    { key: 'topP', value: request.topP },
    { key: 'maxTokens', value: request.maxTokens },
  ]
  if (text !== undefined) {
    for (const { key, value } of paramChecks) {
      if (value === undefined) {
        continue
      }
      if (!isFiniteNumber(value)) {
        errors.push(new SourceAssemblyError('invalid-request', key + ' 必须是有限数字'))
        continue
      }
      if (text.params?.[key] === undefined) {
        errors.push(new SourceAssemblyError('param-unsupported', '描述未声明参数 ' + key))
        continue
      }
      checkLimit(descriptor, key, value, errors)
    }
    if (request.stop !== undefined) {
      if (text.params?.['stop'] === undefined) {
        errors.push(new SourceAssemblyError('param-unsupported', '描述未声明参数 stop'))
      } else {
        for (const item of request.stop) {
          if (typeof item !== 'string' || item === '') {
            errors.push(new SourceAssemblyError('invalid-request', 'stop 的每一项必须是非空字符串'))
            break
          }
        }
      }
    }
    for (const required of text.requiredParams ?? []) {
      const provided =
        required === 'temperature'
          ? request.temperature !== undefined
          : required === 'topP'
            ? request.topP !== undefined
            : required === 'maxTokens'
              ? request.maxTokens !== undefined
              : required === 'stop'
                ? request.stop !== undefined
                : false
      if (!provided) {
        errors.push(new SourceAssemblyError('param-required-missing', '描述的 requiredParams 要求提供 ' + required))
      }
    }
    if (request.thinking === true && findReasoningThinkCapability(descriptor) === undefined) {
      errors.push(new SourceAssemblyError('capability-unsupported', '描述未声明 reasoning:think,不能请求思考过程'))
    }
    if (request.search === true && findToolCapability(descriptor, 'tool:web-search') === undefined) {
      errors.push(new SourceAssemblyError('capability-unsupported', '描述未声明 tool:web-search,不能声明联网搜索'))
    }
  }

  const first = errors[0]
  if (first !== undefined) {
    throw first
  }

  return {
    model: request.model,
    system: request.system ?? '',
    messages: [...request.messages],
    ...(request.thinking !== undefined ? { thinking: request.thinking } : {}),
    ...(request.search !== undefined ? { search: request.search } : {}),
    ...(request.title !== undefined ? { title: request.title } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.topP !== undefined ? { topP: request.topP } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    ...(request.stop !== undefined ? { stop: [...request.stop] } : {}),
  }
}

const isNonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * 按设置解析本次执行的目标描述。
 *
 * - 显式传入的描述照旧作为校验口径:若它是内置端点且被设置停用,
 *   按 endpoint-disabled 拒绝,不悄悄换端点(调用方的显式意图不覆盖停用开关);
 *   显式传自定义端点或第三方描述不查开关,按原样放行。
 * - 未传入时按「启用的内置端点(优先级顺序)+ 自定义端点」取第一个:
 *   自定义端点没有独立开关,注册即视为启用,排在全部内置端点之后。
 * - 全部停用(内置全关且没有可用的自定义端点)按 endpoint-disabled 拒绝。
 *
 * 目标描述只决定本插件的校验口径与启停门槛;引擎仍按注册表自行选端点,
 * 插件不能指定执行端点,见设计文档第六节的端点选择缺口。
 */
export const resolveTargetDescriptor = (
  context: PluginContext,
  preferred?: SourceDescriptor,
): SourceDescriptor => {
  const state = readEndpointState(context)
  if (preferred !== undefined) {
    const isBuiltin = BUILTIN_SOURCES.some((builtin) => builtin.id === preferred.id)
    if (isBuiltin && !state.enabledBuiltinIds.includes(preferred.id)) {
      throw new SourceAssemblyError('endpoint-disabled', '端点 ' + preferred.id + ' 已被设置停用')
    }
    return preferred
  }
  const candidates = [
    ...BUILTIN_SOURCES.filter((descriptor) => state.enabledBuiltinIds.includes(descriptor.id)),
    ...state.customSources,
  ]
  const first = candidates[0]
  if (first === undefined) {
    throw new SourceAssemblyError('endpoint-disabled', '全部端点已被设置停用,无法执行')
  }
  return first
}

/**
 * 按描述执行一次文本生成。
 *
 * descriptor 缺省按 resolveTargetDescriptor 选:设置全默认时取 deepseek-anthropic
 * (本插件按内置顺序先注册它,校验口径与引擎「该能力的第一个端点」的预期选择一致);
 * 停用或启用了别的端点时取第一个启用的端点,limits 校验以该端点的描述为准。
 * 引擎错误原样抛出:凭证缺失(credential-missing)、限流、协议错误由调用方按 error.code 处理。
 */
export const runTextGenerate = async (
  context: PluginContext,
  request: TextGenerateRequest,
  descriptor?: SourceDescriptor,
): Promise<ProviderRunResult> => {
  const target = resolveTargetDescriptor(context, descriptor)
  const payload = assembleTextGeneratePayload(target, request)
  return context.provider.run('text.generate', payload)
}

/**
 * 按当前选中的端点取一次模型清单。
 *
 * 载荷没有可选参数;结果只保留模型 id,其余字段不进本层。
 * descriptor 缺省按 resolveTargetDescriptor 做一次启停门槛判定:
 * 目标端点全部停用或显式传入的端点已停用时拒绝,不发 run;
 * 引擎在执行期仍按注册表自行选端点,插件不能指定。
 * 引擎错误原样抛出。
 */
export const runModelsList = async (
  context: PluginContext,
  descriptor?: SourceDescriptor,
): Promise<readonly string[]> => {
  resolveTargetDescriptor(context, descriptor)
  const result = await context.provider.run('models.list', {})
  if (result.kind !== 'models') {
    throw new SourceAssemblyError('invalid-request', 'models.list 返回了非模型清单结果')
  }
  return result.models.map((model) => model.id)
}
