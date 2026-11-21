/**
 * 来源描述的运行时结构校验。
 *
 * 校验范围是注册前必须成立的那部分结构规则与跨字段规则,口径与
 * schemas/source-descriptor.schema.json、scripts/validate-specs.mjs 一致;
 * Schema 是书面契约,脚本是发布前校验,这里是插件内置数据进入
 * registerSource 之前的最后一道闸。校验通过不等于通过完整 Schema:
 * 完整校验仍以 Schema 与脚本为准,见 docs/design/provider-sources.md 第四节。
 */

import type {
  LocalizedText,
  SourceCapability,
  SourceDescriptor,
  SourceDialect,
  TextGenerateCapability,
  TextParamKey,
} from './descriptor.js'

/** 校验失败原因的分类码 */
export type DescriptorErrorCode =
  | 'shape'
  | 'schema-version'
  | 'id'
  | 'name'
  | 'format'
  | 'endpoints'
  | 'credential'
  | 'capabilities'
  | 'cross-field'

/** 一条校验问题;path 形如 /endpoints/base */
export interface DescriptorIssue {
  readonly code: DescriptorErrorCode
  readonly message: string
  readonly path?: string
}

export type DescriptorValidation =
  | { readonly ok: true; readonly dialect: SourceDialect }
  | { readonly ok: false; readonly issues: readonly DescriptorIssue[] }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/

const DIALECTS: readonly SourceDialect[] = ['anthropic-compatible', 'openai-compatible', 'deepseek-compatible']

/** 方言与流式帧的对应关系;stream 为 none 时豁免(docs/spec.md 跨字段规则 2) */
const FORMAT_STREAM: Record<SourceDialect, 'sse-anthropic' | 'sse-openai'> = {
  'anthropic-compatible': 'sse-anthropic',
  'openai-compatible': 'sse-openai',
  'deepseek-compatible': 'sse-openai',
}

const TEXT_PARAM_KEYS: readonly TextParamKey[] = ['maxTokens', 'temperature', 'topP', 'topK', 'stop']

const CAPABILITY_IDS = [
  'text:generate',
  'prompt:system',
  'reasoning:think',
  'vision:image',
  'document:read',
  'tool:web-search',
  'tool:read-url',
] as const

const issue = (code: DescriptorErrorCode, message: string, path?: string): DescriptorIssue =>
  path === undefined ? { code, message } : { code, message, path }

/** 校验 base 与 path 的拼接形态:base 不带尾斜杠,path 以斜杠开头,不含协议主机与查询 */
const checkEndpointShape = (
  endpoints: Record<string, unknown>,
  errors: DescriptorIssue[],
): void => {
  const base = endpoints['base']
  if (!isNonEmptyString(base)) {
    errors.push(issue('endpoints', 'endpoints.base 必须是非空字符串', '/endpoints/base'))
  } else {
    if (!/^https?:\/\//.test(base)) {
      errors.push(issue('endpoints', 'endpoints.base 必须是 http 或 https 绝对地址', '/endpoints/base'))
    }
    if (base.endsWith('/')) {
      errors.push(issue('endpoints', 'endpoints.base 末尾不带斜杠', '/endpoints/base'))
    }
    if (base.includes('?') || base.includes('#')) {
      errors.push(issue('endpoints', 'endpoints.base 不允许查询串与片段', '/endpoints/base'))
    }
  }

  for (const key of ['chat', 'models', 'files'] as const) {
    const endpoint = endpoints[key]
    if (endpoint === undefined) {
      if (key !== 'files') {
        errors.push(issue('endpoints', 'endpoints.' + key + ' 必填', '/endpoints/' + key))
      }
      continue
    }
    const path = '/endpoints/' + key
    if (!isObject(endpoint)) {
      errors.push(issue('endpoints', 'endpoints.' + key + ' 必须是对象', path))
      continue
    }
    const endpointKeys = Object.keys(endpoint)
    for (const endpointKey of endpointKeys) {
      if (endpointKey !== 'path' && endpointKey !== 'headers') {
        errors.push(issue('endpoints', 'endpoints.' + key + ' 不允许的字段 ' + endpointKey, path))
      }
    }
    if (!isNonEmptyString(endpoint['path'])) {
      errors.push(issue('endpoints', 'endpoints.' + key + '.path 必须是非空字符串', path + '/path'))
    } else {
      const value = endpoint['path']
      if (!value.startsWith('/')) {
        errors.push(issue('endpoints', 'endpoints.' + key + '.path 必须以斜杠开头', path + '/path'))
      }
      if (value.includes('://') || value.includes('?') || value.includes('#')) {
        errors.push(issue('endpoints', 'endpoints.' + key + '.path 只允许站内绝对路径', path + '/path'))
      }
    }
    const headers = endpoint['headers']
    if (headers !== undefined) {
      if (!Array.isArray(headers)) {
        errors.push(issue('endpoints', 'endpoints.' + key + '.headers 必须是数组', path + '/headers'))
      } else {
        for (const [index, header] of headers.entries()) {
          if (!isObject(header) || !isNonEmptyString(header['name']) || !isNonEmptyString(header['value'])) {
            errors.push(
              issue('endpoints', 'endpoints.' + key + '.headers[' + String(index) + '] 必须是 {name, value}', path + '/headers'),
            )
          }
        }
      }
    }
  }
}

/** 校验凭据形态 */
const checkCredential = (credential: Record<string, unknown>, errors: DescriptorIssue[]): void => {
  if (credential['kind'] !== 'api-key') {
    errors.push(issue('credential', 'credential.kind 只接受 api-key', '/credential/kind'))
  }
  const headers = credential['headers']
  if (!Array.isArray(headers) || headers.length === 0 || headers.length > 4) {
    errors.push(issue('credential', 'credential.headers 须为 1 到 4 项的数组', '/credential/headers'))
    return
  }
  for (const [index, header] of headers.entries()) {
    if (!isObject(header) || !isNonEmptyString(header['name'])) {
      errors.push(issue('credential', 'credential.headers[' + String(index) + '].name 必须是非空字符串', '/credential/headers'))
      continue
    }
    const prefix = header['prefix']
    if (prefix !== undefined && !isNonEmptyString(prefix)) {
      errors.push(issue('credential', 'credential.headers[' + String(index) + '].prefix 缺省即无前缀,不允许空串', '/credential/headers'))
    }
  }
}

/** 校验单个能力对象;形状按 docs/spec.md 第四节逐项判定 */
const checkCapability = (capability: Record<string, unknown>, errors: DescriptorIssue[]): void => {
  const id = capability['id']
  if (typeof id !== 'string' || !(CAPABILITY_IDS as readonly string[]).includes(id)) {
    errors.push(issue('capabilities', '未知的能力 id ' + JSON.stringify(id), '/capabilities'))
    return
  }
  const at = '/capabilities/' + id
  if (id === 'text:generate') {
    const stream = capability['stream']
    if (stream !== 'sse-anthropic' && stream !== 'sse-openai' && stream !== 'none') {
      errors.push(issue('capabilities', 'text:generate.stream 取值非法', at + '/stream'))
    }
    const params = capability['params']
    if (params !== undefined) {
      if (!isObject(params)) {
        errors.push(issue('capabilities', 'text:generate.params 必须是对象', at + '/params'))
      } else {
        for (const key of Object.keys(params)) {
          if (!(TEXT_PARAM_KEYS as readonly string[]).includes(key)) {
            errors.push(issue('capabilities', 'text:generate.params 不允许的键 ' + key, at + '/params'))
          } else if (!isNonEmptyString(params[key])) {
            errors.push(issue('capabilities', 'text:generate.params.' + key + ' 必须是非空字段名', at + '/params'))
          }
        }
      }
    }
    const requiredParams = capability['requiredParams']
    if (requiredParams !== undefined) {
      if (!Array.isArray(requiredParams) || requiredParams.some((key) => !isNonEmptyString(key))) {
        errors.push(issue('capabilities', 'text:generate.requiredParams 必须是字符串数组', at + '/requiredParams'))
      }
    }
    const limits = capability['limits']
    if (limits !== undefined) {
      if (!isObject(limits)) {
        errors.push(issue('capabilities', 'text:generate.limits 必须是对象', at + '/limits'))
      } else {
        for (const key of Object.keys(limits)) {
          if (!(TEXT_PARAM_KEYS as readonly string[]).includes(key)) {
            errors.push(issue('capabilities', 'text:generate.limits 不允许的键 ' + key, at + '/limits'))
            continue
          }
          const range = limits[key]
          if (!isObject(range) || typeof range['min'] !== 'number') {
            errors.push(issue('capabilities', 'text:generate.limits.' + key + '.min 必填且是数字', at + '/limits'))
            continue
          }
          const min = range['min']
          const max = range['max']
          if (max !== undefined && typeof max !== 'number') {
            errors.push(issue('capabilities', 'text:generate.limits.' + key + '.max 必须是数字', at + '/limits'))
          } else if (typeof max === 'number' && min > max) {
            errors.push(issue('capabilities', 'text:generate.limits.' + key + ' 的 min 大于 max', at + '/limits'))
          }
          const fallback = typeof max === 'number' ? max : Number.POSITIVE_INFINITY
          if (range['default'] !== undefined && (typeof range['default'] !== 'number' || range['default'] < min || range['default'] > fallback)) {
            errors.push(issue('capabilities', 'text:generate.limits.' + key + '.default 须落在 [min, max] 内', at + '/limits'))
          }
        }
      }
    }
    return
  }
  if (id === 'prompt:system') {
    const mode = capability['mode']
    if (mode === 'top-level-field') {
      if (!isNonEmptyString(capability['field'])) {
        errors.push(issue('capabilities', 'prompt:system 的 top-level-field 需要 field', at + '/field'))
      }
      return
    }
    if (mode === 'message-role') {
      if (capability['role'] !== 'system' && capability['role'] !== 'developer') {
        errors.push(issue('capabilities', 'prompt:system 的 message-role 需要 role 为 system 或 developer', at + '/role'))
      }
      return
    }
    errors.push(issue('capabilities', 'prompt:system.mode 取值非法', at + '/mode'))
    return
  }
  if (id === 'reasoning:think') {
    if (capability['style'] === 'type-toggle') {
      for (const key of ['field', 'onValue', 'offValue'] as const) {
        if (!isNonEmptyString(capability[key])) {
          errors.push(issue('capabilities', 'reasoning:think 的 type-toggle 需要 ' + key, at + '/' + key))
        }
      }
      return
    }
    if (capability['style'] === 'effort-level') {
      if (!isNonEmptyString(capability['field'])) {
        errors.push(issue('capabilities', 'reasoning:think 的 effort-level 需要 field', at + '/field'))
      }
      const levels = capability['levels']
      if (!Array.isArray(levels) || levels.length === 0 || levels.some((level) => !isNonEmptyString(level))) {
        errors.push(issue('capabilities', 'reasoning:think 的 effort-level 需要非空 levels', at + '/levels'))
      }
      const defaultLevel = capability['defaultLevel']
      if (defaultLevel !== undefined && (!Array.isArray(levels) || !levels.includes(defaultLevel))) {
        errors.push(issue('capabilities', 'reasoning:think 的 defaultLevel 必须是 levels 中的一项', at + '/defaultLevel'))
      }
      return
    }
    errors.push(issue('capabilities', 'reasoning:think.style 取值非法', at + '/style'))
    return
  }
  // vision:image / document:read / tool:web-search / tool:read-url
  if (id === 'vision:image' || id === 'document:read') {
    if (!isNonEmptyString(capability['contentType'])) {
      errors.push(issue('capabilities', id + ' 需要 contentType', at + '/contentType'))
    }
    const inputs = capability['inputs']
    if (!Array.isArray(inputs) || inputs.length === 0) {
      errors.push(issue('capabilities', id + ' 需要至少一项 inputs', at + '/inputs'))
    } else {
      for (const input of inputs) {
        if (input !== 'base64' && input !== 'url' && input !== 'file-id') {
          errors.push(issue('capabilities', id + '.inputs 取值非法 ' + JSON.stringify(input), at + '/inputs'))
        }
      }
    }
    return
  }
  if (id === 'tool:web-search' || id === 'tool:read-url') {
    if (capability['kind'] !== 'server-tool' && capability['kind'] !== 'request-tools') {
      errors.push(issue('capabilities', id + '.kind 取值非法', at + '/kind'))
    }
    const names = capability['names']
    if (!Array.isArray(names) || names.length === 0 || names.some((name) => !isNonEmptyString(name))) {
      errors.push(issue('capabilities', id + ' 需要非空 names', at + '/names'))
    } else if (new Set(names).size !== names.length) {
      errors.push(issue('capabilities', id + '.names 不得重复', at + '/names'))
    }
    const requestField = capability['requestField']
    if (requestField !== undefined && !isNonEmptyString(requestField)) {
      errors.push(issue('capabilities', id + '.requestField 必须是非空字段名', at + '/requestField'))
    }
  }
}

/**
 * 校验一份来源描述。
 * 通过返回 ok 与方言;失败返回全部问题,不做「发现第一个就停」,
 * 让注册侧能把整份数据一次修完。
 */
export const validateSourceDescriptor = (value: unknown): DescriptorValidation => {
  const errors: DescriptorIssue[] = []

  if (!isObject(value)) {
    return { ok: false, issues: [issue('shape', '来源描述必须是对象')] }
  }

  const allowedKeys = ['schemaVersion', 'id', 'name', 'format', 'endpoints', 'credential', 'capabilities']
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      errors.push(issue('shape', '不允许的顶层字段 ' + key))
    }
  }
  for (const key of allowedKeys) {
    if (!(key in value)) {
      errors.push(issue('shape', '缺少必填字段 ' + key))
    }
  }
  if (errors.length > 0) {
    return { ok: false, issues: errors }
  }

  if (value['schemaVersion'] !== 1) {
    errors.push(issue('schema-version', 'schemaVersion 当前只有 1,其它取值按不可读处理', '/schemaVersion'))
  }

  const id = value['id']
  if (!isNonEmptyString(id) || !ID_PATTERN.test(id)) {
    errors.push(issue('id', 'id 须匹配 ^[a-z][a-z0-9-]{2,63}$', '/id'))
  }

  const name = value['name']
  if (!isObject(name)) {
    errors.push(issue('name', 'name 必须是双语文案对象', '/name'))
  } else {
    const keys = Object.keys(name)
    for (const key of keys) {
      if (key !== 'zh-CN' && key !== 'en-US') {
        errors.push(issue('name', 'name 不允许的语言 ' + key, '/name'))
      }
    }
    if (!('zh-CN' in name) && !('en-US' in name)) {
      errors.push(issue('name', 'name 至少给出 zh-CN 或 en-US 一侧', '/name'))
    }
    const localized = name as unknown as LocalizedText
    for (const side of ['zh-CN', 'en-US'] as const) {
      const text = localized[side]
      if (text !== undefined && (text.trim() === '' || text.length > 64)) {
        errors.push(issue('name', 'name.' + side + ' 须为 1 到 64 个字符', '/name'))
      }
    }
  }

  const format = value['format']
  if (typeof format !== 'string' || !(DIALECTS as readonly string[]).includes(format)) {
    errors.push(issue('format', 'format 取值非法', '/format'))
  }

  const endpoints = value['endpoints']
  if (!isObject(endpoints)) {
    errors.push(issue('endpoints', 'endpoints 必须是对象', '/endpoints'))
  } else {
    const endpointKeys = Object.keys(endpoints)
    for (const key of endpointKeys) {
      if (key !== 'base' && key !== 'chat' && key !== 'models' && key !== 'files') {
        errors.push(issue('endpoints', 'endpoints 不允许的字段 ' + key, '/endpoints'))
      }
    }
    checkEndpointShape(endpoints, errors)
  }

  const credential = value['credential']
  if (!isObject(credential)) {
    errors.push(issue('credential', 'credential 必须是对象', '/credential'))
  } else {
    for (const key of Object.keys(credential)) {
      if (key !== 'kind' && key !== 'headers') {
        errors.push(issue('credential', 'credential 不允许的字段 ' + key, '/credential'))
      }
    }
    checkCredential(credential, errors)
  }

  const capabilities = value['capabilities']
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.length > 32) {
    errors.push(issue('capabilities', 'capabilities 须为 1 到 32 项的数组', '/capabilities'))
  } else {
    const seen = new Set<string>()
    for (const [index, capability] of capabilities.entries()) {
      if (!isObject(capability)) {
        errors.push(issue('capabilities', 'capabilities[' + String(index) + '] 必须是对象', '/capabilities'))
        continue
      }
      const capabilityId = capability['id']
      if (typeof capabilityId === 'string') {
        if (seen.has(capabilityId)) {
          errors.push(issue('cross-field', '能力 ' + capabilityId + ' 重复声明,同一 id 至多一条', '/capabilities'))
        }
        seen.add(capabilityId)
      }
      checkCapability(capability, errors)
    }

    // 跨字段规则(docs/spec.md 第七节)
    if (typeof format === 'string' && (DIALECTS as readonly string[]).includes(format)) {
      const text = capabilities.find(
        (capability): capability is Record<string, unknown> =>
          isObject(capability) && capability['id'] === 'text:generate',
      )
      if (text !== undefined && text['stream'] !== 'none') {
        const expected = FORMAT_STREAM[format as SourceDialect]
        if (text['stream'] !== expected) {
          errors.push(
            issue('cross-field', 'format 为 ' + format + ' 时 text:generate 的 stream 应为 ' + expected, '/capabilities'),
          )
        }
      }
      if (text !== undefined && !seen.has('prompt:system')) {
        errors.push(issue('cross-field', '声明 text:generate 时必须同时声明 prompt:system', '/capabilities'))
      }
      if (text !== undefined && Array.isArray(text['requiredParams'])) {
        const params = isObject(text['params']) ? text['params'] : undefined
        for (const key of text['requiredParams'] as unknown[]) {
          if (params === undefined || !(typeof key === 'string' && key in params)) {
            errors.push(issue('cross-field', 'requiredParams 的 ' + JSON.stringify(key) + ' 未出现在 params 中', '/capabilities'))
          }
        }
      }
      const usesFileId = capabilities.some(
        (capability) => isObject(capability) && Array.isArray(capability['inputs']) && (capability['inputs'] as unknown[]).includes('file-id'),
      )
      if (usesFileId && !(isObject(endpoints) && 'files' in endpoints)) {
        errors.push(issue('cross-field', '有能力的 inputs 含 file-id,但 endpoints.files 缺失', '/endpoints'))
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, issues: errors }
  }
  return { ok: true, dialect: format as SourceDialect }
}

/** 从描述里取出 text:generate 能力;判别键是 id,命中即该分支的形状 */
export const findTextGenerateCapability = (descriptor: SourceDescriptor): TextGenerateCapability | undefined =>
  descriptor.capabilities.find((item) => item.id === 'text:generate')

/** 从描述里取出 prompt:system 能力 */
export const findPromptSystemCapability = (descriptor: SourceDescriptor): SourceCapability | undefined =>
  descriptor.capabilities.find((item) => item.id === 'prompt:system')

/** 从描述里取出 reasoning:think 能力 */
export const findReasoningThinkCapability = (descriptor: SourceDescriptor): SourceCapability | undefined =>
  descriptor.capabilities.find((item) => item.id === 'reasoning:think')

/** 从描述里取出指定 id 的工具能力 */
export const findToolCapability = (
  descriptor: SourceDescriptor,
  id: 'tool:web-search' | 'tool:read-url',
): SourceCapability | undefined => descriptor.capabilities.find((item) => item.id === id)
