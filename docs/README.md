# 文档索引

> 本文件是本仓库全部文档的索引入口:按行找到文档,按「什么时候需要读」决定先读哪一份,按「冲突时以谁为准」判断结论不一致时听谁的。
> 本文件只写文档的职责与定位,不复制文档正文,也不记录文档的写作时间或维护进度。

## 一、文档清单

| 文档 | 职责一句话 | 主要内容 | 什么时候需要读 | 主要读者 |
|:---:|:---:|:---:|:---:|:---:|
| [docs/design/provider-sources.md](design/provider-sources.md) | 供应端点注册与调用封装的设计定稿与缺口 | 定位与边界、内置端点与方言选择理由、方言到引擎描述的转换、注册与运行时校验、两条封装、缺口清单(设置控件待宿主表面)、与宿主实现的对齐依据 | 改内置端点、改转换映射、改封装行为,或判断宿主能力是否够用时 | 维护者、Agent |
| [docs/spec.md](spec.md) | 来源描述文件规范 | 结构版本、顶层字段、能力逐项说明、三家差异对照、两处刻意取舍、校验方式、版本演进规则 | 改 Schema、改描述示例、改校验脚本,或判断某字段怎么填时 | 维护者、Agent、引用方 |
| [specs/README.md](../specs/README.md) | 规范区的索引与差异留痕 | 规范文件清单、权威来源与引用约定、校验命令、与宿主实现的已知差异 | 引用规范、核对两侧口径、运行规范校验时 | 贡献者、维护者、Agent |
| [specs/plugin-runtime-spec.md](../specs/plugin-runtime-spec.md) | 插件运行时规范(上游副本) | 产物形态、导出契约、生命周期与超时、能力与限流、上下文成员、安全边界、错误降级 | 写运行时行为、申请能力、对接宿主时 | 贡献者、Agent |
| [specs/plugin-develop-spec.md](../specs/plugin-develop-spec.md) | 插件开发规范(上游副本) | 清单字段与校验、版本与依赖、运行时 meta、作者签名与公钥位置、分发要求 | 改清单、改构建产物、改 meta 生成时 | 贡献者、维护者 |

- 上游副本与 Schema 的对应关系由 [specs/spec-version.json](../specs/spec-version.json) 登记;JSON Schema 与样例属于机器可校验的资产,不按文档计入本表,由 [specs/README.md](../specs/README.md) 统一收拢与说明。
- 来源描述的三家方言示例与豆包调研分别放在 `schemas/examples/` 与 [docs/doubao-ark-research.md](doubao-ark-research.md);草案审计结论见 [docs/schema-audit-report.md](schema-audit-report.md)。
- `LICENSE` 与 `COPYRIGHT` 不属于说明性文档,不列入本表。
- 本仓库还没有面向人的根 `README.md` 与用户说明 `README.user.md`,入口说明暂由本索引与设计文档承担;缺口已记入设计文档第六节。

## 二、冲突时以谁为准

结论不一致时,按下面的顺序取准据,序号小的优先:

| 顺序 | 准据 | 含义 | 两侧不一致时怎么办 |
|:---:|:---:|:---:|:---:|
| 1 | 宿主 `dsc-plugin-engine` 的实现 | 清单校验、能力表、限流、供应端点注册表与执行的实际行为 | 以实现为准;文档与规范都按实现修正,上游差异记入 specs/README.md 的「已知差异」 |
| 2 | 本仓库的规范与 Schema | 宿主实现的可校验副本:`specs/` 两份规范、`schemas/manifest`、`schemas/runtime`、`specs/spec-version.json`;来源描述的口径以 docs/spec.md 为准 | 以规范为准;差异记入「已知差异」,不修改上游文档 |
| 3 | 脚本与测试的行为 | [scripts/validate-specs.mjs](../scripts/validate-specs.mjs)、[scripts/test/](../scripts/test/) 下的测试、构建脚本的校验结果 | 脚本与规范冲突时以规范为准并修脚本;脚本拒绝而文档放行时,先按规范定口径,再同时修文档与脚本 |
| 4 | 设计文档 | [docs/design/provider-sources.md](design/provider-sources.md) 中的已定约束 | 与规范冲突时规范优先;与源码、测试冲突时以设计文档为准,由实现与测试对齐(缺口条目除外) |
| 5 | 本索引 | 只负责导航与上述优先级说明,不含机制结论 | 与任何被指向的文档冲突时,以被指向的文档为准,并修正本索引 |

补充一条:设计文档里标注「缺口」与「未定稿」的条目不是准据,它们是待定问题与缺口记录,不能引用其中一种可能当结论。

## 三、文档分层

| 分层 | 文档 | 用途 |
|:---:|:---:|:---:|
| 权威与规范层 | [docs/spec.md](spec.md)、`specs/` 两份规范副本、`schemas/` 三份 Schema | 定义契约本身:来源描述的结构与语义、插件清单与运行时 meta 的机器可校验定义 |
| 校验层 | [scripts/validate-specs.mjs](../scripts/validate-specs.mjs)、`schemas/examples/` 的正反例、`build.mjs` 的自校验 | 让契约可执行:Schema 自检、正反例判定、meta 生成与校验 |
| 维护者文档 | [docs/design/provider-sources.md](design/provider-sources.md) | 记录机制定稿与取舍理由:为什么这样定、排除了哪些做法、还差哪块宿主能力 |
| Agent 执行文档 | 本索引、设计文档、docs/spec.md、`specs/` 与 `schemas/` | Agent 的执行依据:先按本索引找文档,再按设计文档的已定约束与规范、Schema 的硬规则动手,改完用 `scripts/` 下的校验与测试自查 |

- 设计文档是唯一记录「为什么这样定」的地方,规范与索引不复述取舍理由,只给结论与用法。
- 新增文档时先判断它属于哪一层,再决定写多深;机制变更当轮更新对应文档,不留「文档这么写、代码那么做」的状态。

## 四、维护约定

- 新增或删除文档时,当轮更新本文档第一节的主表:补行、删行、改「职责一句话」与「什么时候需要读」,不留死链。
- 规范变化先改上游 dsc-plugin-template,再把副本同步到本仓库;来源描述的口径变化先改 docs/spec.md,再同步 Schema 与脚本。
- 本文档只写职责与定位,不复制正文;不写时间戳、不写维护进度与计划,也不引入 emoji。
- 目录结构保持不变:设计类文档放在 `docs/design/`,本索引固定在 `docs/README.md`。
- 本索引与文档正文不一致时,以文档正文为准,并修正本索引。
