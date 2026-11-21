/*
 * 来源描述校验脚本:零第三方依赖,只校验本仓库的 Schema 与三份示例。
 * 关键字白名单与 $id 规则对齐 dsc-plugin-template/scripts/validate-specs.mjs,
 * 语义覆盖本项目用到的 JSON Schema 2020-12 子集 + 本项目特有的跨字段规则。
 * 用法: node scripts/validate-specs.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRAFT = 'https://json-schema.org/draft/2020-12/schema'
const SCHEMA_PATH = 'schemas/source-descriptor.schema.json'
const EXAMPLE_DIR = 'schemas/examples'

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', '$comment', 'title', 'description', 'type',
  'properties', 'required', 'additionalProperties', 'pattern', 'minLength', 'maxLength',
  'format', 'enum', 'const', 'items', 'uniqueItems', 'minItems', 'maxItems',
  'anyOf', 'allOf', 'oneOf', 'minimum', 'maximum', 'minProperties', 'maxProperties',
  'examples', 'default', 'deprecated',
])
const SUBSCHEMA_SINGLE = ['items', 'additionalProperties']
const SUBSCHEMA_LIST = ['anyOf', 'allOf', 'oneOf']
const SUBSCHEMA_MAP = ['properties', '$defs']

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const typeOf = (value) => {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

const matchesType = (value, type) => {
  if (type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value)
  }
  if (type === 'number') {
    return typeof value === 'number'
  }
  return typeOf(value) === type
}

const stable = (value) => {
  if (Array.isArray(value)) {
    return '[' + value.map(stable).join(',') + ']'
  }
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

const sameValue = (left, right) => stable(left) === stable(right)

const resolvePointer = (pointer, root) => {
  if (pointer === '#') {
    return root
  }
  if (!pointer.startsWith('#/')) {
    return undefined
  }
  let current = root
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isPlainObject(current) && !Array.isArray(current)) {
      return undefined
    }
    if (!(key in current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}

const compilePattern = (source) => {
  try {
    return new RegExp(source)
  } catch {
    return null
  }
}

const validateNode = (schema, value, at, root, errors) => {
  if (schema === true || schema === undefined) {
    return
  }
  if (schema === false) {
    errors.push(at + ': 被 false 模式拒绝')
    return
  }
  if (!isPlainObject(schema)) {
    errors.push(at + ': 子 schema 必须是对象或布尔值')
    return
  }
  if (typeof schema.$ref === 'string') {
    const target = resolvePointer(schema.$ref, root)
    if (target === undefined) {
      errors.push(at + ': $ref 无法解析 ' + schema.$ref)
    } else {
      validateNode(target, value, at, root, errors)
    }
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(at + ': 类型应为 ' + String(schema.type) + ',实际 ' + typeOf(value))
    return
  }
  if ('const' in schema && !sameValue(schema.const, value)) {
    errors.push(at + ': 取值必须为 ' + JSON.stringify(schema.const) + ',实际 ' + JSON.stringify(value))
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameValue(item, value))) {
    errors.push(at + ': 取值必须为 ' + schema.enum.map((item) => JSON.stringify(item)).join(' / ') + ' 之一,实际 ' + JSON.stringify(value))
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(at + ': 长度不得小于 ' + String(schema.minLength))
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(at + ': 长度不得大于 ' + String(schema.maxLength))
    }
    if (typeof schema.pattern === 'string') {
      const regexp = compilePattern(schema.pattern)
      if (regexp === null) {
        errors.push(at + ': pattern 无法编译 ' + schema.pattern)
      } else if (!regexp.test(value)) {
        errors.push(at + ': 不符合 pattern ' + schema.pattern)
      }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(at + ': 不得小于 ' + String(schema.minimum))
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(at + ': 不得大于 ' + String(schema.maximum))
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(at + ': 元素个数不得少于 ' + String(schema.minItems))
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(at + ': 元素个数不得多于 ' + String(schema.maxItems))
    }
    if (schema.uniqueItems === true) {
      const seen = new Set()
      value.forEach((item, index) => {
        const key = stable(item)
        if (seen.has(key)) {
          errors.push(at + '/' + String(index) + ': 元素与前项重复')
        }
        seen.add(key)
      })
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        validateNode(schema.items, item, at + '/' + String(index), root, errors)
      })
    }
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties) {
      errors.push(at + ': 字段数不得少于 ' + String(schema.minProperties))
    }
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties) {
      errors.push(at + ': 字段数不得多于 ' + String(schema.maxProperties))
    }
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push(at + ': 缺少必填字段 ' + key)
        }
      }
    }
    const declared = isPlainObject(schema.properties) ? schema.properties : {}
    for (const key of keys) {
      if (key in declared) {
        validateNode(declared[key], value[key], at + '/' + key, root, errors)
      } else if (schema.additionalProperties === false) {
        errors.push(at + ': 不允许的字段 ' + key)
      } else if (isPlainObject(schema.additionalProperties)) {
        validateNode(schema.additionalProperties, value[key], at + '/' + key, root, errors)
      }
    }
  }
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((sub) => validateNode(sub, value, at, root, errors))
  }
  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.filter((sub) => {
      const inner = []
      validateNode(sub, value, at, root, inner)
      return inner.length === 0
    })
    if (matched.length === 0) {
      errors.push(at + ': 必须满足 anyOf 中至少一项,实际都不满足')
    }
  }
  if (Array.isArray(schema.oneOf)) {
    let matchedCount = 0
    schema.oneOf.forEach((sub) => {
      const inner = []
      validateNode(sub, value, at, root, inner)
      if (inner.length === 0) {
        matchedCount += 1
      }
    })
    if (matchedCount !== 1) {
      errors.push(at + ': 必须恰好满足 oneOf 中的一项,实际满足 ' + String(matchedCount) + ' 项')
    }
  }
}

const walkSchema = (schema, at, root, file, errors) => {
  if (schema === true || schema === false) {
    return
  }
  if (!isPlainObject(schema)) {
    errors.push(file + ' ' + at + ': 子 schema 必须是对象或布尔值')
    return
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      errors.push(file + ' ' + at + ': 未支持的 schema 关键字 ' + key)
    }
  }
  if (typeof schema.$ref === 'string' && resolvePointer(schema.$ref, root) === undefined) {
    errors.push(file + ' ' + at + ': $ref 无法解析 ' + schema.$ref)
  }
  if (typeof schema.pattern === 'string' && compilePattern(schema.pattern) === null) {
    errors.push(file + ' ' + at + ': pattern 无法编译 ' + schema.pattern)
  }
  for (const key of SUBSCHEMA_SINGLE) {
    if (key in schema) {
      walkSchema(schema[key], at + '/' + key, root, file, errors)
    }
  }
  for (const key of SUBSCHEMA_LIST) {
    if (Array.isArray(schema[key])) {
      schema[key].forEach((sub, index) => {
        walkSchema(sub, at + '/' + key + '/' + String(index), root, file, errors)
      })
    }
  }
  for (const key of SUBSCHEMA_MAP) {
    if (isPlainObject(schema[key])) {
      for (const [name, sub] of Object.entries(schema[key])) {
        walkSchema(sub, at + '/' + key + '/' + name, root, file, errors)
      }
    }
  }
}

const FORMAT_STREAM = {
  'anthropic-compatible': 'sse-anthropic',
  'openai-compatible': 'sse-openai',
  'deepseek-compatible': 'sse-openai',
}

const crossFieldCheck = (document) => {
  const errors = []
  const capabilities = Array.isArray(document.capabilities) ? document.capabilities : []
  const counts = new Map()
  for (const capability of capabilities) {
    if (isPlainObject(capability) && typeof capability.id === 'string') {
      counts.set(capability.id, (counts.get(capability.id) || 0) + 1)
    }
  }
  for (const [id, count] of counts) {
    if (count > 1) {
      errors.push('跨字段: 能力 ' + id + ' 重复声明 ' + String(count) + ' 次,同一 id 至多一条')
    }
  }
  const textCapability = capabilities.find((capability) => isPlainObject(capability) && capability.id === 'text:generate')
  if (textCapability !== undefined) {
    const expected = FORMAT_STREAM[document.format]
    if (textCapability.stream !== 'none' && expected !== undefined && textCapability.stream !== expected) {
      errors.push('跨字段: format 为 ' + document.format + ' 时 text:generate 的 stream 应为 ' + expected + ',实际 ' + String(textCapability.stream))
    }
    if (!counts.has('prompt:system')) {
      errors.push('跨字段: 声明 text:generate 时必须同时声明 prompt:system')
    }
    if (Array.isArray(textCapability.requiredParams)) {
      for (const key of textCapability.requiredParams) {
        if (!isPlainObject(textCapability.params) || !(key in textCapability.params)) {
          errors.push('跨字段: requiredParams 的 ' + key + ' 未出现在 params 中')
        }
      }
    }
    if (isPlainObject(textCapability.limits)) {
      for (const [key, range] of Object.entries(textCapability.limits)) {
        if (isPlainObject(range) && typeof range.min === 'number' && typeof range.max === 'number') {
          if (range.min > range.max) {
            errors.push('跨字段: limits.' + key + ' 的 min 大于 max')
          }
          if (typeof range.default === 'number' && (range.default < range.min || range.default > range.max)) {
            errors.push('跨字段: limits.' + key + ' 的 default 不在 [min, max] 内')
          }
        }
      }
    }
  }
  const effortCapability = capabilities.find((capability) => isPlainObject(capability) && capability.id === 'reasoning:think' && capability.style === 'effort-level')
  if (effortCapability !== undefined && typeof effortCapability.defaultLevel === 'string') {
    if (!Array.isArray(effortCapability.levels) || !effortCapability.levels.includes(effortCapability.defaultLevel)) {
      errors.push('跨字段: reasoning:think 的 defaultLevel 必须是 levels 中的一项')
    }
  }
  const usesFileId = capabilities.some((capability) => isPlainObject(capability) && Array.isArray(capability.inputs) && capability.inputs.includes('file-id'))
  if (usesFileId && (!isPlainObject(document.endpoints) || !('files' in document.endpoints))) {
    errors.push('跨字段: 有能力的 inputs 含 file-id,但 endpoints.files 缺失')
  }
  return errors
}

const readJson = (relativePath) => {
  const absolute = path.join(ROOT, relativePath)
  if (!existsSync(absolute)) {
    throw new Error('文件不存在: ' + relativePath)
  }
  return JSON.parse(readFileSync(absolute, 'utf8'))
}

const failures = []
const report = (label, passed, detail) => {
  const suffix = detail === undefined || detail === '' ? '' : ': ' + detail
  console.log((passed ? '通过  ' : '失败  ') + label + suffix)
  if (!passed) {
    failures.push(label)
  }
}

console.log('[1/4] Schema 自身静态检查: ' + SCHEMA_PATH)
const schemaDocument = readJson(SCHEMA_PATH)
const schemaErrors = []
walkSchema(schemaDocument, '#', schemaDocument, SCHEMA_PATH, schemaErrors)
if (schemaDocument.$schema !== DRAFT) {
  schemaErrors.push(SCHEMA_PATH + ': $schema 必须是 ' + DRAFT)
}
if (typeof schemaDocument.$id !== 'string' || !schemaDocument.$id.startsWith('https://')) {
  schemaErrors.push(SCHEMA_PATH + ': 必须提供 https 的 $id')
} else if (!schemaDocument.$id.endsWith(SCHEMA_PATH)) {
  schemaErrors.push(SCHEMA_PATH + ': $id 必须以文件路径结尾,当前为 ' + schemaDocument.$id)
}
for (const field of ['title', 'description', '$comment', 'required', 'additionalProperties', '$defs', 'examples']) {
  if (!(field in schemaDocument)) {
    schemaErrors.push(SCHEMA_PATH + ': 缺少顶层字段 ' + field)
  }
}
report('Schema 关键字白名单、$ref、pattern、$id 与必备顶层字段', schemaErrors.length === 0, schemaErrors.slice(0, 5).join('; '))

console.log('[2/4] Schema 内联 examples')
const inlineExamples = Array.isArray(schemaDocument.examples) ? schemaDocument.examples : []
if (inlineExamples.length === 0) {
  report(SCHEMA_PATH + ' 的 examples', false, '至少给出一条完整实例')
}
inlineExamples.forEach((example, index) => {
  const errors = []
  validateNode(schemaDocument, example, '#', schemaDocument, errors)
  errors.push(...crossFieldCheck(example))
  report('内联 example[' + String(index) + '] ' + String(example.id), errors.length === 0, errors.slice(0, 3).join('; '))
})

console.log('[3/4] 正例: ' + EXAMPLE_DIR)
const exampleFiles = readdirSync(path.join(ROOT, EXAMPLE_DIR)).filter((name) => name.endsWith('.json')).sort()
if (exampleFiles.length === 0) {
  report(EXAMPLE_DIR, false, '目录内没有 .json 样例')
}
for (const fileName of exampleFiles) {
  const relativePath = EXAMPLE_DIR + '/' + fileName
  const document = readJson(relativePath)
  const errors = []
  validateNode(schemaDocument, document, '#', schemaDocument, errors)
  errors.push(...crossFieldCheck(document))
  report(relativePath, errors.length === 0, errors.slice(0, 3).join('; '))
}

console.log('[4/4] 语义一致性: 正例覆盖的能力与方言')
const summary = exampleFiles.map((fileName) => {
  const document = readJson(EXAMPLE_DIR + '/' + fileName)
  const ids = (document.capabilities || []).map((capability) => capability.id).join(',')
  return fileName.replace('.descriptor.json', '') + ' [' + document.format + '] ' + ids
})
for (const line of summary) {
  console.log('      ' + line)
}
const anthropic = readJson(EXAMPLE_DIR + '/anthropic.descriptor.json')
const helper = (document, id) => (document.capabilities || []).some((capability) => capability.id === id)
report('anthropic 声明 vision:image 与 document:read', helper(anthropic, 'vision:image') && helper(anthropic, 'document:read'))
const deepseekDocument = readJson(EXAMPLE_DIR + '/deepseek.descriptor.json')
report('deepseek 不声明 vision:image 与 document:read', !helper(deepseekDocument, 'vision:image') && !helper(deepseekDocument, 'document:read'))
report('deepseek 用 max_tokens 且声明 1..393216', isPlainObject(deepseekDocument.capabilities[0].params) && deepseekDocument.capabilities[0].params.maxTokens === 'max_tokens' && deepseekDocument.capabilities[0].limits.maxTokens.min === 1 && deepseekDocument.capabilities[0].limits.maxTokens.max === 393216)
report('anthropic 用 x-api-key 且带 anthropic-version 固定头', anthropic.credential.headers[0].name === 'x-api-key' && anthropic.endpoints.chat.headers.some((header) => header.name === 'anthropic-version'))
const openaiDocument = readJson(EXAMPLE_DIR + '/openai.descriptor.json')
report('openai 用 Bearer 且 max_completion_tokens', openaiDocument.credential.headers[0].prefix === 'Bearer ' && openaiDocument.capabilities[0].params.maxTokens === 'max_completion_tokens')

if (failures.length > 0) {
  console.error('自检未通过,失败项 ' + String(failures.length) + ' 个')
  process.exitCode = 1
} else {
  console.log('自检通过: 1 份 Schema,' + String(inlineExamples.length) + ' 条内联实例,' + String(exampleFiles.length) + ' 份示例')
}
