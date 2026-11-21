/**
 * 内置端点的注册。
 *
 * 注册前先过一遍运行时结构校验:内置数据是写死的,但校验失败宁可抛错
 * 也不要把一份非法描述交给引擎。逐条注册,单条失败只写日志并继续,
 * 不让一个坏条目拖住其余端点;引擎对同 id 冲突的合并口径在引擎侧,本层不重复。
 */

import { BUILTIN_SOURCES, toEngineDescriptor } from './descriptor.js'
import { validateSourceDescriptor } from './validate.js'
import type { PluginContext } from '../types.js'

/**
 * 把内置描述注册到宿主。
 *
 * 返回注册成功的端点 id,顺序与 BUILTIN_SOURCES 一致;
 * 校验失败抛错(内置数据错了属于仓库缺陷),引擎拒绝(如 PluginSourceError)
 * 只记日志继续,让宿主日志保留原因。
 */
export const registerBuiltinSources = (context: PluginContext): readonly string[] => {
  const registered: string[] = []
  for (const descriptor of BUILTIN_SOURCES) {
    const validation = validateSourceDescriptor(descriptor)
    if (!validation.ok) {
      const detail = validation.issues.map((item) => item.code + ' ' + item.message).join('; ')
      throw new Error('dsc-provider-switch: 内置描述未通过校验: ' + descriptor.id + ': ' + detail)
    }
    try {
      context.provider.registerSource(toEngineDescriptor(descriptor))
      registered.push(descriptor.id)
      context.log('dsc-provider-switch: 已注册端点 ' + descriptor.id + ' (' + descriptor.format + ')')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      context.log('dsc-provider-switch: 端点 ' + descriptor.id + ' 注册被引擎拒绝: ' + message)
    }
  }
  return registered
}
