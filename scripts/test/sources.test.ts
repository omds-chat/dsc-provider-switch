/**
 * 内存夹具测试:不联网、不依赖宿主。
 * 覆盖四块:端点注册(激活时的登记)、描述校验(运行时校验器)、
 * text:generate 组装(载荷对照描述逐项校验)与 models.list(结果收敛为 id)。
 * 引擎侧的执行、凭证与合并不在本仓库的测试范围,由宿主仓库的夹具覆盖。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  activate,
  ANTHROPIC_SOURCE,
  assembleTextGeneratePayload,
  BUILTIN_SOURCES,
  DEEPSEEK_ANTHROPIC_SOURCE,
  deactivate,
  OPENAI_SOURCE,
  registerBuiltinSources,
  runModelsList,
  runTextGenerate,
  toEngineDescriptor,
  validateSourceDescriptor,
} from '../../src/index.ts'
import type {
  EngineSourceDescriptor,
  PluginContext,
  ProviderRunResult,
  SourceDescriptor,
  TextGeneratePayload,
} from '../../src/types.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 读取仓库内的 JSON 文档 */
const readRepoJson = (relativePath: string): unknown =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8') as string)

/* ---------- 夹具:记录 registerSource 与 run 的上下文 ---------- */

interface RecordedCall {
  readonly capability: string
  readonly payload: unknown
}

interface FakeContext {
  readonly context: PluginContext
  readonly registered: EngineSourceDescriptor[]
  readonly runs: RecordedCall[]
  readonly logs: string[]
  /** run 的返回队列;空队列返回一个只产出一条 text 事件的流 */
  runResults: ProviderRunResult[]
  /** run 的抛错队列;非空时 run 直接抛出 */
  runErrors: unknown[]
  /** settings.values() 的返回值;测试中直接改写这个对象 */
  readonly settingValues: Record<string, string | number | boolean>
}

const createFakeContext = (): FakeContext => {
  const registered: EngineSourceDescriptor[] = []
  const runs: RecordedCall[] = []
  const logs: string[] = []
  const runResults: ProviderRunResult[] = []
  const runErrors: unknown[] = []
  const settingValues: Record<string, string | number | boolean> = {}

  const streamResult = async function* () {
    yield { type: 'text', text: 'hi' }
    yield { type: 'end', stopReason: 'end_turn' }
  }

  const context: PluginContext = {
    id: 'dsc-provider-switch',
    version: '0.1.0',
    log: (message) => {
      logs.push(message)
    },
    settings: {
      register: () => () => {},
      values: () => ({ ...settingValues }),
    },
    provider: {
      registerSource: (descriptor) => {
        registered.push(descriptor)
      },
      run: async (capability: string, payload: unknown) => {
        runs.push({ capability, payload })
        const runError = runErrors.shift()
        if (runError !== undefined) {
          throw runError
        }
        const result = runResults.shift()
        if (result !== undefined) {
          return result
        }
        return { kind: 'stream', events: streamResult() }
      },
    },
  }

  return { context, registered, runs, logs, runResults, runErrors, settingValues }
}

/** 每个用例从未激活开始,避免模块级激活状态互相影响 */
const reset = (): void => {
  deactivate()
}

/* ---------- 1. 内置描述与 JSON 副本 ---------- */

test('内置描述与 schemas/examples 的 JSON 副本逐字相等', () => {
  const pairs: [SourceDescriptor, string][] = [
    [DEEPSEEK_ANTHROPIC_SOURCE, 'schemas/examples/deepseek-anthropic.descriptor.json'],
    [OPENAI_SOURCE, 'schemas/examples/openai.descriptor.json'],
    [ANTHROPIC_SOURCE, 'schemas/examples/anthropic.descriptor.json'],
  ]
  for (const [builtin, filePath] of pairs) {
    assert.deepEqual(builtin, readRepoJson(filePath), '副本不一致: ' + filePath)
  }
})

test('内置端点按 deepseek、openai、anthropic 的顺序排列', () => {
  assert.deepEqual(
    BUILTIN_SOURCES.map((descriptor) => descriptor.id),
    ['deepseek-anthropic', 'openai', 'anthropic'],
  )
})

/* ---------- 2. 描述校验 ---------- */

test('validateSourceDescriptor: 三份内置描述全部通过', () => {
  for (const descriptor of BUILTIN_SOURCES) {
    const result = validateSourceDescriptor(descriptor)
    assert.deepEqual(result, { ok: true, dialect: descriptor.format })
  }
})

test('validateSourceDescriptor: schemas/examples 里的全部描述样例通过', () => {
  const files = ['anthropic', 'deepseek', 'deepseek-anthropic', 'doubao', 'openai']
  for (const name of files) {
    const document = readRepoJson('schemas/examples/' + name + '.descriptor.json')
    const result = validateSourceDescriptor(document)
    assert.equal(result.ok, true, '样例应通过校验: ' + name)
  }
})

/** 构造一份基于 deepseek-anthropic 的最小变体,按 patch 覆盖字段 */
const patchedDescriptor = (patch: Record<string, unknown>): SourceDescriptor => {
  const base = structuredClone(DEEPSEEK_ANTHROPIC_SOURCE) as unknown as Record<string, unknown>
  const merge = (target: Record<string, unknown>, patchBody: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(patchBody)) {
      if (value === null) {
        delete target[key]
        continue
      }
      if (typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
        merge(target[key] as Record<string, unknown>, value as Record<string, unknown>)
      } else {
        target[key] = value
      }
    }
  }
  merge(base, patch)
  return base as unknown as SourceDescriptor
}

test('validateSourceDescriptor: 各条规则的反例被拒绝', () => {
  const cases: [string, SourceDescriptor, string][] = [
    ['schemaVersion 不是 1', patchedDescriptor({ schemaVersion: 2 }), 'schemaVersion'],
    ['id 非法', patchedDescriptor({ id: 'DeepSeek_Anthropic' }), 'id'],
    ['format 取值非法', patchedDescriptor({ format: 'claude-compatible' }), 'format'],
    ['base 带尾斜杠', patchedDescriptor({ endpoints: { base: 'https://api.deepseek.com/' } }), 'base'],
    ['stream 与方言不一致', patchedDescriptor({ capabilities: [{ id: 'text:generate', stream: 'sse-openai' }, { id: 'prompt:system', mode: 'top-level-field', field: 'system' }] }), 'stream'],
    ['缺 prompt:system', patchedDescriptor({ capabilities: [{ id: 'text:generate', stream: 'sse-anthropic' }] }), 'prompt:system'],
    ['能力 id 重复', patchedDescriptor({ capabilities: [{ id: 'prompt:system', mode: 'top-level-field', field: 'system' }, { id: 'prompt:system', mode: 'top-level-field', field: 'system' }] }), '重复'],
    ['requiredParams 不在 params 中', patchedDescriptor({ capabilities: [{ id: 'text:generate', stream: 'sse-anthropic', requiredParams: ['topK'] }, { id: 'prompt:system', mode: 'top-level-field', field: 'system' }] }), 'requiredParams'],
    ['limits 的 min 大于 max', patchedDescriptor({ capabilities: [{ id: 'text:generate', stream: 'sse-anthropic', limits: { temperature: { min: 2, max: 1 } } }, { id: 'prompt:system', mode: 'top-level-field', field: 'system' }] }), 'min'],
    ['缺 name', patchedDescriptor({ name: null }), 'name'],
    ['缺 credential', patchedDescriptor({ credential: null }), 'credential'],
    ['多余顶层字段', patchedDescriptor({ permissions: [] }), 'permissions'],
    ['file-id 依赖 files 端点', patchedDescriptor({ capabilities: [{ id: 'vision:image', contentType: 'image', inputs: ['file-id'] }, { id: 'text:generate', stream: 'sse-anthropic' }, { id: 'prompt:system', mode: 'top-level-field', field: 'system' }] }), 'files'],
  ]
  for (const [label, document, needle] of cases) {
    const result = validateSourceDescriptor(document)
    assert.equal(result.ok, false, label + ' 应被拒绝')
    if (!result.ok) {
      assert.ok(
        result.issues.some((item) => (item.code + item.message).includes(needle)),
        label + ' 应给出含 ' + needle + ' 的问题,实际: ' + result.issues.map((item) => item.code + ' ' + item.message).join(' | '),
      )
    }
  }
})

test('validateSourceDescriptor: 非 JSON 输入按 shape 拒绝', () => {
  const result = validateSourceDescriptor('deepseek')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.issues[0]?.code, 'shape')
  }
})

/* ---------- 3. 到引擎描述的转换 ---------- */

test('toEngineDescriptor: 方言映射、路径覆盖与能力清单', () => {
  const engine = toEngineDescriptor(DEEPSEEK_ANTHROPIC_SOURCE)
  assert.equal(engine.id, 'deepseek-anthropic')
  assert.equal(engine.label, 'DeepSeek 官方(Anthropic 形态)')
  assert.equal(engine.format, 'anthropic-messages')
  assert.equal(engine.baseUrl, 'https://api.deepseek.com')
  assert.deepEqual([...engine.capabilities], ['text.generate', 'models.list'])
  assert.deepEqual(engine.endpoints?.['text.generate'], '/anthropic/v1/messages')
  assert.deepEqual(engine.endpoints?.['models.list'], '/models')
})

test('toEngineDescriptor: openai 兼容方言映射到 openai-chat', () => {
  const engine = toEngineDescriptor(OPENAI_SOURCE)
  assert.equal(engine.format, 'openai-chat')
  assert.equal(engine.baseUrl, 'https://api.openai.com/v1')
  assert.deepEqual(engine.endpoints?.['text.generate'], '/chat/completions')
})

test('toEngineDescriptor: 展示名缺失中文时用英文补齐', () => {
  const descriptor = patchedDescriptor({ name: { 'zh-CN': null, 'en-US': 'OpenAI official' } })
  assert.equal(toEngineDescriptor(descriptor).label, 'OpenAI official')
})

/* ---------- 4. 端点注册 ---------- */

test('registerBuiltinSources: 按顺序登记三份内置描述并写日志', () => {
  reset()
  const { context, registered, logs } = createFakeContext()
  const ids = registerBuiltinSources(context)
  assert.deepEqual(ids, ['deepseek-anthropic', 'openai', 'anthropic'])
  assert.equal(registered.length, 3)
  assert.deepEqual(
    registered.map((descriptor) => descriptor.format),
    ['anthropic-messages', 'openai-chat', 'anthropic-messages'],
  )
  assert.ok(logs.every((message) => message.includes('已注册端点')))
})

test('activate: 激活即注册,重复激活跳过', () => {
  reset()
  const first = createFakeContext()
  activate(first.context)
  assert.equal(first.registered.length, 3)

  const second = createFakeContext()
  activate(second.context)
  assert.equal(second.registered.length, 0)
  assert.ok(second.logs.some((message) => message.includes('already active')))
})

/* ---------- 5. text:generate 组装 ---------- */

test('组装: 四个参数按描述放行并进入载荷', () => {
  const payload = assembleTextGeneratePayload(DEEPSEEK_ANTHROPIC_SOURCE, {
    model: 'deepseek-chat',
    system: '你是助手',
    messages: [{ role: 'user', content: '你好' }],
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['END'],
  })
  assert.deepEqual(payload, {
    model: 'deepseek-chat',
    system: '你是助手',
    messages: [{ role: 'user', content: '你好' }],
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['END'],
  })
})

test('组装: system 缺省为空串,可缺省字段不进载荷', () => {
  const payload = assembleTextGeneratePayload(DEEPSEEK_ANTHROPIC_SOURCE, {
    model: 'deepseek-chat',
    messages: [],
  })
  assert.equal(payload.system, '')
  assert.equal(payload.temperature, undefined)
  assert.equal(payload.stop, undefined)
  assert.ok(!('thinking' in payload))
})

test('组装: requiredParams 缺失按 param-required-missing 拒绝', () => {
  assert.throws(
    () => assembleTextGeneratePayload(ANTHROPIC_SOURCE, { model: 'claude', messages: [] }),
    (error: unknown) => (error as { code?: string }).code === 'param-required-missing',
  )
})

test('组装: 越界参数按 param-out-of-range 拒绝,不裁剪', () => {
  assert.throws(
    () =>
      assembleTextGeneratePayload(ANTHROPIC_SOURCE, {
        model: 'claude',
        messages: [],
        maxTokens: 1024,
        temperature: 1.5,
      }),
    (error: unknown) => (error as { code?: string }).code === 'param-out-of-range',
  )
})

test('组装: 描述未声明的参数按 param-unsupported 拒绝', () => {
  // deepseek-anthropic 未声明 topK;引擎载荷也没有 topK,这里用去掉 temperature 的变体演示
  const descriptor = patchedDescriptor({
    capabilities: [
      {
        id: 'text:generate',
        stream: 'sse-anthropic',
        params: { maxTokens: 'max_tokens', topP: 'top_p', stop: 'stop_sequences' },
      },
      { id: 'prompt:system', mode: 'top-level-field', field: 'system' },
    ],
  })
  assert.throws(
    () => assembleTextGeneratePayload(descriptor, { model: 'deepseek-chat', messages: [], temperature: 1 }),
    (error: unknown) => (error as { code?: string }).code === 'param-unsupported',
  )
})

test('组装: 未声明 reasoning:think 时请求思考被拒绝', () => {
  const descriptor = patchedDescriptor({ capabilities: DEEPSEEK_ANTHROPIC_SOURCE.capabilities.filter((capability) => capability.id !== 'reasoning:think') })
  assert.throws(
    () => assembleTextGeneratePayload(descriptor, { model: 'deepseek-chat', messages: [], thinking: true }),
    (error: unknown) => (error as { code?: string }).code === 'capability-unsupported',
  )
})

test('组装: 未声明 tool:web-search 时请求联网被拒绝', () => {
  assert.throws(
    () => assembleTextGeneratePayload(DEEPSEEK_ANTHROPIC_SOURCE, { model: 'deepseek-chat', messages: [], search: true }),
    (error: unknown) => (error as { code?: string }).code === 'capability-unsupported',
  )
})

test('组装: model 为空按 invalid-request 拒绝', () => {
  assert.throws(
    () => assembleTextGeneratePayload(DEEPSEEK_ANTHROPIC_SOURCE, { model: '', messages: [] }),
    (error: unknown) => (error as { code?: string }).code === 'invalid-request',
  )
})

/* ---------- 6. 两条封装 ---------- */

test('runTextGenerate: 载荷交给 provider.run,结果原样返回', async () => {
  reset()
  const { context, runs } = createFakeContext()
  const result = await runTextGenerate(context, {
    model: 'deepseek-chat',
    system: 'sys',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 1024,
  })
  assert.equal(result.kind, 'stream')
  const events: string[] = []
  if (result.kind === 'stream') {
    for await (const event of result.events) {
      events.push(event.type)
    }
  }
  assert.deepEqual(events, ['text', 'end'])
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.capability, 'text.generate')
  const payload = runs[0]?.payload as TextGeneratePayload
  assert.equal(payload.model, 'deepseek-chat')
  assert.equal(payload.maxTokens, 1024)
})

test('runTextGenerate: 缺省按 deepseek-anthropic 的描述校验', async () => {
  reset()
  const { context } = createFakeContext()
  // deepseek-anthropic 的 temperature 上限是 2,1.5 放行;换成 anthropic 描述则拒绝
  await runTextGenerate(context, { model: 'deepseek-chat', messages: [], temperature: 1.5 })
  await assert.rejects(
    runTextGenerate(context, { model: 'claude', messages: [], temperature: 1.5 }, ANTHROPIC_SOURCE),
    (error: unknown) => (error as { code?: string }).code === 'param-out-of-range',
  )
})

test('runTextGenerate: 引擎错误原样抛出', async () => {
  reset()
  const { context, runErrors } = createFakeContext()
  runErrors.push(Object.assign(new Error('denied'), { name: 'PluginProviderRunError', code: 'credential-missing' }))
  await assert.rejects(
    runTextGenerate(context, { model: 'deepseek-chat', messages: [] }),
    (error: unknown) => (error as { code?: string }).code === 'credential-missing',
  )
})

test('runModelsList: 返回模型 id 列表', async () => {
  reset()
  const { context, runs, runResults } = createFakeContext()
  runResults.push({ kind: 'models', models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })
  const ids = await runModelsList(context)
  assert.deepEqual([...ids], ['deepseek-chat', 'deepseek-reasoner'])
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.capability, 'models.list')
  assert.deepEqual(runs[0]?.payload, {})
})

test('runModelsList: 结果形态不符时拒绝', async () => {
  reset()
  const { context, runResults } = createFakeContext()
  runResults.push({ kind: 'stream', events: (async function* () {})() })
  await assert.rejects(runModelsList(context))
})
