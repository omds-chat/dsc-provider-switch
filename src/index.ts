import { manifest } from './manifest.js'
import { registerBuiltinSources } from './sources/register.js'
import { registerCustomSources, registerSettingsSurface } from './sources/settings.js'
import type { PluginContext } from './types.js'

export { manifest }
export * from './sources/descriptor.js'
export * from './sources/validate.js'
export * from './sources/run.js'
export * from './sources/register.js'
export * from './sources/settings.js'
export type { PluginContext, PluginManifest, ProviderRunResult, TextGeneratePayload } from './types.js'

/** 是否已激活;重复激活直接跳过,与引擎的生命周期语义一致 */
let active = false

/**
 * 启动入口,引擎在激活时调用,超时 5 秒。
 * 注册分两层:先按内置顺序登记三份内置端点描述,再登记设置表面,
 * 并按设置值注册自定义端点(baseUrl 留空即不注册)。
 * 声明不发起任何网络请求,也不代表宿主立刻使用这条来源;启停开关、
 * API Key 与自定义基址都由用户在宿主设置页填写,插件只读生效值。
 * 设置值没有变更推送:两条封装在每次 run 前重新读一遍 settings.values(),
 * 启停过滤不依赖激活时读到的快照。
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
  registerSettingsSurface(context)
  registerCustomSources(context)
}

/**
 * 停用入口,引擎在停用与卸载时调用,超时 3 秒。
 * registerSource 的登记由引擎的注册表持有,停用不清空声明;
 * 设置描述的登记随引擎的 disposer 集合撤销,本插件不复位它。
 * 自定义端点按激活时的设置值注册过一次,设置页改动后的重新注册时机
 * 待宿主提供重新激活或声明刷新途径,缺口记在设计文档第六节。
 */
export const deactivate = (): void => {
  active = false
}
