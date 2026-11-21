/**
 * 设置表面与启停过滤的内存夹具测试:不联网、不依赖宿主。
 * 覆盖四块:设置表面登记(字段清单与类型)、自定义端点注册(baseUrl 实例化)、
 * 启停过滤(run 前按 settings.values() 过滤)与无 Key 判定
 * (credential-missing 由引擎执行时给出,插件侧原样上抛)。
 * 宿主侧的表单渲染、值写入与凭证库不在本仓库的测试范围,由宿主仓库覆盖。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activate,
  ANTHROPIC_SOURCE,
  BUILTIN_SOURCES,
  CUSTOM_ANTHROPIC_SOURCE,
  CUSTOM_OPENAI_SOURCE,
  DEEPSEEK_ANTHROPIC_SOURCE,
  deactivate,
  enabledFieldKey,
  OPENAI_SOURCE,
  readEndpointState,
  resolveTargetDescriptor,
  runModelsList,
  runTextGenerate,
  SETTING_DESCRIPTOR,
  withCustomBaseUrl,
  apiKeyFieldKey,
  CUSTOM_ANTHROPIC_URL_FIELD_KEY,
  CUSTOM_OPENAI_URL_FIELD_KEY,
} from '../../src/index.ts'
import type {
  EngineSourceDescriptor,
  PluginContext,
  ProviderRunResult,
  SettingDescriptor,
  SourceDescriptor,
} from '../../src/types.ts'

/* ---------- 夹具:带 settings 的上下文 ---------- */

interface FakeContext {
  readonly context: PluginContext
  readonly registered: EngineSourceDescriptor[]
  readonly runs: { readonly capability: string; readonly payload: unknown }[]
  readonly logs: string[]
  readonly settingValues: Record<string, string | number | boolean>
  registeredSettingDescriptor: SettingDescriptor | null
  readonly runResults: ProviderRunResult[]
  readonly runErrors: unknown[]
}

const createFakeContext = (): FakeContext => {
  const registered: EngineSourceDescriptor[] = []
  const runs: { capability: string; payload: unknown }[] = []
  const logs: string[] = []
  const settingValues: Record<string, string | number | boolean> = {}
  let registeredSettingDescriptor: SettingDescriptor | null = null
  const runResults: ProviderRunResult[] = []
  const runErrors: unknown[] = []

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
      register: (descriptor) => {
        registeredSettingDescriptor = descriptor
        return () => {
          registeredSettingDescriptor = null
        }
      },
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

  return {
    context,
    registered,
    runs,
    logs,
    settingValues,
    get registeredSettingDescriptor() {
      return registeredSettingDescriptor
    },
    set registeredSettingDescriptor(value: SettingDescriptor | null) {
      registeredSettingDescriptor = value
    },
    runResults,
    runErrors,
  }
}

/** 每个用例从未激活开始,避免模块级激活状态互相影响 */
const reset = (): void => {
  deactivate()
}

/** 构造一个引擎执行时的 credential-missing 形态错误 */
const credentialMissingError = (): Error =>
  Object.assign(new Error("the api key is empty"), {
    name: 'PluginProviderRunError',
    code: 'credential-missing',
    capability: 'text.generate',
  })

/* ---------- 1. 设置表面登记 ---------- */

test('activate: 先注册内置端点,再登记设置表面', () => {
  reset()
  const fake = createFakeContext()
  activate(fake.context)
  assert.equal(fake.registered.length, 3)
  assert.ok(fake.registeredSettingDescriptor !== null)
  assert.ok(fake.logs.some((message) => message.includes('已登记设置表面')))
})

test('SETTING_DESCRIPTOR: 每个内置端点一个启用开关与一个 API Key 字段', () => {
  const byKey = new Map(SETTING_DESCRIPTOR.fields.map((field) => [field.key, field]))
  for (const descriptor of BUILTIN_SOURCES) {
    const switchField = byKey.get(enabledFieldKey(descriptor.id))
    assert.ok(switchField !== undefined, '缺启用开关字段: ' + descriptor.id)
    assert.equal(switchField.type, 'switch')
    assert.equal(switchField.default, true)

    const keyField = byKey.get(apiKeyFieldKey(descriptor.id))
    assert.ok(keyField !== undefined, '缺 API Key 字段: ' + descriptor.id)
    assert.equal(keyField.type, 'secret')
    assert.equal(keyField.default, undefined, 'secret 字段不得有默认值: ' + descriptor.id)
  }
})

test('SETTING_DESCRIPTOR: 两个自定义 baseUrl 文本字段,默认空串', () => {
  const byKey = new Map(SETTING_DESCRIPTOR.fields.map((field) => [field.key, field]))
  for (const key of [CUSTOM_OPENAI_URL_FIELD_KEY, CUSTOM_ANTHROPIC_URL_FIELD_KEY]) {
    const field = byKey.get(key)
    assert.ok(field !== undefined, '缺字段: ' + key)
    assert.equal(field.type, 'text')
    assert.equal(field.default, '', 'baseUrl 字段默认空串,留空即不注册')
  }
})

test('SETTING_DESCRIPTOR: 字段键全部合法且不重复', () => {
  const keys = SETTING_DESCRIPTOR.fields.map((field) => field.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual(keys, [
    'deepseek-anthropic-enabled',
    'deepseek-anthropic-api-key',
    'openai-enabled',
    'openai-api-key',
    'anthropic-enabled',
    'anthropic-api-key',
    CUSTOM_OPENAI_URL_FIELD_KEY,
    CUSTOM_ANTHROPIC_URL_FIELD_KEY,
  ])
})

test('settings.register 被引擎拒绝时只写日志,不拖住端点注册', () => {
  reset()
  const fake = createFakeContext()
  const throwing: PluginContext = {
    ...fake.context,
    settings: {
      register: () => {
        throw Object.assign(new Error('rejected'), { name: 'PluginSettingsError', code: 'invalid-default' })
      },
      values: () => ({})
    },
  }
  activate(throwing)
  assert.equal(fake.registered.length, 3, '设置表面挂不上不拖住端点注册')
  assert.ok(fake.logs.some((message) => message.includes('设置表面登记被引擎拒绝')))
})

/* ---------- 2. 自定义端点注册 ---------- */

test('activate: 自定义 baseUrl 留空不注册自定义端点', () => {
  reset()
  const fake = createFakeContext()
  activate(fake.context)
  assert.deepEqual(fake.registered.map((descriptor) => descriptor.id), ['deepseek-anthropic', 'openai', 'anthropic'])
})

test('activate: 填了合法 baseUrl 时注册两个自定义端点', () => {
  reset()
  const fake = createFakeContext()
  fake.settingValues[CUSTOM_OPENAI_URL_FIELD_KEY] = 'https://gw.example.com/v1'
  fake.settingValues[CUSTOM_ANTHROPIC_URL_FIELD_KEY] = 'https://relay.example.com'
  activate(fake.context)
  const ids = fake.registered.map((descriptor) => descriptor.id)
  assert.deepEqual(ids, ['deepseek-anthropic', 'openai', 'anthropic', 'custom-openai', 'custom-anthropic'])
  const customOpenai = fake.registered[3]
  assert.ok(customOpenai !== undefined)
  assert.equal(customOpenai.baseUrl, 'https://gw.example.com/v1')
  assert.equal(customOpenai.format, 'openai-chat')
  const customAnthropic = fake.registered[4]
  assert.ok(customAnthropic !== undefined)
  assert.equal(customAnthropic.baseUrl, 'https://relay.example.com')
  assert.equal(customAnthropic.format, 'anthropic-messages')
})

test('activate: 非法 baseUrl 不注册,只跳过', () => {
  reset()
  const fake = createFakeContext()
  fake.settingValues[CUSTOM_OPENAI_URL_FIELD_KEY] = 'ftp://gw.example.com'
  fake.settingValues[CUSTOM_ANTHROPIC_URL_FIELD_KEY] = '   '
  activate(fake.context)
  const ids = fake.registered.map((descriptor) => descriptor.id)
  assert.deepEqual(ids, ['deepseek-anthropic', 'openai', 'anthropic'])
})

test('readEndpointState: baseUrl 去空白与尾部斜杠', () => {
  reset()
  const fake = createFakeContext()
  fake.settingValues[CUSTOM_OPENAI_URL_FIELD_KEY] = '  https://gw.example.com/v1/  '
  const state = readEndpointState(fake.context)
  assert.equal(state.customSources.length, 1)
  assert.equal(state.customSources[0]?.endpoints.base, 'https://gw.example.com/v1')
})

test('withCustomBaseUrl: 模板其余字段原样保留', () => {
  const source = withCustomBaseUrl(CUSTOM_ANTHROPIC_SOURCE, 'https://relay.example.com')
  assert.equal(source.id, 'custom-anthropic')
  assert.deepEqual(source.capabilities, CUSTOM_ANTHROPIC_SOURCE.capabilities)
  assert.deepEqual(source.credential, CUSTOM_ANTHROPIC_SOURCE.credential)
  assert.equal(source.endpoints.base, 'https://relay.example.com')
  assert.notEqual(source, CUSTOM_ANTHROPIC_SOURCE, '不得改写模板本体')
})

/* ---------- 3. 启停过滤 ---------- */

test('resolveTargetDescriptor: 默认全启用时取 deepseek-anthropic', () => {
  reset()
  const fake = createFakeContext()
  const target = resolveTargetDescriptor(fake.context)
  assert.equal(target.id, 'deepseek-anthropic')
})

test('runTextGenerate: 停用默认端点后落到下一个启用的内置端点', async () => {
  reset()
  const fake = createFakeContext()
  fake.settingValues[enabledFieldKey(DEEPSEEK_ANTHROPIC_SOURCE.id)] = false
  await runTextGenerate(fake.context, { model: 'deepseek-chat', messages: [] })
  assert.equal(fake.runs.length, 1)
  // 校验口径随之切换:openai 描述的 maxTokens 无上界,393216 不被拒
  await runTextGenerate(fake.context, { model: 'deepseek-chat', messages: [], maxTokens: 393216 })
})

test('runTextGenerate: 显式传入被停用的端点按 endpoint-disabled 拒绝', async () => {
  reset()
  const fake = createFakeContext()
  fake.settingValues[enabledFieldKey(ANTHROPIC_SOURCE.id)] = false
  await assert.rejects(
    runTextGenerate(fake.context, { model: 'claude', messages: [] }, ANTHROPIC_SOURCE),
    (error: unknown) =>
      (error as { code?: string }).code === 'endpoint-disabled' &&
      (error as Error).message.includes('已被设置停用'),
  )
  assert.equal(fake.runs.length, 0, '停用端点不发 run,不花额度')
})

test('runTextGenerate: 全部停用且无自定义端点时拒绝', async () => {
  reset()
  const fake = createFakeContext()
  for (const descriptor of BUILTIN_SOURCES) {
    fake.settingValues[enabledFieldKey(descriptor.id)] = false
  }
  await assert.rejects(
    runTextGenerate(fake.context, { model: 'deepseek-chat', messages: [] }),
    (error: unknown) => (error as { code?: string }).code === 'endpoint-disabled',
  )
})

test('runTextGenerate: 全部内置停用时落到可用的自定义端点', async () => {
  reset()
  const fake = createFakeContext()
  for (const descriptor of BUILTIN_SOURCES) {
    fake.settingValues[enabledFieldKey(descriptor.id)] = false
  }
  fake.settingValues[CUSTOM_OPENAI_URL_FIELD_KEY] = 'https://gw.example.com/v1'
  await runTextGenerate(fake.context, { model: 'deepseek-chat', messages: [] })
  assert.equal(fake.runs.length, 1)
})

test('resolveTargetDescriptor: 显式传自定义端点不查开关', () => {
  reset()
  const fake = createFakeContext()
  for (const descriptor of BUILTIN_SOURCES) {
    fake.settingValues[enabledFieldKey(descriptor.id)] = false
  }
  const custom: SourceDescriptor = withCustomBaseUrl(CUSTOM_OPENAI_SOURCE, 'https://gw.example.com')
  const target = resolveTargetDescriptor(fake.context, custom)
  assert.equal(target.id, 'custom-openai')
})

test('runModelsList: 目标端点被停用时拒绝,不发 run', async () => {
  reset()
  const fake = createFakeContext()
  fake.settingValues[enabledFieldKey(DEEPSEEK_ANTHROPIC_SOURCE.id)] = false
  await assert.rejects(
    runModelsList(fake.context, DEEPSEEK_ANTHROPIC_SOURCE),
    (error: unknown) => (error as { code?: string }).code === 'endpoint-disabled',
  )
  assert.equal(fake.runs.length, 0)

  // 全部停用同样拒绝
  for (const descriptor of BUILTIN_SOURCES) {
    fake.settingValues[enabledFieldKey(descriptor.id)] = false
  }
  await assert.rejects(
    runModelsList(fake.context),
    (error: unknown) => (error as { code?: string }).code === 'endpoint-disabled',
  )
})

test('runModelsList: 启停过滤通过后照常执行', async () => {
  reset()
  const fake = createFakeContext()
  fake.settingValues[enabledFieldKey(DEEPSEEK_ANTHROPIC_SOURCE.id)] = false
  fake.runResults.push({ kind: 'models', models: [{ id: 'm1' }] })
  const ids = await runModelsList(fake.context)
  assert.deepEqual([...ids], ['m1'])
  assert.equal(fake.runs[0]?.capability, 'models.list')
})

test('settings.values() 抛错时按未配置处理:内置全启用,自定义不推导', async () => {
  reset()
  const fake = createFakeContext()
  const broken: PluginContext = {
    ...fake.context,
    settings: {
      register: () => () => {},
      values: () => {
        throw new Error('PluginCapabilityError')
      },
    },
  }
  const state = readEndpointState(broken)
  assert.deepEqual(state.enabledBuiltinIds, BUILTIN_SOURCES.map((descriptor) => descriptor.id))
  assert.equal(state.customSources.length, 0)
  fake.runResults.push({ kind: 'models', models: [] })
  await runModelsList(broken)
})

/* ---------- 4. 无 Key 判定 ---------- */

/**
 * secret 字段在 settings.values() 里完全不出现,插件侧看不到「是否已配置」;
 * 无 Key 的端点由引擎在执行时抛 credential-missing,封装原样上抛,
 * 启停过滤不吞它、也不为它换端点。
 */
test('runTextGenerate: 端点启用但无 Key 时 credential-missing 原样抛出', async () => {
  reset()
  const fake = createFakeContext()
  fake.runErrors.push(credentialMissingError())
  await assert.rejects(
    runTextGenerate(fake.context, { model: 'deepseek-chat', messages: [] }),
    (error: unknown) =>
      (error as { code?: string }).code === 'credential-missing' &&
      (error as { name?: string }).name === 'PluginProviderRunError',
  )
})

test('runModelsList: 无 Key 时的 credential-missing 原样抛出', async () => {
  reset()
  const fake = createFakeContext()
  fake.runErrors.push(credentialMissingError())
  await assert.rejects(
    runModelsList(fake.context),
    (error: unknown) => (error as { code?: string }).code === 'credential-missing',
  )
})

test('端点停用时无 Key 不再暴露:停用优先于执行,不产生 credential-missing', async () => {
  reset()
  const fake = createFakeContext()
  fake.runErrors.push(credentialMissingError())
  fake.settingValues[enabledFieldKey(DEEPSEEK_ANTHROPIC_SOURCE.id)] = false
  fake.settingValues[enabledFieldKey(OPENAI_SOURCE.id)] = false
  fake.settingValues[enabledFieldKey(ANTHROPIC_SOURCE.id)] = false
  await assert.rejects(
    runTextGenerate(fake.context, { model: 'deepseek-chat', messages: [] }),
    (error: unknown) => (error as { code?: string }).code === 'endpoint-disabled',
  )
  assert.equal(fake.runs.length, 0, '停用端点连执行都不发起,轮不到凭证判定')
})

test('凭据形态只进描述不进设置:secret 值不被任何读取路径带出', () => {
  reset()
  const fake = createFakeContext()
  // 宿主不会把 secret 值放进 values();即便夹具误放,插件侧也不读它
  fake.settingValues[apiKeyFieldKey(DEEPSEEK_ANTHROPIC_SOURCE.id)] = 'sk-secret'
  const state = readEndpointState(fake.context)
  assert.deepEqual(state.enabledBuiltinIds, BUILTIN_SOURCES.map((descriptor) => descriptor.id))
  assert.equal(state.customSources.length, 0)
})