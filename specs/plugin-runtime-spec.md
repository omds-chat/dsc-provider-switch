# dsc 插件运行时规范

本文件规定插件在宿主中的运行形态:产物如何加载、导出如何识别、生命周期与超时、能力与限流、上下文成员、安全边界与错误降级。

适用版本为 dsc-core 1.0.0,内容按 `dsc-plugin-engine` 的浏览器内实现收拢。实现与本文不一致时以实现为准,已知口径差异见 [规范区说明](README.md)。清单与运行时 meta 的字段规则见 [插件开发规范](plugin-develop-spec.md)。

## 1. 产物形态

| 项 | 规定 |
|:---:|:---:|
| 文件数量 | 单个 js 文件,分发时只交付这一个文件 |
| 模块格式 | 浏览器可直接 `import` 的 ESM;不得使用 `require`、Node 内置模块与打包器专用运行时占位 |
| 编码 | UTF-8 文本,必须能还原成原始字节;不是合法 UTF-8 时,在线安装结果为 `load-failed`,离线包预检结果为 `corrupt-package` |
| 体积上限 | 2 MB(2097152 字节);在线安装与本地离线包共用同一上限,超出按 `package-too-large` 拒绝 |
| 运行位置 | 页面主线程,与宿主同源,引擎不为插件提供独立的执行环境 |
| 可用的浏览器 API | 本地存储 `localStorage`、定时器 `setTimeout`、`indexedDB` 等;联网接口不在此列,插件联网的规则见 5.5 |
| 不可用 | Node 内置模块、后端接口、本地文件系统、宿主 DOM 与插槽 |
| 依赖 | 不得新增运行依赖;第三方依赖内联进产物 |
| 资源 | 样式、字体与图片内联,或在代码里用绝对地址引用;需要主动取数时仍按 5.5 走宿主网络能力 |
| 存放与恢复 | 安装时取回字节,按 UTF-8 文本写入安装记录;加载时以 Blob 地址 `import`;启动恢复只用保存的代码,不访问网络 |

体积上限在宿主里是一个字节常量,提示文案里的 MB 数由该常量派生;调整上限时改常量,并同步本节数字。比对的是产物的原始字节数,与文本字符数无关;在线安装与离线包都在 UTF-8 解码之前先比体积,两者只有一份常量、一套判定。

产物以 Blob 地址加载,模块基址不是托管地址,因此 `import('./chunk.js')` 与 `new URL('./asset.png', import.meta.url)` 在安装后都无法解析,拆分代码与相对路径资源无效。

## 2. 导出契约

产物必须能被识别出插件对象,可以同时导出具名清单:

| 导出形态 | 说明 |
|:---:|:---:|
| `export const activate` | 模块本身即插件对象,`activate` 必填 |
| `export default` 插件对象 | 默认导出对象带 `activate` |
| `export default` 工厂 | 函数,返回插件对象或它的 Promise |
| 模块本身是工厂 | 模块是函数时按工厂调用 |
| `export const manifest` | 具名清单,未显式传入清单时的安装依据 |

清单优先级:调用方显式传入 > 模块顶层具名 `manifest` > `default` 导出对象上的 `manifest`。三者都没有时安装结果为 `invalid-manifest`,并提示 `pluginManifestMissing`。

清单可以缺 `mounts` 与 `slots` 字段:由 `meta.json` 推导的安装清单(市场与离线包)可能没有这两份声明,安装阶段能拿到产物导出的清单时用它补齐;清单已声明该字段(含空数组)时以清单为准,产物多出来的声明不会越过清单。

插件对象只有两个成员:

| 成员 | 必填 | 说明 |
|:---:|:---:|:---:|
| `activate(context)` | 是 | 启动入口,可返回 Promise;返回值被忽略 |
| `deactivate()` | 否 | 停用入口,可返回 Promise;返回值被忽略 |

`activate` 的返回值不会被当作释放函数,释放统一走 `context.events.on` 与各登记型成员返回的函数。产物没有可识别的 `activate` 时,安装结果为 `invalid-plugin`。

## 3. 生命周期与超时

| 状态 | 含义 |
|:---:|:---:|
| `registered` | 已登记,尚未启动 |
| `active` | 已激活,能力可用 |
| `inactive` | 已停用,挂载点与释放函数已撤销 |
| `failed` | 启动失败,原因写入插件日志与错误字段 |

| 操作 | 前置条件 | 超时 | 结果 |
|:---:|:---:|:---:|:---:|
| 安装 | 清单校验通过 | 模块导入 10 秒 | 登记为 `registered`;从地址与离线包安装成功后自动激活,宿主直接注册只登记;地址不合法、导入失败或导出不符为 `load-failed`、`invalid-plugin` |
| `activate` | 依赖插件均已 `active` | 5 秒 | `active`;抛错、超时或依赖未激活不启用(记录标记 `inactive`,错误字段写入 `missing-dependency:<id>`);与运行中的插件冲突时按保守策略处置:停用冲突双方、写入待决定记录并返回 `conflict` |
| `deactivate` | 状态为 `active` 且没有处于 `active` 的依赖方 | 3 秒 | `inactive`;存在已启用的依赖方时拒绝(返回 `depended-on` 与依赖方 id,强行停用标志同样被拒);先调插件 `deactivate`,再执行释放函数并清空挂载点 |
| `unload` | 没有已启用的下游依赖 | — | 移除注册表与安装记录;有下游依赖时拒绝 |

- 同一插件的启停与卸载排队执行;对已 `active` 的插件再调 `activate` 直接返回成功。
- 激活抛错或超时:清空已注册的挂载点、执行释放函数,再标记 `failed`;引擎与其他插件继续运行。
- 停用抛错或超时:错误只写入该插件日志,仍执行释放函数、清空挂载点并置 `inactive`。
- 安装期检出冲突不拒绝安装:判定看两个方向(本插件声明的 `conflicts` 命中已安装记录,或已安装记录声明排斥本插件,两边互相声明合并为双向),处置看对方的启用状态——对方在启用中时新插件保持停用、不发自动启用,冲突写入待决定记录;对方全部停用时仅警告,新插件照常自动启用。启用期检出冲突时把涉及的已启用插件全部停用并写入待决定记录,由用户在插件页选择保留哪一个;两个时机都不留下「都跑着」的状态。登记、启动与记录细节属于引擎内部实现,插件只需知道自己可能在安装后保持停用、等待用户决定。
- 依赖在安装、启用、停用、卸载四处都生效:安装时须已存在,激活时须已 `active`,停用与卸载时不得有已启用的依赖方。插件被停用、卸载或启动失败后,依赖它的已启用插件由引擎自动停用并逐个提示(`pluginDependencyAutoStopped`);不存在「正在运行但依赖不可用」的记录。
- 卸载不清除插件数据,返回值里的 `hasLeftoverData` 供界面提示清理入口。
- 启动恢复逐个插件隔离,单个插件失败只标记 `failed`,不阻塞其他插件与页面渲染。

## 4. 能力与限流

| 能力 | 上下文成员 | 限流 | 单次上限 | 可见范围 |
|:---:|:---:|:---:|:---:|:---:|
| `sessions:list` | `context.sessions.list` | 30 次 / 10 秒 | 3 秒 | 全部插件 |
| `sessions:read` | `context.sessions.read` | 30 次 / 10 秒 | 3 秒 | 全部插件 |
| `sessions:rename` | `context.sessions.rename` | 5 次 / 10 秒 | 同步调用 | 全部插件 |
| `events:session` | `context.events.on` | 5 次 / 10 秒(仅登记) | 同步调用 | 全部插件 |
| `notify` | `context.ui.notify` | 10 次 / 10 秒 | 同步调用 | 全部插件 |
| `settings:locale` | `context.settings.locale` | 60 次 / 10 秒 | 3 秒 | 全部插件 |
| `settings:surface` | `context.settings.register`、`values`、`overrides`、`onChange` | 60 次 / 10 秒(登记与读取) | 3 秒(仅 `overrides`) | 全部插件 |
| `ui:slot` | `context.ui.registerSlot`、`onSlotAction`、`onSlotData` | 20 次 / 10 秒(仅登记) | 同步调用 | 全部插件 |
| `net:fetch` | `context.net.getText` | 10 次 / 10 秒 | 内层 10 秒中止请求,外层 12 秒兜底 | 仅内置插件 |
| `assets:read` | `context.assets.readText`、`readBytes` | 120 次 / 10 秒 | 内层 10 秒中止请求,外层 12 秒兜底 | 全部插件 |
| `assets:download` | `context.assets.download` | 3 次 / 10 秒,窗口内累计总流量 512MB | 不设单次超时 | 仅受信来源插件 |
| `plugins:storage` | `context.storage.get`、`set`、`remove` | 100 次 / 10 秒 | 同步调用 | 全部插件 |
| `chat:request` | `context.chat.onBeforeRequest` | 10 次 / 10 秒(仅登记) | 同步调用,全部处理器共用 10 毫秒预算 | 全部插件 |
| `provider:source` | `context.provider.registerSource` | 50 次 / 10 秒(按声明次数) | 同步调用 | 全部插件 |
| `provider:run` | `context.provider.run` | 10 次 / 10 秒 | 15 秒(只覆盖建立调用) | 全部插件 |

- 限流按插件实例独立计数,每个插件各有一份时间窗,所有能力的窗口统一为 10 秒滑动窗口;`context.events.on` 每调用一次消耗 `events:session` 的一个名额。
- 上表与实现里的策略表一一对应,数值只在那里维护;同步限流时改策略表,再改本节数字。
- 「同步调用」表示该成员同步返回,没有超时(同步调用不适用超时);`events:session`、`chat:request` 与 `ui:slot` 是登记型成员,登记本身同步返回,同样没有超时。
- 登记型成员的限流按「登记次数」计:每次 `context.events.on`、`context.chat.onBeforeRequest`、`context.settings.onChange`,以及每次 `context.ui.registerSlot`、`onSlotAction`、`onSlotData` 各占一个名额;之后的事件回调、请求前调用、设置变更回调、槽位动作回调与页面数据索取都由引擎发起,不再占用名额。`events:session` 的 5 次 / 10 秒约束的是注册次数——同一插件在一次激活内最多登记 5 个事件处理器,窗口滚过之后可以继续登记。
- `provider:source` 的上限按「声明次数」计:每次 `context.provider.registerSource` 占一个名额,一个插件可能声明多条端点;声明集中在激活阶段,超过上限抛 `PluginRateLimitError`,整次激活失败并按失败路径撤销该插件的全部声明。
- `settings:surface` 的登记与读取共用一个窗口:每次 `register` 占一个名额,`values`、`overrides` 的读取与 `onChange` 的登记同样计数;3 秒超时只落在异步成员 `overrides` 上。
- `assets:download` 与 `assets:read` 分开计数:大体积传输次数少而流量大,传输次数与总流量分别计;大体积传输不设单次超时,进度与取消由宿主界面承担。
- `provider:run` 的超时只兜住「建立调用」这一段:`text.generate` 的回流事件在调用返回后惰性产出,占的是调用方的迭代时间,不占这个预算;要中断就在 `options.signal` 上取消。

申请条件与不可申请的标识:

- `net:fetch` 对第三方插件不可见:引擎维护内置插件 id 集合,集合外的清单申请它时,安装结果与申请不存在的能力完全一致,都是 `unknown-capability`;调用层会再校验一次,防止绕过安装校验直接拿到 `context.net`。
- `assets:download` 仅受信来源插件可申请:来源为内部插件合集(`inner`)或社区插件合集(`awesome`),且本地来源结论为「已确认」(`confirmed`);安装期授予,调用期复核一次,不满足按 `unknown-capability` 拒绝,与能力不存在不可区分。宿主直接注册、本地安装与自建来源的插件不在该层级内,内容与已收录版本相同也不因此获得资格。申请该能力的清单必须同时声明 `assets` 块(逐条含 `id`、`url`、`sha512`、`bytes`、`version`),缺块、空块、块出现在未申请该能力的清单或字段不合格都按 `invalid-manifest` 拒绝,见 5.7。
- `chat:request` 须同时声明挂载点 `chat:before-request`,缺任一项登记时抛 `PluginCapabilityError`,见 5.8。
- `ui:slot` 须同时在清单 `slots` 白名单声明要登记的槽位(槽位名取自槽位枚举,不得重复,枚举之外按 `unknown-slot` 拒绝安装),未写入白名单的槽位登记时按未授权拒绝,见 5.10。
- `provider:source` 管「能不能声明」,`provider:run` 管「能不能执行」,两者互相独立、都须在清单里申请,见 5.11。
- 四个能力标识只由引擎与内核使用,插件清单不能申请,申请时按 `unknown-capability` 拒绝,也不会出现在上下文里:
  - `net:fetch-post`:`context.net.postJson` 背后的独立标识,自己有 10 次 / 10 秒的窗口,内层 5 秒中止请求、外层 7 秒兜底,复用 `net:fetch` 的授予口径,避免计数请求挤占读取预算。
  - `plugins:data-clear`:卸载清理专用,插件不可达。
  - `chat:request-source`:引擎启动时向内核登记一次「请求前补丁来源」用,插件不可达。
  - `source:run`:按端点执行由内核分派时使用,插件不可达;插件侧要发起这类执行时走 `provider:run`。

## 5. 上下文成员

| 成员 | 值 | 说明 |
|:---:|:---:|:---:|
| `context.id` | 插件 id | 与清单一致,只读 |
| `context.version` | 插件版本 | 与清单一致,只读 |
| `context.log(message)` | 无返回 | 写入该插件日志,上限 100 条,不写浏览器控制台 |
| `context.sessions.list(options?)` | `Promise<SessionSummary[]>` | 会话摘要只读视图 |
| `context.sessions.read(id, options?)` | `Promise<SessionView \| null>` | 会话内容只读视图,不存在时为 `null` |
| `context.sessions.rename(id, title)` | `boolean` | 同步调用 |
| `context.events.on(point, handler)` | 释放函数 | 订阅挂载点,释放函数由引擎执行 |
| `context.ui.notify(key, params?)` | 无返回 | 宿主提示,key 取自宿主 i18n 既有文案键 |
| `context.ui.registerSlot(slot, descriptor)` | 句柄 | 登记 UI 槽位描述,见 5.10 |
| `context.ui.onSlotAction(slot, handler)` | 释放函数 | 登记槽位动作回调,见 5.10 |
| `context.ui.onSlotData(slot, handler)` | 释放函数 | 登记槽位页面数据处理器,见 5.10 |
| `context.settings.locale(options?)` | `Promise<'zh-CN' \| 'en-US'>` | 当前语言 |
| `context.settings.register(descriptor)` | 释放函数 | 登记 `settings:surface` 字段描述,见 5.9 |
| `context.settings.values()` | `Record<string, SettingValue>` | 只读自身设置生效值,见 5.9 |
| `context.settings.overrides()` | `Promise<Record<string, SettingOverride>>` | 只读自身覆盖状态,见 5.9 |
| `context.settings.onChange(handler)` | 释放函数 | 订阅设置变更,见 5.9 |
| `context.storage.get(key)` | `unknown` | 缺失的键返回 `null` |
| `context.storage.set(key, value)` | 无返回 | 值须可 JSON 序列化 |
| `context.storage.remove(key)` | 无返回 | 键不存在时不报错 |
| `context.net.getText(url, options?)` | `Promise<{ url, contentType, text }>` | 仅内置插件 |
| `context.net.postJson(url, body, options?)` | `Promise<{ url, status }>` | 仅内置插件 |
| `context.assets.readText(url, options?)` | `Promise<AssetTextResult>` | 远端资产三态读取,见 5.7 |
| `context.assets.readBytes(url, options?)` | `Promise<AssetBytesResult>` | 远端资产三态读取,见 5.7 |
| `context.assets.download(assetId, options?)` | `Promise<Uint8Array>` | 引擎代取大体积资产,仅受信来源插件,见 5.7 |
| `context.chat.onBeforeRequest(handler)` | 释放函数 | 登记请求前补丁处理器,见 5.8 |
| `context.provider.registerSource(descriptor)` | 无返回 | 声明供应端点,只登记、不执行,见 5.11 |
| `context.provider.run(capability, payload, options?)` | `Promise<ProviderRunResult>` | 按端点执行一次能力调用,见 5.11 |

`options` 为 `{ signal?: AbortSignal }`,用于取消异步调用;取消抛 `PluginAbortError`。异步能力单次超时见 4 的「单次上限」列,超时抛 `PluginTimeoutError`;`net:fetch` 的内层 10 秒中止与 `postJson` 的 5 秒中止见 5.5 节。

### 5.1 可见数据范围

| 数据 | 可见字段 |
|:---:|:---:|
| 会话摘要 | `id`、`title`、`createdAt`、`updatedAt` |
| 会话内容 | 摘要字段与 `messages`;消息含 `id`、`role`、`createdAt`、`text`、`attachments`,附件含 `name`、`size`、`isImage` |
| 事件 | `session:changed` 与当前会话 `activeId` |
| 设置 | 当前语言;本插件登记的字段描述、自身生效值与覆盖状态(其他插件的设置不可见;secret 字段不返回值,只回答是否已配置) |
| 插件数据 | 该插件自己写入的键值,读写按插件 id 隔离 |
| 请求前切片 | 当前请求里最后一条用户消息的文本;不给整段会话 |

不可见:API Key、附件的本地 id 与服务端 file_id、附件原件、请求快照、分支内部结构、其他插件的本地数据、其他插件的设置、请求 Cookie。

### 5.2 事件与挂载点

- 只有清单声明了 `session:changed` 才能调用 `context.events.on('session:changed', handler)`,否则抛 `PluginCapabilityError`。
- `on` 返回释放函数;引擎在停用、卸载与激活失败时自动执行,插件不要重复调用。
- 处理器逐个插件、逐个隔离:同步抛错与异步拒绝都只写入该插件日志,不影响其他处理器。
- 挂载点表当前为 `session:changed` 与 `chat:before-request`,后者服务请求前补丁(见 5.8),需同时申请能力 `chat:request`。引擎的挂载点枚举另含 `ui:slot-action` 与 `ui:slot-data`,它们是旧版「按挂载点声明槽位处理器」的残留:槽位处理器的授权已改由清单 `slots` 白名单逐槽位判定(见 5.10),声明这两个挂载点不产生任何授权效果。

### 5.3 提示与设置

- `notify` 的 `key` 取自宿主 i18n 的既有键,插件不拼接文案,也不硬编码中英文句子。
- `locale` 返回当前语言,用于插件内部选择分支。
- 设置表面的登记、读值、覆盖状态与变更订阅见 5.9。

### 5.4 插件数据

| 项 | 规定 |
|:---:|:---:|
| 存储位置 | 浏览器 localStorage,键为 `<APP_NAME>:plugin-data:<插件 id>` |
| 单插件总量 | 上限 64KB(65536 字节),超出抛 `PluginDataError`,原因为 `quota` |
| 计量口径 | 按该插件全部键值序列化后的 UTF-8 字节数计算,不按单个键的大小计算 |
| 键名 | 指插件数据对象里的键,不是 localStorage 的键:非空字符串,去空白后不得为空,长度不超过 64(按字符数计) |
| 值 | 必须可 JSON 序列化;含函数、`undefined`、循环引用时抛 `PluginDataError`,原因为 `serialize` |
| 浏览器配额 | 64KB 是宿主自限,之外仍受浏览器对 localStorage 的同源配额约束;写入被浏览器拒绝时抛 `PluginDataError`,原因为 `storage` |
| 大体积数据 | 资产快照、缓存等不进 localStorage,改存 IndexedDB,见 5.6 |
| 缺失键 | `get` 返回 `null` |
| 生命周期 | 卸载不清除;随站点数据清除而丢失,不得当作可靠存储或密钥保管处 |

体积与数据是两件事:2 MB 上限管产物体积(见 1),64KB 上限管插件写进 localStorage 的数据(本节),两者的计量对象与拒绝原因都不同;大体积数据走 IndexedDB(见 5.6),不进入这 64KB。

### 5.5 联网与外源请求

插件联网受引擎管控,联网能力由引擎经 `context` 提供,插件不得自建通道:

- 不得自行取数:插件不得用全局 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon` 等网络接口请求外部数据,也不得用 `import()` 从外部地址拉取代码或数据。
- 一律走宿主能力:联网统一走 `context.net`,目前是 `net:fetch` 提供的 `context.net.getText` 与 `context.net.postJson`,地址、方法、体积与超时约束由宿主落实,见下表。`context.assets` 的两条能力(见 5.7)是取远端资产的专用通道,不是通用联网,授权与约束口径相互独立。
- 授予范围:两个接口都只对内置插件开放,调用方仍需在清单里申请 `net:fetch`;第三方插件申请 `net:fetch` 时按 `unknown-capability` 拒绝,规则见 4。`postJson` 背后的 `net:fetch-post` 只由引擎使用,不能在清单里申请,也不出现在上下文里。第三方插件确有联网需求时,由宿主决定是否开放该能力,插件不能自行开通。
- 契约而非沙箱:插件与宿主同源、跑在页面主线程,引擎在技术上无法阻止同源代码调用全局 `fetch`。因此本节是一条契约约束,不是沙箱拦截:违反属于不合规,会在收录审核与运行日志里被指出,引擎不会把它转成错误码或拦截请求。
- 与插件自有数据的分界:本条只管向外取数与通信;插件在浏览器里自建 IndexedDB 库存自己的数据(见 5.6)不属于联网,不受本条限制。

请求约束由宿主落实:

| 方法 | 约束 |
|:---:|:---:|
| `getText(url, options?)` | 仅 https 与 GET;不发送 Cookie 与自定义请求头;只接受 `text/*` 与 `application/json` 响应;响应体上限 512KB;10 秒后中止请求 |
| `postJson(url, body, options?)` | 仅 https 与 JSON 请求体;请求体与响应体上限各 4KB;5 秒后中止;不跟随重定向;响应体丢弃,只回传最终地址与状态码 |

失败时抛 `PluginFetchError`,`reason` 取 `url`、`protocol`、`timeout`、`aborted`、`status`、`content-type`、`too-large`、`body`、`redirect`、`network` 之一;网络与解析失败由插件自行降级,引擎不弹宿主提示。

### 5.6 大体积数据与 IndexedDB

`plugins:storage` 只适合少量键值:整个插件的键值对象上限 64KB,见 5.4。资产快照、缓存、历史片段这类大体积数据不要塞进 localStorage,改用浏览器的 IndexedDB 存放,既不占 `plugins:storage` 的额度,也不参与它的计量。

| 项 | 规定 |
|:---:|:---:|
| 访问方式 | 宿主不提供 IndexedDB 能力,也不交出任何句柄;插件在页面主线程里直接用浏览器的 `indexedDB` 全局对象自建数据库 |
| 容量上限 | 宿主对插件的 IndexedDB 写入不设逐插件上限,不计量、不拦截;容量由浏览器按源分配,与宿主自身的库共用同一份源配额 |
| 与宿主库的关系 | 宿主把安装记录写在自己的 IndexedDB 库里,那是宿主的库,插件读写不到;插件只能访问自己打开的库 |
| 隔离责任 | 宿主不为插件的 IndexedDB 做按插件隔离:库名与对象仓库名由插件自定,建议以插件 id 作前缀避免撞名,彼此不冲突靠各自约定 |
| 生命周期 | 卸载与「清除插件数据」只删 `<APP_NAME>:plugin-data:<插件 id>`,不触碰插件自建的库;要清理就由插件自己在停用或用户操作时删,或由用户清除站点数据 |
| 不可用时的降级 | 隐私模式或用户禁用时打开数据库会失败,配额耗尽时写入事务会中止;这类失败由插件自行降级,宿主不弹提示 |
| 对宿主的影响 | 源配额是插件与宿主共用的,插件写满会连带影响宿主自身的写入;插件应自己控制体积并在需要时清理 |
| 数据形态 | 值必须能被结构化克隆:函数、DOM 节点与宿主对象都放不进去,需要先转成可存的形态 |

### 5.7 资产读取与下载

`context.assets` 提供「按地址取远端资产」的通道,是取资产的专用能力,不是通用联网:两者都不携带 Cookie 与自定义请求头,只允许 https(回环主机允许 http),地址、体积与超时约束由宿主落实;与 5.5 的 `context.net` 相互独立,授权口径也分开——`assets:read` 对全部插件开放,`assets:download` 只对受信来源插件开放。

`assets:read`(读远端资产):`context.assets.readText(url)` 与 `context.assets.readBytes(url)` 共用能力标识 `assets:read`,面向按地址读取小体积资产(远端的 JSON、证书、图片等),响应体上限 512KB。结果按观察到的事实分三态原样交给插件,引擎不猜测:

| `kind` | 含义 | 插件可以据此判断 |
|:---:|:---:|:---:|
| `content` | 取到内容,带最终地址、响应类型与 `text` 或 `bytes` | 正常消费内容 |
| `status` | 拿到明确的 HTTP 状态码,没有内容 | 对方已放行跨域,状态码就是对方给出的结论 |
| `no-status` | 只有网络层失败,没有任何状态码 | 地址无效或对方未开启跨域,两种可能无法在引擎侧区分 |

首次使用某个来源地址时,引擎向用户提示一次 `pluginAssetSourceFirstUse`(普通提示,不带错误图标),去重键是「插件 + 来源」:同一插件重复读取同一站点只报一次,另一个插件读取同一站点仍各自报一次。首次提示之后不再打扰用户:状态码、无状态码、读取错误与读取超时都只写该插件的插件日志;未授予与限流属于插件用法问题,仍按引擎统一口径提示。

`assets:download`(引擎代取大体积资产):`context.assets.download(assetId, options?)` 是单动作能力——插件在清单里声明一个不可变的资产地址与它的 SHA-512(清单 `assets` 块),引擎负责取回、校验,并把通过校验的字节交给插件;插件自行写入 IndexedDB 等本地存储,引擎不落盘,插件不接触请求、重定向与响应流。

| 项 | 规定 |
|:---:|:---:|
| 申请条件 | 仅受信来源插件,认定与拒绝口径见 4;安装期授予,调用期复核一次 |
| 清单配套 | 申请该能力时清单必须同时给出 `assets` 块,逐条含 `id`、`url`、`sha512`、`bytes`、`version`;`id` 不得重复;缺块、空块、块出现在未申请该能力的清单或字段不合格都按 `invalid-manifest` 拒绝 |
| 校验 | 引擎按清单声明的 SHA-512 与字节数校验,不通过不交付;流式读取,边读边累计摘要与字节数 |
| 限流 | 传输次数 3 次 / 10 秒,窗口内累计总流量 512MB,与 `assets:read` 分开计数;不设单次超时,进度与取消由宿主界面承担 |
| 用户提示 | 每一次传输事件都提示(不去重、不按来源合并),用户可随时取消,取消即中止请求,引擎不重试 |
| 失败 | 抛 `PluginAssetDownloadError`,`reason` 取 `protocol`、`status`、`timeout`、`too-large`、`hash-mismatch`、`aborted` 之一;除取消外只写插件日志 |
| 插件职责 | 本地副本按 `sha512` 命中即不下载;`version` 变化或本地摘要不符时按新清单重新下载并删除旧副本;下载失败、校验失败或用户取消必须给出可用的降级路径,不得让功能静默失效;停用或卸载时删除自己写入的副本;不得为绕过本能力直连地址,也不得把地址转交其他插件代取 |

细则(能力语义、受信来源层级的认定、模型选型、第二阶段触发条件与未定项)由组织文档维护,该文档是这项能力与层级的唯一权威文字,本节只收拢插件可见口径:`https://github.com/omds-chat/.github/blob/main/docs/repo-spec/asset-download-capability.md`。

### 5.8 请求前补丁

`context.chat.onBeforeRequest(handler)` 登记 `chat:request` 的请求前处理器,登记要求清单同时申请能力 `chat:request` 与挂载点 `chat:before-request`,缺任一项抛 `PluginCapabilityError`。引擎在每次发请求前同步调用一次处理器,把返回的补丁交给内核写进请求参数;登记返回释放函数,停用或卸载时由引擎执行。

处理器拿到的切片只有一项:

| 切片字段 | 内容 |
|:---:|:---:|
| `lastUserMessage` | 当前请求里最后一条用户消息的文本 |

补丁只认识六个白名单字段,未知字段静默丢弃,空白字符串按未提供处理,越界按边界裁剪:

| 字段 | 形态 | 范围 | 落到请求的字段 |
|:---:|:---:|:---:|:---:|
| `temperature` | 数字 | 0 到 2 | `temperature` |
| `topP` | 数字 | 0 到 1 | `top_p` |
| `maxTokens` | 正整数 | 1 到 4096,小数四舍五入 | `max_tokens` |
| `stop` | 字符串数组 | 最多 4 条,每条最多 32 字符 | `stop_sequences` |
| `systemPromptAppend` | 字符串 | 最多 2000 字符 | 追加到 `system` 之后,以换行分隔 |
| `systemPromptReplace` | 字符串 | 最多 8000 字符 | 整体替换 `system`;与追加同时存在时追加落在替换之后 |

| 约束 | 规定 |
|:---:|:---:|:---:|
| 时机 | 请求参数构造完成后、真正发出之前,每个请求一次 |
| 预算 | 全部处理器共用 10 毫秒;调用前与返回后各判一次,单个处理器自身超预算同样按超时处理 |
| 超时或抛错 | 整份补丁作废,请求按原参数发出,不阻断请求 |
| 提示 | 超时与越界各按插件第一次出现时提示一次(`pluginCallTimeout`、`pluginRequestPatchClamped`),不逐次打扰 |

多个插件同时登记时按登记顺序合并:标量以后登记者为准,`stop` 取并集并在 4 条处截断,`systemPromptAppend` 按顺序以换行拼接后再按长度截断,`systemPromptReplace` 以后登记者为准。

### 5.9 插件设置表面

申请能力 `settings:surface` 后,插件可在激活期用 `context.settings.register(descriptor)` 登记一份字段描述,宿主据此渲染设置表单。插件只交描述、不交控件:控件形态、样式与 i18n 全部归宿主。描述非法(重复键、未知类型、非法默认值、非法文案、编译不过的 pattern、超规模)时整份注册失败,抛 `PluginSettingsError`,`code` 是结构化问题码,同时提示 `pluginSettingsRejected`;登记返回释放函数,停用随引擎清理(激活中途失败同样撤销);同一插件再次登记时替换前一份,页面 id 就是插件 id,不允许自定义。

字段描述:

| 字段 | 必填 | 说明 |
|:---:|:---:|:---:|
| `key` | 是 | `^[a-z][a-z0-9-]{0,63}$`,同一份描述内不得重复,也是设置存储的键 |
| `type` | 是 | `switch`、`select`、`number`、`text`、`secret` 五种之一,未知类型整份拒绝 |
| `labelKey` / `label` | 是 | 二选一:`labelKey` 必须是宿主 i18n 字典里的键,`label` 是插件直给的文案(1 到 40 字符) |
| `default` | 非 secret 必填 | 默认值;必须通过该字段自己的取值校验;secret 字段不得有默认值 |
| `min` / `max` / `step` | 否 | number 的取值范围与步进;步进只影响控件交互,不参与校验 |
| `maxLength` / `pattern` | 否 | text 的长度上限与形态约束;pattern 必须能通过 `new RegExp` 编译 |
| `options` | select 必填 | 2 到 32 个选项,每项 `{ value, labelKey 或 label }`,value 不得重复 |

规模上限:最多 32 个字段,描述序列化后不超过 8KB,超限按 `too-many-fields` / `descriptor-too-large` 拒绝。

值的语义分两层:默认层来自描述的 `default`;用户覆盖层落在独立的设置命名空间(`<APP_NAME>:plugin-settings:<插件 id>`,概念上是 `settings/<插件 id>/<字段键>`),与 `plugins:storage` 的插件数据完全分开——插件用 `storage.set` 写不到这张表,写侧只有宿主的设置页,写入前按描述校验,无法绕过。覆盖值不落盘默认值,单插件覆盖层上限 16KB。覆盖的判定是「覆盖层里有没有这个键」,与生效值是否等于登记默认值无关:用户把字段改成与默认值完全相同的值同样算覆盖。

插件侧的四个成员:

| 成员 | 说明 |
|:---:|:---:|
| `context.settings.values()` | 只读自身命名空间的生效值:覆盖值优先,否则默认值;其他插件的设置不可见,secret 字段不返回任何值 |
| `context.settings.overrides()` | 只读自身覆盖状态,逐字段回答用户是否覆盖(`overridden`),与宿主详情页的「已修改」徽标同一口径;secret 字段没有默认值,只回答是否已配置(`secretConfigured`),不返回值。读凭证库要等一次异步查询,因此这个成员是异步的 |
| `context.settings.onChange(handler)` | 订阅设置变更,返回释放函数;回调由引擎在落盘后发起,不占插件的限流名额;停用之后不再回调。载荷逐字段带 `key`、变化种类(`added` 为第一次有覆盖值,`changed` 为已有覆盖值被改写,`reset` 为覆盖被撤销)与变化后的覆盖状态;secret 字段按同一套三值表达「从没配置到已配置」「重新填写」「清除」,载荷里只有状态、没有值。写入与当前覆盖值相同的值、重置本来没有覆盖值的字段,落盘动作成功但状态没变,不发事件 |
| `secret` 字段 | 值不落设置存储,复用宿主凭证库(与供应端点凭证同一张表,键的来源标识带 `plugin-secret:` 前缀):只写不读,读侧只回答「是否已配置」 |

变更通知的时机:`set`、`reset` 各自成功落盘后立刻发一条,`resetAll` 只发一条、载荷含全部降回默认值的字段;一次门面调用就是一轮,同一字段在一次调用里最多出现一次,跨调用不攒批,事件顺序与落盘顺序一致。宿主保存多字段表单时逐字段调用,插件因此收到多条事件。单个订阅者抛错只写该插件的插件日志,其余订阅者照常收到事件;已经落盘的值不会因此回滚。

卸载清理:登记随停用撤销;覆盖值、秘密值与变更订阅由引擎管理,卸载时一并清除,不在遗留数据区出现。

### 5.10 UI 槽位

申请能力 `ui:slot` 后,插件可在激活期用 `context.ui.registerSlot(slot, descriptor)` 登记一份声明式描述,宿主按描述的 `slot` 把内容渲染到对应落点。能力只有一个,位置不止一个:槽位名是引擎侧的封闭枚举,新增落点只扩枚举与宿主渲染,不新增能力标识。本版开放十个槽位,按描述形态分两类:

| 槽位 | 类型 | 落点 | 语义 |
|:---:|:---:|:---:|:---:|
| `nav.panel` | 页面型 | 侧边栏导航行区域 + 主区整页 | 登记一项 = 导航行区域里的一行(图标 + 标题),点击切换到该插件页面 |
| `conversation.tabs` | 页面型 | 会话视图标签栏 + 主区整页 | 登记一项 = 标签栏里的一个标签,选中后主区整块换成该插件页面;标签切换不改会话上下文 |
| `settings.page` | 页面型 | 系统设置的「插件」分组 | 登记一项 = 设置页里的一个入口(页面标题 + 插件名),点击后渲染该页面;分组只在有登记项时出现 |
| `session.panel.section` | 页面型 | 会话视图右侧面板的默认页 | 登记一项 = 该页里带标题的一段,多项按 order 逐段排列 |
| `nav.side` | 页面型 | 会话右栏的标签栏 | 登记一项 = 右栏标签栏里的一个可切换标签;标签只在右栏内切换,不改主区、不改会话上下文 |
| `composer.toolbar` | 位置型 | 输入框下方的工具条 | 登记一项 = 工具条里的一个按钮,点击触发动作回调,`actionId` 是描述里的 `actionKey` |
| `composer.notice` | 位置型 | 输入框上方 | 登记一项 = 输入卡顶部的一条通知条,左侧色条随 `tone` 取蓝/琥珀/红 |
| `overlay.notice` | 位置型 | 右上角全局面板通知栈 | 同一插件的多条通知合并成一张悬浮卡片(按插件分组),不拦截页面点击 |
| `message.actions` | 位置型 | 助手消息底部的操作行 | 登记一项 = 操作行里的一组按钮,点击触发动作回调,`itemKey` 是消息 id |
| `menu.item` | 位置型 | 会话行与消息的右键菜单 | 登记一项 = 右键菜单里的一项,`target` 决定挂在会话行还是消息上,`itemKey` 是会话 id 或消息 id |

槽位授权按白名单逐位置判定:清单申请 `ui:slot` 后,只允许登记 `slots` 白名单逐个声明的槽位(白名单字段的写法见[开发规范](plugin-develop-spec.md) 2.5),未声明的槽位登记时按未授权拒绝;槽位名不在枚举内按 `unknown-slot` 拒绝安装。槽位是可选项:插件不登记就没有任何入口,界面保持既有行为(没有 `nav.panel` 登记时导航行区域只有插件面板一行,没有 `conversation.tabs` 登记时标签栏整块不渲染,其余槽位同理)。与 5.9 同法,插件只交描述、不交控件:控件形态、样式与 i18n 全部归宿主。

页面型槽位(五个)的描述共用同一份字段:

| 字段 | 必填 | 说明 |
|:---:|:---:|:---:|
| `slot` | 是 | 槽位名,必须在槽位枚举内且已写入清单 `slots` 白名单 |
| `id` | 是 | `^[a-z][a-z0-9-]{0,63}$`,同一槽位内跨插件唯一(先登记者占位,同插件重复登记同 id 时替换前一份),与插件 id 共同构成页面入口的键 |
| `titleKey` / `title` | 是 | 二选一:`titleKey` 必须是宿主 i18n 字典里的键,`title` 是插件直给的文案(1 到 40 字符);导航行、标签、设置入口、右栏段落标题与右栏标签页的名字都用它 |
| `iconKey` | 否 | 图标键,由宿主图标查表解析,未命中时用通用插件图标;校验只看形态(1 到 64 字符),不进 i18n 词表 |
| `order` | 否 | 同槽位内的排序键:升序,同值按登记顺序,未给按 0 |
| `blocks` | 是 | 区块数组,1 到 64 个,按声明顺序渲染 |

区块四种:

| 区块 | 字段 | 说明 |
|:---:|:---:|:---:|
| `text` | `text` | 静态说明文字,1 到 2000 字符 |
| `list` | `items`、`itemAction?` | 条目数组(至多 200 条),每条 `{ key, titleKey 或 title, description?, badgeKey 或 badge }`;条目键不得重复,`description` 是 1 到 200 字符的直给文案,标题与徽标复用设置字段标签的文案口径;`itemAction` 是可选的逐条动作 `{ key, labelKey 或 label }` |
| `form` | `fields` | 复用 5.9 的五种字段描述与宿主控件,字段键在同一页面内不得重复(跨区块同键同样拒绝) |
| `actions` | `items` | 按钮组(至多 8 个),每项 `{ key, labelKey 或 label }`,键不得重复 |

规模上限:最多 64 个区块,描述序列化后不超过 8KB,超限按 `too-many-blocks` / `descriptor-too-large` 拒绝。

位置型槽位(五个)的描述不带 `blocks`,共同字段是 `id` 与可选的 `order`,其余字段:

| 槽位 | 字段 | 说明 |
|:---:|:---:|:---:|
| `composer.toolbar` | `labelKey` 或 `label`、`actionKey` | 按钮文案与动作键;`actionKey` 走键词表 `^[a-z][a-z0-9-]{0,63}$`,回调时作为 `actionId` |
| `composer.notice` | `tone`、`textKey` 或 `text` | `tone` 取 `info`/`warning`/`error`(闭集);正文二选一,`textKey` 必须是宿主字典里的键,`text` 是 1 到 2000 字符的直给文案 |
| `overlay.notice` | `level`、`textKey` 或 `text` | `level` 取值与 `tone` 同一套;正文口径同上 |
| `message.actions` | `items` | 1 到 8 个条目,每条 `{ key, labelKey 或 label }` 与 actions 区块同形;键不得重复,回调时条目键作为 `actionId` |
| `menu.item` | `target`、`labelKey` 或 `label`、`actionKey` | `target` 取 `message`/`session`,决定挂到消息右键还是会话行右键;`actionKey` 口径同工具条 |

描述非法(槽位不在枚举、槽位未写入白名单、同槽位内 id 与其他插件重复、非法 id、非法文案、非法图标键、非法排序、非法动作键、非法 `tone`/`level`/`target`、空区块、超过 64 个区块、重复区块 id、未知区块类型、非法条目、非法动作、非法说明文字、非法表单字段、跨区块重复字段键、超规模)都让整份注册失败,抛 `PluginSlotError`,`code` 是结构化问题码,同时提示 `pluginSlotRejected`(白名单缺失另提示 `pluginSlotNotGranted`)。登记返回带槽位名与页面 id 的句柄,释放函数进入插件的 disposer 集合,停用随引擎清理(激活中途失败同样撤销);同一插件重复登记同 id 槽位时替换前一份。

两个回调处理器:

| 处理器 | 登记 | 回调时机 |
|:---:|:---:|:---:|
| 动作 | `context.ui.onSlotAction(slot, handler)` | 用户点击该槽位上的动作按钮、工具条按钮或菜单项时,引擎同步回调一次,载荷 `{ slot, id, actionId, itemKey?, form? }`;`slot` 一定出现,`itemKey` 在 list 逐条动作、消息操作行与菜单项上出现,`form` 是页面表单区块的当前草稿值,页面没有表单区块时不出现 |
| 页面数据 | `context.ui.onSlotData(slot, handler)` | 宿主进入页面或动作返回刷新指示时,引擎同步索取当前页面模型,传槽位名与页面 id;处理器同步返回页面描述,返回 null 表示沿用登记时的描述 |

回调约定:

- 动作处理器同步返回 `{ refresh: true }` 时,宿主重新向插件索取页面模型;异步工作由插件自行发起,完成后用 `context.ui.notify` 提示,页面数据等用户下次进入或下一次刷新指示再更新。
- 两个处理器的回调由引擎发起,不占插件的限流名额;`ui:slot` 的限流按登记次数计,见 4。
- 数据处理器返回的模型按登记期同一份校验收敛:非法、抛错或 slot/id 与所请求页面不一致时回落到登记时的缺省模型,返回 null 表示沿用登记描述,原因写插件日志;未实现页面数据处理器的插件页面静态显示。
- 页面表单的值只活在宿主侧的脏值生命周期里(改动即脏、字段级非法给出问题文案、可重置为默认),没有落盘动作;用户点击动作按钮时,宿主把当前草稿值随载荷交给插件。

撤销语义:停用撤销该插件的全部槽位登记与两个处理器;卸载时引擎再兜底清一次,避免未激活过的插件留下残留。正停在被撤销页面上的视图自动退回会话,并用一次气泡说明。

### 5.11 供应端点与按端点执行

插件可以声明它能提供哪些供应端点(provider endpoint),但只交描述、不交执行代码:装配请求与解析回流的实现在内核,凭证由引擎在执行时取用,插件两头都碰不到。「端点」与插件安装来源(`inner`、`outer` 等)不是同一个概念,文档与界面不用「来源」指代它。

| 环节 | 入口 | 说明 |
|:---:|:---:|:---:|
| 声明 | `context.provider.registerSource(descriptor)` | 清单申请 `provider:source` 后可用;登记一份端点描述,只登记、不执行、不发起网络请求。描述不合格抛 `PluginSourceError`,原因取 `id`、`label`、`format`、`baseUrl`、`capabilities`、`endpoints` 之一,并提示 `pluginSourceRejected`;限流按声明次数计(见 4),超过上限抛 `PluginRateLimitError`,整次激活失败并按失败路径撤销该插件的全部声明 |
| 执行 | `context.provider.run(capability, payload, options?)` | 清单申请 `provider:run` 后可用;引擎选端点、读凭证、组装请求,失败按错误码抛 `PluginProviderRunError`。两条能力分开:声明是交描述,执行会花用户填的 Key 与端点额度,授权单位不该相同 |

端点描述的字段:

| 字段 | 必填 | 说明 |
|:---:|:---:|:---:|
| `id` | 是 | 小写字母开头,允许数字、点、下划线与连字符,3 到 64 字符;注册表按它合并与判冲突 |
| `label` | 是 | 展示名称,最多 40 字符;只用于展示,不参与冲突判定 |
| `format` | 是 | `anthropic-messages` 或 `openai-chat`;只描述线上协议,不指厂商 |
| `baseUrl` | 是 | 端点基址;登记前统一规范化:去首尾空白、主机转小写、去默认端口(https 的 443、http 的 80)、去尾斜杠;带 query、hash 或内嵌用户名密码的地址直接拒绝;非 https 且非回环地址的 http 默认拒绝,宿主打开「允许局域网 http 供应端点」后放行。规范化后的值同时用于注册表比对与执行期的地址拼接 |
| `capabilities` | 是 | 该端点能提供的能力,取自九个端点能力标识,不得为空、不得重复 |
| `endpoints` | 否 | 按能力覆盖端点路径,只允许站内绝对路径;缺省按 `format` 推导 |

端点能力标识共九个:`text.generate`、`reasoning.think`、`vision.image`、`document.read`、`audio.asr`、`audio.tts`、`tool.web-search`、`tool.read-url`、`models.list`。它们不出现在插件清单里,只出现在端点描述的能力清单里;本版只有 `text.generate` 与 `models.list` 接通,其余七项在执行前按 `capability-unimplemented` 拒绝。

合并与冲突:端点 id 不同各自入表;id 相同且定义一致时能力清单取并集,声明方都记进声明方列表;id 相同但定义不一致时,先声明的那份临时生效,后声明的不生效,记一条冲突。定义比对只看 `format`、规范化后的 `baseUrl` 与 `endpoints` 三项,`label` 差异只算展示差异,不判冲突。未决期的代价写在明处:后声明方的插件会看到 id 在表里,但执行期只认先声明方的基址;冲突方声明的能力不进能力矩阵;冲突只体现在注册表视图与引擎日志里,需要宿主界面主动展示;先声明方退出后,下一份声明重新成为唯一定义。停用或卸载插件时撤销该插件的全部声明。

执行链路固定四段:从注册表选出端点(按声明顺序,取该能力的第一个端点;缺凭证按 `credential-missing` 报错,不会悄悄换到下一个端点)→ 按「端点 id + 规范化后的基址」读凭证 → 带描述与载荷调用内核 → 回流原样透传,失败换成可判定的错误码。本版端点选择是全局的:拿到 `provider:run` 的插件可以在其他插件声明的端点上发起调用;端点选择交给用户、按插件限定可选集合与失败回退是上游的后续计划,插件侧的调用形态不变。

返回形态按能力区分:`text.generate` 返回 `{ kind: 'stream', events }`,`events` 是异步可迭代物,逐条产出 `text`、`thinking`、`title` 与 `end` 四类事件,鉴权与网络失败要到第一次迭代时才抛出;`models.list` 返回 `{ kind: 'models', models }`,一次性返回,`models` 每项只有 `id`。

失败一律抛 `PluginProviderRunError`,判定依据是 `code`;原始失败文本只进 `detail`,凭证既不出现在错误里,也不出现在结果或回流事件里:

| `code` | 含义 |
|:---:|:---:|
| `credential-missing` | 没有该「端点 id + 基址」的凭证记录,或凭证存储读不出来 |
| `credential-stale` | 同一端点 id 存在别的基址的记录,端点换过主机,旧 Key 不能复用 |
| `credential-rejected` | 端点以 401 或 403 拒绝凭证 |
| `capability-unavailable` | 没有端点提供该能力,或选中的端点未声明它 |
| `capability-unimplemented` | 端点声明了该能力,本版尚未接通 |
| `endpoint-unreachable` | 请求没有拿到响应:网络层失败,或端点基址不可用 |
| `protocol-error` | 拿到响应但不符合协议:非 2xx、非流式响应、JSON 不合法、流提前结束 |

错误对象另带 `capability` 与 `sourceId`(还没选出端点时为 null)。引擎不为这类失败弹宿主提示,由插件自己决定提示还是降级。限流 10 次 / 10 秒,单次超时 15 秒,超时只覆盖「建立调用」这一段;`text.generate` 的回流在调用返回后惰性产出,占的是调用方的迭代时间;要中断就在 `options.signal` 上取消。

## 6. 安全边界

- 唯一通道:插件与宿主之间只有 `context` 上的受限能力对象。插件拿不到 `dsc-core` 的 `CoreApi`、`zustand` store 句柄与 IndexedDB 句柄,也拿不到任何 DOM 或插槽接口。
- 句柄与浏览器 API 的分界:这里的「拿不到 IndexedDB 句柄」指宿主的库与事务;插件仍可用浏览器的 `indexedDB` 自建库存大体积数据(见 5.6),那是插件自己的数据,宿主不代管、不计量、不清理。
- 联网不自建通道:插件联网只能走 `context.net`(`net:fetch`),不得自行调用全局 `fetch`、`XMLHttpRequest`、`WebSocket` 等接口。引擎无法在技术上拦截同源代码的全局 `fetch`,本条靠契约与审核落实,违反属于不合规,见 5.5。`context.assets` 是取远端资产的专用通道,不是通用联网,见 5.7。
- 凭证与票据:引擎持有调用凭证,每次调用签发一张一次性票据,票据有效期 5 秒,核心消费后作废。绕过 `context` 直接调用核心会因缺少票据被拒,引擎记录旁路事件(保留 50 条),并按 3 秒的最小间隔提示 `pluginBypassDetected`。
- 能力双层校验:安装时按清单校验能力、挂载点与槽位白名单,调用时按清单再校验一次;未申请的能力不可用。
- 逐位置授权:`ui:slot` 的授权细到槽位——能力只回答「能不能登记槽位」,「能登记哪些槽位」由清单 `slots` 白名单决定;同槽位内页面 id 跨插件唯一,先登记者占位,撞名在登记期拒绝,不做静默覆盖(见 5.10)。
- 设置写侧不在插件上下文:设置覆盖值的写侧只有宿主的设置页,写入前按描述校验,插件用 `storage.set` 写不到这张表(见 5.9);secret 值走凭证库,只写不读。
- 凭证不外泄:供应端点凭证按「端点 id + 规范化后的基址」存在引擎的 IndexedDB 里,插件既拿不到读写入口,也拿不到任何凭证值;凭证不出现在执行结果、回流事件与错误对象里(见 5.11)。
- 数据隔离:插件数据按插件 id 隔离,只能读写自己的键值;设置按插件 id 隔离,其他插件的设置不可见。
- 日志隔离:插件日志保存在内存,单插件上限 100 条,经面板或引擎接口读取,不写浏览器控制台。
- 文案约束:用户可见提示复用宿主文案键,插件不自造文案。

## 7. 错误与降级

| 情形 | 行为 |
|:---:|:---:|
| 清单非法 | 安装拒绝,`invalid-manifest` |
| 能力或挂载点未知 | 安装拒绝,`unknown-capability` 或 `unknown-mount` |
| 清单 `slots` 白名单含枚举外槽位名 | 安装拒绝,`unknown-slot` |
| `assets` 块与 `assets:download` 能力不配套,或块内字段不合格 | 安装拒绝,`invalid-manifest` |
| 版本不兼容 | 安装拒绝,`incompatible-version` |
| 重名、缺依赖 | 安装拒绝,`duplicate`、`missing-dependency` |
| 安装期检出冲突 | 不拒绝安装:对方在启用中时新插件保持停用并写入待决定记录,对方全部停用时仅警告,照常自动启用;冲突对随安装结果带回(见 3) |
| 启用时与运行中的插件冲突 | 冲突涉及的已启用插件全部停用,整组冲突写入待决定记录,返回 `conflict` 与结构化冲突列表 |
| 产物字节取不到 | 安装拒绝,`artifact-unreachable` |
| 产物不是可存的 UTF-8 文本 | 安装拒绝:在线安装 `load-failed`,离线包预检 `corrupt-package` |
| 产物无法导入或导出不符 | 安装拒绝,`load-failed` 或 `invalid-plugin` |
| 激活抛错或超时 | 插件标记 `failed`,引擎与其他插件继续运行 |
| 依赖的插件被停用、卸载或启动失败 | 依赖它的已启用插件由引擎自动停用并逐个提示(`pluginDependencyAutoStopped`) |
| 停用仍有已启用的依赖方 | 停用拒绝,返回 `depended-on` 与依赖方 id;强行停用标志同样被拒,引擎不连带停用依赖方 |
| 未授予的能力被调用 | 抛 `PluginCapabilityError`,并提示 `pluginCapabilityDenied` |
| 登记未声明挂载点的处理器 | 抛 `PluginCapabilityError`,并提示 `pluginCapabilityDenied` |
| 登记未写入 `slots` 白名单的槽位 | 抛 `PluginSlotError`(`slot-not-granted`),并提示 `pluginSlotNotGranted` |
| 槽位或设置描述非法 | 抛 `PluginSlotError` / `PluginSettingsError`,`code` 是结构化问题码,并提示 `pluginSlotRejected` / `pluginSettingsRejected` |
| 供应端点声明不合格 | 抛 `PluginSourceError`,原因取不合格字段名,并提示 `pluginSourceRejected` |
| 按端点执行失败 | 抛 `PluginProviderRunError`,按 `code` 判定,见 5.11 |
| 大体积资产取件失败 | 抛 `PluginAssetDownloadError`,`reason` 取失败码闭集之一,见 5.7 |
| 插件自行调用全局 `fetch` 等网络接口 | 引擎不拦截,也不返回错误码;按不合规处理,在收录审核与运行日志里被指出(见 5.5) |
| 超出限流 | 抛 `PluginRateLimitError`,并提示 `pluginCallRateLimited` |
| 调用超时 | 抛 `PluginTimeoutError`,并提示 `pluginCallTimeout` |
| 调用被取消 | 抛 `PluginAbortError` |
| 事件处理器抛错 | 只写入该插件日志,不影响其他处理器 |
| 请求前补丁越界 | 按边界裁剪后生效,首次提示 `pluginRequestPatchClamped` |
| 请求前处理器超时或抛错 | 整份补丁作废,请求按原参数发出,不阻断请求 |
| 插件数据超限或无法序列化 | 抛 `PluginDataError`,并提示 `pluginDataQuotaExceeded`、`pluginDataUnavailable` 或 `pluginDataInvalid` |

未知挂载点由引擎拒绝,错误码为 `unknown-mount`;清单 `slots` 白名单里的枚举外槽位按 `unknown-slot` 拒绝。挂载点表当前为 `session:changed` 与 `chat:before-request`,后者需同时申请能力 `chat:request`,见[开发规范](plugin-develop-spec.md) 2.1。

## 8. 校验方式

| 文档 | Schema |
|:---:|:---:|
| 插件清单 | [schemas/manifest/plugin-manifest.schema.json](../schemas/manifest/plugin-manifest.schema.json) |
| 运行时 meta | [schemas/runtime/meta.json](../schemas/runtime/meta.json) |

本仓库提供零依赖校验脚本,不联网、不安装依赖:

```bash
node scripts/validate-specs.mjs                          # 自检 Schema、样例与本仓库 meta 数据
node scripts/validate-specs.mjs <清单文件>                # 校验单个清单
node scripts/validate-specs.mjs <meta.json> --schema meta # 校验单个运行时 meta
```

Schema 是静态校验,最终以宿主安装时的校验结果为准。清单 Schema 未列出的字段会被拒绝,宿主的清单读取只取已定义的字段并忽略其余字段,因此 Schema 只用于尽早发现拼写与取值错误,不改变宿主的判定。

## 历史版本列表

本文档只维护最新版本,历史版本由本节的链接负责导航。

本节为占位:仓库当前还没有发布标签,首个版本发布后在此按版本倒序列出,每个条目指向该版本标签下的本文档。
