# dsc 插件开发规范

本文件规定如何按 `dsc-plugin-engine` 的契约编写、签名与分发 dsc 插件:清单字段与校验规则、版本与依赖、运行时 meta、作者签名与公钥位置、分发要求。运行期的状态、能力与错误行为见 [插件运行时规范](plugin-runtime-spec.md)。

## 1. 开发约束

- 纯前端运行:只用浏览器 API,不引入 Node 内置模块、后端接口与新增依赖;联网只走 `context.net`,见[运行时规范](plugin-runtime-spec.md) 5.5。
- 不直接访问内核:插件拿不到 `dsc-core` 的 `CoreApi`、`zustand` store 句柄与 IndexedDB 句柄,只能使用 `context` 上的受限能力对象。这里的 IndexedDB 句柄指宿主的库;插件自己的大体积数据(资产快照、缓存)用浏览器的 `indexedDB` 自建库,存放与配额见[运行时规范](plugin-runtime-spec.md) 5.6。
- 不直接操作宿主 DOM:`context` 未提供 DOM 或插槽接口,界面提示统一走 `context.ui.notify`;需要页面或界面入口的插件用声明式 UI 槽位(见[运行时规范](plugin-runtime-spec.md) 5.10)。
- 用户可见文案使用宿主文案键:`notify` 的 `key` 取自宿主 i18n 的既有键,不硬编码中英文句子。
- 代码风格与宿主一致:单引号、无分号、2 空格缩进、具名导出、模块内相对导入带 `.js` 后缀。
- 类型副本可脱离宿主源码使用:本仓库 [src/types.ts](../src/types.ts) 是契约的精简副本,缺的字段以宿主源码为准。

## 2. 清单

清单是安装依据,可以随产物导出(`export const manifest`),也可以由调用方显式传入;离线包还可由 `meta.json` 的 `capabilities` 推导。

### 2.1 字段与校验规则

| 字段 | 必填 | 规则 | 不满足时 |
|:---:|:---:|:---:|:---:|
| `id` | 是 | 小写字母开头,只允许小写字母、数字与连字符,长度 3 到 64 | `invalid-manifest` |
| `name` | 是 | 去掉首尾空白后不得为空 | `invalid-manifest` |
| `version` | 是 | 三段数字 `主.次.修订`,不允许前导零 | `invalid-manifest` |
| `engines` | 否 | 单个比较符加三段版本,或 `*`;空串按不限制处理 | `incompatible-version` |
| `dependencies` | 否 | 插件 id 数组,安装时须已存在,激活时须已激活 | `missing-dependency` |
| `conflicts` | 否 | 插件 id 数组;安装期与启用期都按两个方向检出,安装不因冲突被拒绝,处置见[运行时规范](plugin-runtime-spec.md) 3 | —(冲突对随安装结果带回,由引擎按对方启用状态处置) |
| `capabilities` | 是 | 能力表内的名字,不得重复 | `invalid-manifest`(重复)、`unknown-capability`(未知,或第三方申请 `net:fetch`、非受信来源申请 `assets:download`) |
| `mounts` | 否 | 挂载点名字,取自挂载点表,不得重复 | `invalid-manifest`(重复)、`unknown-mount`(未知) |
| `slots` | 否 | UI 槽位白名单,见 2.5 | `invalid-manifest`(重复)、`unknown-slot`(枚举外) |
| `assets` | 否 | 资产声明块,见 2.6 | `invalid-manifest`(与能力不配套或字段不合格) |

未知挂载点由引擎拒绝,错误码为 `unknown-mount`;枚举外槽位按 `unknown-slot` 拒绝。

清单的形态收敛另有一条:读取清单时 `id`、`name`、`version` 必须是字符串,`capabilities` 必须是字符串数组,其余四个字段(`dependencies`、`conflicts`、`mounts`、`slots`)要么缺省,要么是字符串数组;不符合这些形态时按清单缺失处理,安装结果为 `invalid-manifest`。

能力表:

| 能力 | 申请条件 | 用途 |
|:---:|:---:|:---:|
| `sessions:list`、`sessions:read`、`sessions:rename`、`events:session` | 无 | 会话摘要、会话内容、重命名与会话事件订阅 |
| `notify` | 无 | 宿主文案键提示 |
| `settings:locale` | 无 | 读取当前语言 |
| `settings:surface` | 无 | 登记插件设置字段描述,宿主渲染设置表单,见[运行时规范](plugin-runtime-spec.md) 5.9 |
| `plugins:storage` | 无 | 插件数据读写 |
| `assets:read` | 无 | 按地址读取远端资产,三态结果,见[运行时规范](plugin-runtime-spec.md) 5.7 |
| `assets:download` | 仅受信来源插件:来源为内部插件合集(`inner`)或社区插件合集(`awesome`)且本地来源结论为「已确认」;第三方申请按 `unknown-capability` 拒绝。清单须同时声明 `assets` 块,见 2.6 与[运行时规范](plugin-runtime-spec.md) 5.7 | 引擎代取大体积资产并校验 SHA-512 |
| `chat:request` | 须同时声明挂载点 `chat:before-request` | 登记请求前补丁处理器,见[运行时规范](plugin-runtime-spec.md) 5.8 |
| `ui:slot` | 须同时在清单 `slots` 白名单声明要登记的槽位,见 2.5 | 登记声明式 UI 槽位描述,见[运行时规范](plugin-runtime-spec.md) 5.10 |
| `provider:source` | 无 | 声明供应端点,见[运行时规范](plugin-runtime-spec.md) 5.11 |
| `provider:run` | 无 | 在选中的端点上发起一次执行,见[运行时规范](plugin-runtime-spec.md) 5.11 |
| `net:fetch` | 仅内置插件,第三方申请按 `unknown-capability` 拒绝;插件也不得自建网络通道,见[运行时规范](plugin-runtime-spec.md) 5.5 | 受管控的 GET 文本读取与 JSON 计数请求 |

`chat:request` 只服务 `context.chat.onBeforeRequest`:登记请求前处理器时,清单须同时申请该能力与挂载点 `chat:before-request`,缺任一项抛 `PluginCapabilityError`。`provider:source` 约束的是能否声明供应端点,登记入口为 `context.provider.registerSource`;`provider:run` 约束的是能否执行,执行入口为 `context.provider.run`,两条能力互相独立,执行由引擎按端点描述发起,插件拿不到执行侧的标识。

挂载点表:

| 挂载点 | 触发时机 | 声明与订阅 |
|:---:|:---:|:---:|
| `session:changed` | 会话内容变化 | 清单写 `mounts`,处理器经 `context.events.on` 登记 |
| `chat:before-request` | 每次发请求前同步调用一次,返回补丁 | 清单同时写 `mounts` 与能力 `chat:request`,处理器经 `context.chat.onBeforeRequest` 登记 |

引擎的挂载点枚举另含 `ui:slot-action` 与 `ui:slot-data`,它们是旧版「按挂载点声明槽位处理器」的残留,槽位处理器的授权已改由 `slots` 白名单逐槽位判定,声明这两个挂载点不产生任何授权效果。

### 2.2 校验顺序与结果

| 顺序 | 检查 | 不通过时 |
|:---:|:---:|:---:|
| 1 | `id`、`name`、`version` 与 `capabilities` 的重复项 | `invalid-manifest` |
| 2 | 每个能力是否在能力表内;`net:fetch` 是否属于内置插件;`assets:download` 是否属于受信来源插件 | `unknown-capability` |
| 3 | `mounts` 的重复项 | `invalid-manifest` |
| 4 | 每个挂载点是否在挂载点表内 | `unknown-mount` |
| 5 | `slots` 的重复项 | `invalid-manifest` |
| 6 | 每个槽位名是否在槽位枚举内 | `unknown-slot` |
| 7 | `assets` 块与 `assets:download` 能力是否配套;块内逐条字段是否合格、`id` 是否重复 | `invalid-manifest` |
| 8 | 同 id 是否已有插件实例 | `duplicate` |
| 9 | `engines` 是否匹配 dsc-core 版本 | `incompatible-version` |
| 10 | `conflicts` 与已安装记录是否互相命中(两个方向) | 不拒绝安装,检出结果随安装结果带回 |
| 11 | `dependencies` 中的 id 是否已安装 | `missing-dependency` |

### 2.3 清单 id 的收敛

由插件名得到插件 id 的规则只有一处实现,离线包、在线安装与插件市场共用:

1. 有 `@scope/` 前缀时取 `/` 之后的部分。
2. 去掉首尾空白并转小写。
3. 把 `[a-z0-9-]` 之外的字符折叠为连字符。
4. 去掉首尾连字符。

收敛结果立即按清单规则 `^[a-z][a-z0-9-]{2,63}$` 校验,字符形态与长度在同一步判定:长度不在 3 到 64 之间、不以小写字母开头或含其他字符时,收敛即失败。离线包预检据此按 `invalid-manifest` 拒绝,原因说明指向插件命名而不是笼统的清单非法;在线安装与宿主直接注册同样按清单非法拒绝。插件命名应保证收敛后长度不少于 3。

### 2.4 示例

```ts
import type { PluginManifest } from './types.js'

export const manifest: PluginManifest = {
  id: 'dsc-session-digest',
  name: 'Session Digest',
  version: '0.1.0',
  engines: '^1.0.0',
  capabilities: ['sessions:read', 'events:session', 'plugins:storage'],
  mounts: ['session:changed'],
}
```

可运行的完整示例见 [examples/session-digest](../examples/session-digest/index.ts),字段取值可用 [清单 Schema](../schemas/manifest/plugin-manifest.schema.json) 校验。

### 2.5 UI 槽位白名单

`slots` 是 `ui:slot` 能力的逐位置授权:清单申请 `ui:slot` 后,插件只允许登记这里逐个声明的槽位,未声明的槽位登记时按未授权拒绝。槽位名取自引擎的封闭枚举,不得重复,枚举之外的槽位按 `unknown-slot` 拒绝安装;由 `meta.json` 推导的安装清单可以缺该字段,安装阶段会用产物导出的清单补齐,与 `mounts` 的补齐口径一致。槽位枚举、槽位语义与描述形态见[运行时规范](plugin-runtime-spec.md) 5.10。

```ts
export const manifest: PluginManifest = {
  id: 'dsc-demo-page',
  name: 'Demo Page',
  version: '0.1.0',
  capabilities: ['ui:slot'],
  slots: ['nav.panel', 'composer.toolbar'],
}
```

### 2.6 资产声明块

`assets` 与能力 `assets:download` 绑定:申请该能力时必须提供 `assets` 块且不得为空,未申请该能力时不得出现该块,否则清单按 `invalid-manifest` 拒绝。块内逐条声明一个不可变的资产:

| 字段 | 必填 | 规则 |
|:---:|:---:|:---:|
| `id` | 是 | 插件内唯一,小写字母开头,只含小写字母、数字与连字符;调用时用它指定资产 |
| `url` | 是 | 绝对地址,只允许 https(回环主机允许 http);不携带内嵌凭证与一次性签名参数 |
| `sha512` | 是 | 128 位小写十六进制,不带前缀 |
| `bytes` | 是 | 正整数,声明体积;实际字节数与声明不符即失败 |
| `version` | 是 | 三段数字;同一 `id` 换版本必须换地址或换哈希,不允许原地覆盖 |

地址与哈希钉在清单里,清单随合集签名分发,改地址必改哈希、改哈希必破签;引擎按清单取回并校验,插件自行落本地存储,细则见[运行时规范](plugin-runtime-spec.md) 5.7 与组织文档 `asset-download-capability.md`。

## 3. 版本与依赖

- `version` 是插件自身版本,只允许三段数字;与 `meta.json` 的 `version`、工程文件的 `version` 是三处独立声明,引擎不比对三者,分发时建议保持一致。
- `engines` 与 dsc-core 版本比较,支持 `^`、`~`、`>=`、`<=`、带 `=` 前缀的精确版本与不带前缀的精确版本,也可写 `*`;只接受单段表达式,`>=1.0.0 <2.0.0` 这类组合范围不合法,安装结果为 `incompatible-version`。
  - `^`:主版本一致且不低于下界。
  - `~`:主版本与次版本一致且不低于下界。
  - `>=`、`<=`、精确版本:按三段数字比较;`=1.0.0` 与 `1.0.0` 等价。
- `engines` 缺省视为不限制。
- 依赖与冲突按插件 id 判定,不比较版本;依赖在安装时必须已存在,在激活时必须已处于 `active`,否则不启用(记录标记 `inactive`,错误字段写入 `missing-dependency:<id>`)。冲突在安装期与启用期都按两个方向检出,均不拒绝安装或启用,处置见[运行时规范](plugin-runtime-spec.md) 3。

## 4. 运行时 meta

`meta.json` 是离线包与市场的识别依据。本模板由构建从工程信息生成,不手工维护;其他项目手工维护时,字段须满足同一 Schema。

| 字段 | 必填 | 规则 |
|:---:|:---:|:---:|
| `name` | 是 | npm 包名:全局包为 `dsc-xxx`,命名空间包为 `@scope/dsc-xxx`;只能用小写字母、数字、点、下划线、连字符,最多 214 字符 |
| `version` | 是 | 三段数字 |
| `license` | 是 | 非空字符串,建议 SPDX 标识符 |
| `description` | 是 | 对象,至少含 `zh-CN` 或 `en-US` 一项,不允许其他语言键 |
| `author` | 是 | 非空字符串 |
| `repo_link` | 是 | 合法 URI |
| `home_page` | 否 | 合法 URI |
| `capabilities` | 否 | 能力名数组,取自能力表;离线包与市场都据此推导清单,重复项会被去重 |
| `mounts` | 否 | 挂载点名数组,取自挂载点表,不得重复;市场推导清单时读它,离线包推导不读 |
| `slots` | 否 | UI 槽位白名单,槽位名取自槽位枚举,不得重复;市场推导清单时读它,离线包推导不读,缺省时由产物导出的清单补齐,回落口径与 `mounts` 一致 |
| `conflicts` | 否 | 预留,引擎当前不读;插件 id 数组,按清单 id 规则取值的冲突声明 |
| `dependencies.dsc` | 是 | 声明兼容的 dsc 版本文本 |
| `attached` | 否 | 预留,引擎当前不读;可选附加资源:`favicon` 为 URI,`intro_image` 为不重复的 URI 数组 |

引擎对离线包的 `meta.json` 只做最小校验:`meta.json` 须是合法 UTF-8 且可解析,`name`、`version`、`author` 非空,`version` 为三段数字,`dependencies.dsc` 存在时须为单段版本范围,任一不满足按 `invalid-meta` 拒绝。构建时按 [运行时 meta Schema](../schemas/runtime/meta.json) 做完整自校验,比引擎更严,便于尽早发现问题。

五条与清单的关系:

- `meta.json` 的 `capabilities` 用于推导安装清单,与插件市场使用同一 id 规则;缺该字段、`capabilities` 不是非空字符串数组,或 `name` 无法收敛出插件 id 时,改用产物导出的 `manifest`;两者都没有时安装结果为 `invalid-manifest`。
- 由 `meta.json` 推导清单时,`dependencies.dsc` 会被当作清单的 `engines` 使用。该字段必须写成清单接受的单段比较表达式:写成 `>=1.0.0 <2.0.0` 这类组合范围时,离线包预检阶段即按 `invalid-meta` 拒绝,原因说明指向该字段,不会走到清单侧;只有清单自身的 `engines` 写成组合范围时才返回 `incompatible-version`。
- `dependencies.dsc` 与清单的 `engines` 是两个字段:前者在 meta Schema 中按 semver 文本描述,后者只接受单段比较表达式。
- `meta.json` 的 `mounts` 与 `slots` 只在市场侧参与推导:市场解析 `meta.json` 时会读它们并写进清单的 `mounts` 与 `slots`;离线包预检不读这两个字段,包里写了也不会进清单,声明仍由产物导出的清单补齐,与没写该字段走同一条路径。
- `meta.json` 的 `conflicts` 是预留字段:派生清单的两条路径(离线包与市场)都不读取它,写在这里不会拦截任何已安装插件;冲突声明须写在产物导出的 `manifest.conflicts` 里,由引擎在安装时按插件 id 判定。

## 5. 作者签名与公钥位置

作者签名是裸公钥分离签名:Ed25519 私钥直接对 `plugin.js` 的原始字节签名,不做摘要预处理;签名文件与被签名文件同名,追加 `.author.sig` 后缀。摘要算法只在需要哈希登记的场景使用——合集的三层清单与 `assets` 块统一以 SHA-512 记录文件或资产的摘要(`sha512` 写 128 位小写十六进制),作者签名的对象始终是原始字节,与摘要登记互不替代。

```bash
# 一次性:生成作者密钥对
openssl genpkey -algorithm ed25519 -out author_secret.pem
openssl pkey -in author_secret.pem -pubout -out author_pub.pem

# 每次发版:对最终落盘的产物签名
openssl pkeyutl -sign -rawin -inkey author_secret.pem -in plugin.js -out plugin.js.author.sig

# 自检
openssl pkeyutl -verify -pubin -inkey author_pub.pem -rawin -in plugin.js -sigfile plugin.js.author.sig
```

| 产物文件 | 说明 |
|:---:|:---:|
| `plugin.js.author.sig` | 对 `plugin.js` 原始字节的签名,64 字节二进制 |
| `author_pub.pem` | 由私钥推导出的公钥,交给合集 |

公钥位置:合集把作者公钥放在 `plugins/<作者>/author_pub.pem`,用于校验该作者全部版本的签名;合集的 L2 清单会登记该文件的 SHA-512 哈希,引擎按哈希校验拉到的公钥,不一致时不采用该公钥,作者签名按未校验处理。

约定与边界:

- 逐字节语义:签名针对最终落盘的字节,签名后不得再改动被签文件;换行从 LF 变成 CRLF 就足以让验签失败。
- 校验失败只提示,不阻断安装;记录标记为校验失败,启动恢复时重新校验。
- 包内同时提供 `plugin.js.author.sig` 与 `author_pub.pem` 才校验;只提供其中一半时按未提供签名处理。
- `meta.json` 的完整性由合集的三层哈希清单覆盖,作者不为它签名:实现没有 `meta.json` 作者签名的验签路径,上游文档与构建也都不产出该签名文件。
- 合集签名 `plugin.js.sig` 与各层 `manifest.json.sig` 由合集用根 CA 签发的 EEC 证书以 CMS 分离签名签发,作者不产出,也不要把 `.author.sig` 改名成 `.sig`。
- 作者签名不需要证书;证书材料由合集维护,插件作者不签发、不续签、不替换任何证书。

## 6. 分发要求

### 6.1 从地址安装

| 项 | 规定 |
|:---:|:---:|
| 地址 | `https` 任意主机,或 `http` 的回环地址 `localhost`、`127.0.0.1`、`[::1]`;其余协议与主机按 `load-failed` 拒绝 |
| 取件 | 引擎用 `fetch` 取产物字节,`cache: 'no-store'`,按 UTF-8 文本保存 |
| 编码 | 取回的字节须能还原成原始字节;不是合法 UTF-8 文本时按 `load-failed` 拒绝,离线包对同一情形按 `corrupt-package` 拒绝(见 6.2) |
| 体积 | 单个产物上限 2 MB(2097152 字节),在线安装与本地离线包共用同一上限,超出按 `package-too-large` 拒绝 |
| 单文件 | 拆分出来的 chunk 与相对路径资源无法解析,第三方依赖必须内联 |
| 更新 | 卸载后重新安装;启动恢复只用安装时保存的代码,不会重新取件 |

跨源分发是取件阶段的普通跨源请求:

| 部署形态 | 托管方要求 | 结果 |
|:---:|:---:|:---:|
| 与页面同源 | 无需额外响应头 | 正常取件 |
| 与页面跨源 | 响应必须带 `Access-Control-Allow-Origin`,值为 `*` 或页面来源 | 缺该头时取件被拒绝 |

取件默认不携带凭证,因此 `Access-Control-Allow-Origin: *` 即可满足要求,不需要 `Access-Control-Allow-Credentials`。不满足时安装结果为 `artifact-unreachable`,界面提示产物地址请求不到,原始错误只写入引擎日志与浏览器控制台。

托管侧经验:GitHub Pages 对资源返回 `Access-Control-Allow-Origin: *`,一般可直接跨源加载;对象存储与多数 CDN 默认不返回该头,需要在存储桶或 CDN 侧配置 CORS 规则;不确定时用 `curl -I <产物地址>` 查看响应头里有没有该字段。

### 6.2 离线包

| 包格式 | 产物位置 | 说明 |
|:---:|:---:|:---:|
| zip | 包根目录 | 根目录直接放 `meta.json` 与 `plugin.js`,可选 `plugin.js.author.sig` 与 `author_pub.pem`;子目录内容忽略 |
| tgz(npm 包) | `package/dist/` | 只取该目录下的文件,其余内容忽略 |

zip 的根目录就是产物目录的内容,不能再套一层目录;打包时进入产物目录执行压缩,不要用会带入目录名的压缩方式。tgz 用 `pnpm pack` 或 `npm pack` 生成,工程文件的 `files` 需要包含产物目录。

预检顺序与失败原因:

| 检查 | 失败原因 |
|:---:|:---:|
| 扩展名为 `.zip` 或 `.tgz` | `unsupported-package` |
| 压缩包可解压 | `corrupt-package` |
| 存在 `meta.json` | `missing-meta` |
| 存在 `plugin.js` | `missing-plugin` |
| `plugin.js` 不超过 2 MB | `package-too-large` |
| `meta.json` 是合法 UTF-8,可解析,`name`、`version`、`author` 非空,版本为三段数字,`dependencies.dsc` 为单段表达式 | `invalid-meta` |
| `plugin.js` 是可还原的 UTF-8 文本 | `corrupt-package` |
| 作者签名材料齐全时验签通过 | 不拒绝,记录标记为校验失败 |

同 id 已存在时拒绝安装,原因为 `duplicate`。离线包只校验作者签名,合集签名与三层哈希清单不在包内校验。

模板产物里的 `MUST_PLUSH_WITH_PACKAGE` 是模板自身的分发约定,不是宿主要求:宿主的离线包只识别 `meta.json`、`plugin.js` 与两个签名材料文件,其余文件被忽略。

### 6.3 分发前自检

```bash
pnpm run type                   # 类型检查
node scripts/validate-specs.mjs # 清单与 meta 的 Schema 自检
pnpm run build                  # 产出 plugin.js、meta.json,可选作者签名
```

构建脚本只打印产物体积,不与 2 MB 上限比对,也不会因体积让构建失败;超限产物照样产出,要到宿主安装时才按 `package-too-large` 拒绝(见 6.1 与 6.2)。

构建完成后在浏览器控制台执行一次 `import('https://你的地址/plugin.js')`,确认没有语法错误与缺失依赖;再在宿主的插件面板里装一次,确认激活、日志与停用都正常。

## 7. 用户告知

插件运行在用户浏览器中,可以读取当前会话的可见字段(见[运行时规范 5.1](plugin-runtime-spec.md#51-可见数据范围)),不能读取 API Key、附件原件、请求快照与其他插件的数据。分发时必须提示用户只安装信任来源的插件,并说明插件会读写哪些数据。

## 8. 校验方式

| 文档 | Schema |
|:---:|:---:|
| 插件清单 | [schemas/manifest/plugin-manifest.schema.json](../schemas/manifest/plugin-manifest.schema.json) |
| 运行时 meta | [schemas/runtime/meta.json](../schemas/runtime/meta.json) |

```bash
node scripts/validate-specs.mjs                          # 自检
node scripts/validate-specs.mjs <清单文件>                # 校验单个清单
node scripts/validate-specs.mjs <meta.json> --schema meta # 校验单个运行时 meta
```

Schema 是静态校验,最终判定仍由宿主在安装时给出。清单 Schema 未列出的字段会被拒绝,宿主的清单读取只取已定义字段并忽略其余字段。

## 历史版本列表

本文档只维护最新版本,历史版本由本节的链接负责导航。

本节为占位:仓库当前还没有发布标签,首个版本发布后在此按版本倒序列出,每个条目指向该版本标签下的本文档。
