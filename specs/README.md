# dsc 插件规范区

本目录与 [schemas/](../schemas/runtime/meta.json) 一起收拢 dsc 插件的运行时规范、开发规范与 JSON Schema。规范内容来自 DeepSeek-Chat-Enhanced 的 `dsc-plugin-engine` 实现与其开发文档,正文随本仓库从 dsc-plugin-template 复制保留,本仓库只做收拢、机器可校验化与本地校验,不新增规则;唯一例外是插件联网口径(见下节「权威来源与引用约定」),那是产品裁定,不是对实现的记述。

## 内容

| 文件 | 内容 |
|:---:|:---:|
| [plugin-runtime-spec.md](plugin-runtime-spec.md) | 运行时规范:产物形态与体积上限、导出契约、生命周期与超时、能力与限流、上下文成员(可见范围、事件、提示与设置、插件数据、大体积数据与 IndexedDB、联网与外源请求、资产读取与下载、请求前补丁、插件设置表面、UI 槽位、供应端点与按端点执行)、安全边界、错误降级 |
| [plugin-develop-spec.md](plugin-develop-spec.md) | 开发规范:清单字段与校验、UI 槽位白名单、资产声明块、版本与依赖、运行时 meta、作者签名与公钥位置、分发要求 |
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

规范正文与 Schema 已随上游 spec_version 1.1.0 逐字同步,`specs/` 两份规范、`spec-version.json` 与 `schemas/manifest`、`schemas/runtime` 及其样例都是上游原样副本,与模板的差异条目已清零。本表只按「实现/本仓 vs 上游文档」的单向口径保留本仓真实存在的本地差异:本仓与实现的取舍写在一侧,不修改上游文档;上游文件指 dsc-plugin-template 的对应文件,行号为当前正文位置。

| 主题 | 上游文档口径 | 实现/本仓口径 | 本仓处置 |
|:---:|:---:|:---:|:---:|
| 来源描述文件的归属 | 上游规范区不含来源描述文件:[spec-version.json](https://github.com/omds-chat/dsc-plugin-template/blob/main/specs/spec-version.json) 4-7 行的 `schemas` 只登记清单与运行时 meta 两份 Schema,上游 `schemas/` 目录也没有 descriptor 条目 | 本仓的来源描述由 [docs/spec.md](../docs/spec.md) 承担权威口径,结构契约在 [schemas/source-descriptor.schema.json](../schemas/source-descriptor.schema.json),五份方言样例为 [schemas/examples/](../schemas/examples/) 下的 `*.descriptor.json`,校验脚本对它们单独成段([scripts/validate-specs.mjs](../scripts/validate-specs.mjs) 第 3、4 段) | 保留为本仓自有资产,不进入上游副本,也不反向要求上游收录 |

## 语言

规范正文以中文维护,与上游文档语言一致;仓库根目录的 `README.md` 与 `README.en-US.md` 保持中英两版同步。

## 历史版本列表

本文档只维护最新版本,历史版本由本节的链接负责导航。

本节为占位:仓库当前还没有发布标签,首个版本发布后在此按版本倒序列出,每个条目指向该版本标签下的本文档。
