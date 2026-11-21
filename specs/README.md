# dsc 插件规范区

本目录与 [schemas/](../schemas/runtime/meta.json) 一起收拢 dsc 插件的运行时规范、开发规范与 JSON Schema。规范内容来自 DeepSeek-Chat-Enhanced 的 `dsc-plugin-engine` 实现与其开发文档,正文随本仓库从 dsc-plugin-template 复制保留,本仓库只做收拢、机器可校验化与本地校验,不新增规则;唯一例外是插件联网口径(见下节「权威来源与引用约定」),那是产品裁定,不是对实现的记述。

## 内容

| 文件 | 内容 |
|:---:|:---:|
| [plugin-runtime-spec.md](plugin-runtime-spec.md) | 运行时规范:产物形态与体积上限、导出契约、生命周期与超时、能力与限流、上下文成员(可见范围、事件、提示与设置、插件数据、大体积数据与 IndexedDB、联网与外源请求)、安全边界、错误降级 |
| [plugin-develop-spec.md](plugin-develop-spec.md) | 开发规范:清单字段与校验、版本与依赖、运行时 meta、作者签名与公钥位置、分发要求 |
| [spec-version.json](spec-version.json) | 规范版本与 Schema 路径,供其他仓库引用时锁定 |
| [../schemas/manifest/plugin-manifest.schema.json](../schemas/manifest/plugin-manifest.schema.json) | 清单 Schema |
| [../schemas/runtime/meta.json](../schemas/runtime/meta.json) | 运行时 meta Schema |
| [../schemas/examples/manifest.valid.json](../schemas/examples/manifest.valid.json) | Schema 的通过样例与反例 |
| [dsc-plugin-template 的 examples/session-digest](https://github.com/omds-chat/dsc-plugin-template/blob/main/examples/session-digest/index.ts) | 先行代码实现:清单导出、激活与停用、能力申请(示例留在上游仓库,本仓库不复制) |
| [../scripts/validate-specs.mjs](../scripts/validate-specs.mjs) | 零依赖校验脚本 |

## 权威来源与引用约定

- 权威来源是 `dsc-plugin-engine` 的实现:清单校验、能力表、限流、加载与签名都以实现为准;实现与文档不一致时以实现为准,并在「已知差异」里保留两侧口径。
- 规范的源头是 dsc-plugin-template 的 `specs/`:需要引用规范版本时按上游的 `spec_version` 选定,并用 git 标签或提交固定,不要引用浮动分支;文档内的链接一律指向最新文件,不在链接 URL 里写死标签名。Schema 路径以 [spec-version.json](spec-version.json) 的 `schemas` 字段为准。
- 上游实现变更后,先在上游仓库改规范与 Schema,再升 `spec_version`,最后把副本同步到本仓库;`dsc_core` 字段记录对应的宿主版本。
- 本仓库只保留副本用于本地校验,不是规范的发布源;对外引用请指向 dsc-plugin-template。
- 跨仓库引用一律用在线 URL,形如 `https://github.com/omds-chat/dsc-plugin-template/blob/main/specs/plugin-runtime-spec.md`,不写相对路径。相对路径只在发出链接的仓库里成立,到了引用方仓库会指向错误位置,克隆、镜像与离线阅读都会失效。
- 本仓库内部互相引用时才用相对路径,便于本地预览与链接检查;本仓库引用其他仓库的文档同样用在线 URL,不写 `../其他仓库/...`。
- 插件联网采用产品裁定:插件联网必须受插件引擎管控,由引擎暴露的接口提供联网能力,细则见[运行时规范](plugin-runtime-spec.md) 5.5。该条不是对 `dsc-plugin-engine` 现有行为的记述:插件与宿主同源、跑在页面主线程,引擎在技术上无法阻止插件调用全局 `fetch`,因此按契约约束写入,违反属于不合规,会在收录审核与运行日志里被指出。它也不是「上游文档与实现不一致」,所以不列入下文「已知差异」表。

## 校验

```bash
node scripts/validate-specs.mjs                          # 自检 Schema、样例与本仓库 meta 数据
node scripts/validate-specs.mjs <清单文件>                # 校验单个清单
node scripts/validate-specs.mjs <meta.json> --schema meta # 校验单个运行时 meta
```

脚本只用 Node 内置模块,不联网、不安装依赖。自检覆盖:规范版本与 Schema 路径一致、Schema 结构可用、正例通过、反例被拒绝、`package.json` 派生的 meta 通过运行时 meta Schema。若磁盘上存在构建产出的 `meta.json`,也会一并校验。

## 已知差异

以下差异来自上游文档、Schema 与实现的对照,本规范按实现取舍并在此留痕,不修改上游文档。本表只保留当前仍然成立的条目:已经收敛的差异直接删除,不留历史,每行的「本规范取舍」都对应正文里的具体章节。

| 主题 | 上游文档口径 | 实现口径 | 本规范取舍 |
|:---:|:---:|:---:|:---:|
| 体积上限的记述来源 | 上游产物规范的备注仍写模板 specs 按旧上限记述、本仓库已提升到 2 MB,并留了发布前人工复核 | 实现、运行时规范与开发规范统一为 2 MB(2097152 字节),宿主提示文案由字节常量派生 | 按 2 MB 统一记述,该备注待上游更新 |
| 离线包预检里体积检查的位置 | 引擎说明与用户指南的预检表把「`plugin.js` 不超过 2 MB」列在 `meta.json` 解析与 UTF-8 检查之后 | 取到 `plugin.js` 后立即比对体积,早于 `meta.json` 解码与解析;体积与清单同时不合规时报 `package-too-large` | 按实现排序,写进 [开发规范](plugin-develop-spec.md) 6.2 |
| `meta.json` 的 UTF-8 要求 | 预检表只写「可解析」「`name`、`version`、`author` 非空」「版本为三段数字」 | 先按严格 UTF-8 解码,非法字节序列按 `invalid-meta` 拒绝,不会进入字段校验 | 写进 [开发规范](plugin-develop-spec.md) 4 与 6.2 的 `invalid-meta` 口径 |
| `meta.json` 的 `description` 形态 | 运行时 meta Schema 与[开发规范](plugin-develop-spec.md) 4 要求 `description` 为双语对象,至少含 `zh-CN` 或 `en-US` 一项 | 引擎接受字符串形式的 `description`,两种语言按同一内容处理;字段缺失也不拒绝,按空串处理 | Schema 与引擎分开写:Schema 从严,引擎的最小校验单独列出 |
| `meta.json` 的 `mounts` | 引擎用户指南写「`meta.json` 写了 `mounts` 就原样带进清单」 | 离线包预检只取 `capabilities` 与 `dependencies.dsc`,不读 `mounts`;市场解析 `meta.json` 时读它并写进清单的 `mounts`,缺省时由产物导出的清单补齐 | 按实现分别记述两条安装路径,写进[开发规范](plugin-develop-spec.md) 4 |
| `meta.json` 的 `conflicts` | 上游只在清单层描述 `conflicts`,清单与用户指南都把它当作清单字段 | 由 `meta.json` 推导清单的两条路径都不读 `conflicts`,该字段不影响安装结果 | Schema 里保留该字段并标注「预留,引擎当前不读」,写进[开发规范](plugin-develop-spec.md) 4 |
| 能力 `provider:run` | 清单 Schema 与运行时 meta Schema 的能力枚举只到 `provider:source`,没有 `provider:run` | 引擎能力表已含 `provider:run`(`context.provider.run`,10 次/10 秒,超时 15 秒),是供应端点执行侧的能力,与 `provider:source` 分开授权 | 本仓库的清单类型按实现收录 `provider:run`;上游 Schema 枚举待同步,同步前用本仓库 Schema 校验含 `provider:run` 的清单会误报 |
| 版本范围的写法 | 运行时 meta Schema 把 `dependencies.dsc` 描述为 semver range,`>=1.0.0 <2.0.0` 这类组合范围也能通过 Schema | 清单 `engines` 与离线包的 `dependencies.dsc` 都只接受单段比较表达式;组合范围在离线包预检阶段按 `invalid-meta` 拒绝,清单侧的 `engines` 才按 `incompatible-version` 拒绝 | 两个字段分别说明,并提示 `dependencies.dsc` 也要写成单段表达式 |
| 带 `=` 前缀的精确版本 | 版本范围只写「支持 `^`、`~`、`>=`、`<=` 与精确版本」,未提等号前缀 | 范围规则接受 `=1.0.0`,与 `1.0.0` 等价,按三段数字比较 | [开发规范](plugin-develop-spec.md) 3 补上 `=` |

## 语言

规范正文以中文维护,与上游文档语言一致;仓库根目录的 `README.md` 与 `README.en-US.md` 保持中英两版同步。

## 历史版本列表

本文档只维护最新版本,历史版本由本节的链接负责导航。

本节为占位:仓库当前还没有发布标签,首个版本发布后在此按版本倒序列出,每个条目指向该版本标签下的本文档。
