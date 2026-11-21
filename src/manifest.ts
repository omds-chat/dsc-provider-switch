import type { PluginManifest } from './types.js'

/**
 * 插件清单,从地址安装时由产物自带的 manifest 提供。
 *
 * capabilities 只申请供应端点两条:provider:source 登记内置端点描述,
 * provider:run 在自己的封装里发起执行。两条分开授权,因为声明只交描述,
 * 执行会花用户填的 Key 与端点额度,授权单位不该相同。
 *
 * 不申请 chat:request,也不声明挂载点:本插件不改写宿主的任何一次请求,
 * registerSource 是能力对象上的方法,不属于任何挂载点。
 *
 * 引擎能力表已含 provider:run;上游清单 Schema 的枚举尚未收录,差异记在
 * specs/README.md 的「已知差异」表。
 */
export const manifest: PluginManifest = {
  id: 'dsc-provider-switch',
  name: 'Provider Switch',
  version: '0.1.0',
  engines: '^1.0.0',
  capabilities: ['provider:source', 'provider:run'],
}
