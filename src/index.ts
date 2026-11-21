import { manifest } from './manifest.js'
import { registerBuiltinSources } from './sources/register.js'
import type { PluginContext } from './types.js'

export { manifest }
export * from './sources/descriptor.js'
export * from './sources/validate.js'
export * from './sources/run.js'
export * from './sources/register.js'
export type { PluginContext, PluginManifest, ProviderRunResult, TextGeneratePayload } from './types.js'

/** 是否已激活;重复激活直接跳过,与引擎的生命周期语义一致 */
let active = false

/**
 * 启动入口,引擎在激活时调用,超时 5 秒。
 * 激活做的事只有一件:把内置端点描述登记给宿主。声明不发起任何网络请求,
 * 也不代表宿主立刻使用这条来源;端点是否启用、凭证怎么填,由宿主决定。
 */
export const activate = (context: PluginContext): void => {
  if (active) {
    context.log(manifest.id + ': already active, skip activate')
    return
  }
  active = true
  context.log(
    manifest.id + ': activated, capabilities ' + manifest.capabilities.join(', ') + ', mounts none',
  )
  registerBuiltinSources(context)
}

/**
 * 停用入口,引擎在停用与卸载时调用,超时 3 秒。
 * registerSource 的登记由引擎的注册表持有,停用不清空声明;
 * 本插件没有登记任何需要释放的句柄,只复位自身状态。
 */
export const deactivate = (): void => {
  active = false
}
