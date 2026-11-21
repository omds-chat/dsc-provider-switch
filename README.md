# dsc-provider-switch

[简体中文] | [English](README.en-US.md)

dsc-provider-switch 是一个 dsc 插件,按能力维度为每项模型能力挑选供应端点:插件内置三份端点描述,激活时经 `context.provider.registerSource` 登记给宿主,并为本插件自己发起调用提供文本生成与模型列表两条 `context.provider.run` 封装。每份描述声明该端点支持哪些模型能力(文本生成、系统提示词、思考、视觉输入等),端点按能力维度对号入座,用哪一条由宿主决定。插件还经 `settings:surface` 登记设置表面:端点启停、API Key 与自定义兼容端点 baseUrl 都在宿主设置页填写。

文档索引见 [docs/README.md](docs/README.md);机制定稿与取舍理由见 [docs/design/provider-sources.md](docs/design/provider-sources.md)。

## 定位

| 项 | 说明 |
|:---:|:---:|
| 面向 | 需要为每项模型能力挑选供应端点的 dsc 用户与宿主 |
| 登记 | 激活时把内置端点描述经 `context.provider.registerSource` 登记给宿主,并把设置字段描述经 `settings:surface` 登记给宿主设置页 |
| 封装 | `runTextGenerate` 与 `runModelsList`,把与协议无关的请求对照描述校验、按设置过滤停用端点后交给 `context.provider.run` |
| 不做 | 不改写宿主的任何一次会话请求;不做端点选择;不读、不存、不传任何密钥 |

## 内置端点

内置三份描述按优先级排列,顺序即激活时的注册顺序;JSON 副本在 [schemas/examples/](schemas/examples/) 下,测试断言内存对象与副本逐字相等,两边不会各自漂移。

| 顺序 | id | 方言 | 基址 | 对话路径 | 能力数 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `deepseek-anthropic` | `anthropic-compatible` | `https://api.deepseek.com` | `/anthropic/v1/messages` | 3 |
| 2 | `openai` | `openai-compatible` | `https://api.openai.com/v1` | `/chat/completions` | 5 |
| 3 | `anthropic` | `anthropic-compatible` | `https://api.anthropic.com` | `/v1/messages` | 7 |

三个端点各自的能力覆盖:

| 能力维度 | deepseek-anthropic | openai | anthropic |
|:---:|:---:|:---:|:---:|
| `text:generate` 文本生成 | 有 | 有 | 有,`max_tokens` 必填 |
| `prompt:system` 系统提示词 | 有,顶层字段 | 有,`system` 消息 | 有,顶层字段 |
| `reasoning:think` 思考 | 有,`type-toggle` | 有,`effort-level` | 有,`type-toggle` 加思考预算 |
| `vision:image` 图像输入 | 无 | 有 | 有,支持 base64、URL 与 file-id |
| `document:read` 文档输入 | 无 | 无 | 有,支持 base64 与 file-id |
| `tool:web-search` 联网搜索 | 无 | 有,请求侧工具 | 有,服务端工具 |
| `tool:read-url` 读取网页 | 无 | 无 | 有,服务端工具 |

DeepSeek 为什么取 `anthropic-compatible`、方言到引擎描述的转换规则,见 [docs/design/provider-sources.md](docs/design/provider-sources.md) 第二、三节的对照表;引擎执行层本版只有 `anthropic-messages` 一条线路,openai 端点登记后暂不可调用,见设计文档第六节的缺口清单。

## 使用方式

- **安装后自动注册端点。** 插件激活即按内置顺序登记三个端点,声明不发起任何网络请求;插件拿不到密钥,密钥只由引擎在执行时读取。
- **在宿主设置页配置。** 已安装插件列表 → 点插件名进详情页 → 宿主按描述渲染表单。每个内置端点一个「启用」开关与一个 API Key 输入(只写不读,是否已配置只有宿主知道);「自定义 OpenAI 兼容端点 baseUrl」与「自定义 Anthropic 兼容端点 baseUrl」两个可选输入,留空即不注册自定义端点。设置值由宿主落盘,保存后生效。
- **两条封装供调用方使用。** `runTextGenerate` 校验参数声明、取值范围与能力支持后组装载荷,失败抛带 `code` 的 `SourceAssemblyError`;执行前每次读取设置过滤停用端点(宿主本轮没有变更推送,插件在每次 run 前重新读设置),被停用的端点按 `endpoint-disabled` 拒绝,不发请求、不花额度。`runModelsList` 把模型清单收敛为模型 id 数组。引擎错误不吞、不重试、不降级,原样抛给调用方:没填 Key 的端点在执行时报 `credential-missing`。
- **自定义端点的注册时机。** 自定义端点按激活时的设置值注册;设置页改动后,执行侧的启停与描述选择立即跟随设置,但引擎注册表里的登记要等插件重新激活,缺口清单见 [docs/design/provider-sources.md](docs/design/provider-sources.md) 第六节。

## 目录结构

```text
dsc-provider-switch/
├── .env.example              # 本地联调地址模板
├── .gitattributes            # 全仓库统一 LF
├── .gitignore
├── .npmrc
├── COPYRIGHT                 # 版权声明
├── LICENSE
├── README.md                 # 面向开发者,中文主文本
├── README.en-US.md           # 英文版,与 README.md 同步维护
├── build.mjs                 # 构建入口:打包与 meta 自校验
├── package.json              # 工程信息,meta.json 的数据来源
├── pnpm-workspace.yaml       # pnpm 12 的构建脚本白名单
├── tsconfig.json
├── docs/
│   ├── README.md             # 文档索引
│   ├── spec.md               # 来源描述文件规范
│   ├── doubao-ark-research.md # 豆包供应端点调研
│   ├── schema-audit-report.md # 草案审计结论
│   ├── draft-source-descriptor.json # 草案:来源描述样例
│   ├── source-descriptor.schema.draft.json # 草案:来源描述 Schema
│   └── design/
│       └── provider-sources.md # 供应端点设计:方言、注册、封装与缺口
├── schemas/                  # 来源描述、清单与运行时 meta 的 Schema 及样例
├── scripts/
│   ├── test/
│   │   ├── ts-hooks.mjs      # 让测试直接加载 .ts 源码的解析钩子
│   │   ├── sources.test.ts   # 内置描述、转换与封装的测试
│   │   └── settings.test.ts  # 设置表面、启停过滤与无 Key 判定的测试
│   └── validate-specs.mjs    # 零依赖规范校验脚本
├── specs/                    # 规范副本:运行时规范、开发规范与版本信息
└── src/
    ├── index.ts              # 激活与停用入口,激活时注册内置端点并登记设置表面
    ├── manifest.ts           # 运行时清单
    ├── types.ts              # 契约类型
    └── sources/
        ├── descriptor.ts     # 方言描述转引擎 CoreSourceDescriptor
        ├── register.ts       # 内置端点注册
        ├── run.ts            # 文本生成与模型列表两条封装
        ├── settings.ts       # 设置表面:字段描述、启停与自定义端点读取
        └── validate.ts       # 注册前的运行时校验
```

## 开发命令

| 命令 | 作用 |
|:---:|:---:|
| `pnpm run build` | 构建产物到 `dist/`:打包 `plugin.js`、从 `package.json` 生成并自校验 `meta.json`、写入 `MUST_PLUSH_WITH_PACKAGE` 标记 |
| `pnpm run type` | 运行 `tsc --noEmit` 做类型检查 |
| `pnpm run test` | 运行 `node:test` 的零依赖测试,直接加载 `src` 下的 TypeScript 源码 |
| `pnpm run validate:specs` | 校验规范区的 Schema、正反例样例与本仓库 meta 数据 |

测试与校验零依赖、离线可跑,不联网、不安装依赖;跑测试需要 Node 22.18 或更高版本(内置类型剥离)。
