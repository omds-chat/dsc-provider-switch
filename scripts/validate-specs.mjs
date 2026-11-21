/*
 * 规范区校验脚本:零第三方依赖,不联网。
 * 覆盖三块:
 *   1) 来源描述 Schema(schemas/source-descriptor.schema.json)与 schemas/examples/*.descriptor.json,
 *      含八条跨字段规则(docs/spec.md 第七节);
 *   2) 清单与运行时 meta 的 Schema(schemas/manifest、schemas/runtime)及其正反例,
 *      副本与样例随 dsc-plugin-template 同步;
 *   3) 本仓库自身数据:package.json 派生的 meta.json 与构建产物 dist/meta.json。
 * 关键字白名单与 $id 规则对齐 dsc-plugin-template/scripts/validate-specs.mjs,
 * 语义覆盖本仓库用到的 JSON Schema 2020-12 子集 + 来源描述特有的跨字段规则。
 * 用法:
 *   node scripts/validate-specs.mjs                     自检
 *   node scripts/validate-specs.mjs <文件> [--schema descriptor|manifest|meta]  校验单个文档
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRAFT = 'https://json-schema.org/draft/2020-12/schema'
const SOURCE_SCHEMA_PATH = 'schemas/source-descriptor.schema.json'
const SCHEMA_FILES = {
  manifest: { path: 'schemas/manifest/plugin-manifest.schema.json', versionKey: 'manifest' },
  meta: { path: 'schemas/runtime/meta.json', versionKey: 'runtime_meta' },
}
const EXAMPLE_DIR = 'schemas/examples'
const INVALID_DIR = 'schemas/examples/invalid'
const SPEC_VERSION_FILE = 'specs/spec-version.json'

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

/* ---------- 来源描述的跨字段规则(docs/spec.md 第七节) ---------- */

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

/* ---------- 通用读取与装载 ---------- */

const readJson = (relativePath) => {
  const absolute = path.join(ROOT, relativePath)
  if (!existsSync(absolute)) {
    throw new Error('文件不存在: ' + relativePath)
  }
  return JSON.parse(readFileSync(absolute, 'utf8'))
}

const loadSourceSchema = () => {
  const document = readJson(SOURCE_SCHEMA_PATH)
  const errors = []
  walkSchema(document, '#', document, SOURCE_SCHEMA_PATH, errors)
  if (document.$schema !== DRAFT) {
    errors.push(SOURCE_SCHEMA_PATH + ': $schema 必须是 ' + DRAFT)
  }
  if (typeof document.$id !== 'string' || !document.$id.startsWith('https://')) {
    errors.push(SOURCE_SCHEMA_PATH + ': 必须提供 https 的 $id')
  } else if (!document.$id.endsWith(SOURCE_SCHEMA_PATH)) {
    errors.push(SOURCE_SCHEMA_PATH + ': $id 必须以文件路径结尾,当前为 ' + document.$id)
  }
  for (const field of ['title', 'description', '$comment', 'required', 'additionalProperties', '$defs', 'examples']) {
    if (!(field in document)) {
      errors.push(SOURCE_SCHEMA_PATH + ': 缺少顶层字段 ' + field)
    }
  }
  return { document, errors }
}

const loadSchema = (name) => {
  const relativePath = SCHEMA_FILES[name].path
  const document = readJson(relativePath)
  const errors = []
  walkSchema(document, '#', document, relativePath, errors)
  if (document.$schema !== DRAFT) {
    errors.push(relativePath + ': $schema 必须是 ' + DRAFT)
  }
  if (typeof document.$id !== 'string' || !document.$id.startsWith('https://')) {
    errors.push(relativePath + ': 必须提供 https 的 $id')
  } else if (!document.$id.endsWith(relativePath)) {
    errors.push(relativePath + ': $id 必须以文件路径结尾,当前为 ' + document.$id)
  }
  return { document, relativePath, errors }
}

const validateDocument = (schema, document) => {
  const errors = []
  validateNode(schema, document, '#', schema, errors)
  return errors
}

const deriveMetaFromPackage = () => {
  const pkg = readJson('package.json')
  const dsc = isPlainObject(pkg.dsc) ? pkg.dsc : null
  if (dsc === null) {
    throw new Error('package.json 缺少 dsc 块')
  }
  const meta = {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    description: dsc.description,
    author: pkg.author,
    repo_link: dsc.repo_link,
    dependencies: { dsc: dsc.engines },
  }
  if (dsc.home_page !== undefined) {
    meta.home_page = dsc.home_page
  }
  if (dsc.attached !== undefined) {
    meta.attached = dsc.attached
  }
  return meta
}

/* ---------- 清单与 meta 样例的归类 ---------- */

const fixtureSchemaName = (fileName) => (fileName.startsWith('meta.') ? 'meta' : 'manifest')

/* ---------- 自检 ---------- */

const failures = []
const report = (label, passed, detail) => {
  const suffix = detail === undefined || detail === '' ? '' : ': ' + detail
  console.log((passed ? '通过  ' : '失败  ') + label + suffix)
  if (!passed) {
    failures.push(label)
  }
}

console.log('[1/6] 规范版本与 Schema 文件')
const specVersion = readJson(SPEC_VERSION_FILE)
const versionFields = ['spec_version', 'dsc_core']
let versionOk = true
for (const field of versionFields) {
  if (typeof specVersion[field] !== 'string' || !/^\d+\.\d+\.\d+$/.test(specVersion[field])) {
    report(SPEC_VERSION_FILE + ' 字段 ' + field, false, '必须是三段数字')
    versionOk = false
  }
}
for (const name of Object.keys(SCHEMA_FILES)) {
  const expected = SCHEMA_FILES[name]
  const actual = isPlainObject(specVersion.schemas) ? specVersion.schemas[expected.versionKey] : undefined
  if (actual !== expected.path) {
    report(SPEC_VERSION_FILE + ' 的 schemas.' + expected.versionKey, false, '必须指向 ' + expected.path)
    versionOk = false
  }
}
if (versionOk) {
  report('规范版本与 Schema 路径', true, 'spec_version ' + specVersion.spec_version + ',dsc_core ' + specVersion.dsc_core)
}

console.log('[2/6] 清单与 meta Schema 结构')
const schemas = {}
for (const name of Object.keys(SCHEMA_FILES)) {
  const loaded = loadSchema(name)
  schemas[name] = loaded
  report(loaded.relativePath, loaded.errors.length === 0, loaded.errors.slice(0, 5).join('; '))
}

console.log('[3/6] 来源描述 Schema 自身静态检查: ' + SOURCE_SCHEMA_PATH)
const sourceSchema = loadSourceSchema()
report('Schema 关键字白名单、$ref、pattern、$id 与必备顶层字段', sourceSchema.errors.length === 0, sourceSchema.errors.slice(0, 5).join('; '))
const inlineExamples = isPlainObject(sourceSchema.document) && Array.isArray(sourceSchema.document.examples) ? sourceSchema.document.examples : []
if (inlineExamples.length === 0) {
  report(SOURCE_SCHEMA_PATH + ' 的 examples', false, '至少给出一条完整实例')
}
inlineExamples.forEach((example, index) => {
  const errors = validateDocument(sourceSchema.document, example)
  errors.push(...crossFieldCheck(example))
  report('内联 example[' + String(index) + '] ' + String(example.id), errors.length === 0, errors.slice(0, 3).join('; '))
})

console.log('[4/6] 来源描述正例: ' + EXAMPLE_DIR)
const allExampleFiles = readdirSync(path.join(ROOT, EXAMPLE_DIR)).filter((name) => name.endsWith('.json')).sort()
const descriptorFiles = allExampleFiles.filter((name) => name.endsWith('.descriptor.json'))
const fixtureFiles = allExampleFiles.filter((name) => !name.endsWith('.descriptor.json'))
if (descriptorFiles.length === 0) {
  report(EXAMPLE_DIR, false, '目录内没有 .descriptor.json 样例')
}
for (const fileName of descriptorFiles) {
  const relativePath = EXAMPLE_DIR + '/' + fileName
  const document = readJson(relativePath)
  const errors = validateDocument(sourceSchema.document, document)
  errors.push(...crossFieldCheck(document))
  report(relativePath, errors.length === 0, errors.slice(0, 3).join('; '))
}

console.log('[5/6] 清单与 meta 正反例')
for (const fileName of fixtureFiles) {
  const relativePath = EXAMPLE_DIR + '/' + fileName
  const schema = schemas[fixtureSchemaName(fileName)]
  const errors = validateDocument(schema.document, readJson(relativePath))
  report('正例 ' + relativePath, errors.length === 0, errors.slice(0, 3).join('; '))
}
const invalidFiles = existsSync(path.join(ROOT, INVALID_DIR))
  ? readdirSync(path.join(ROOT, INVALID_DIR)).filter((name) => name.endsWith('.json')).sort()
  : []
for (const fileName of invalidFiles) {
  const relativePath = INVALID_DIR + '/' + fileName
  const schema = schemas[fixtureSchemaName(fileName)]
  const errors = validateDocument(schema.document, readJson(relativePath))
  report('反例 ' + relativePath + ' 已被拒绝', errors.length > 0, errors.length > 0 ? '' : '未发现任何错误')
  if (errors.length > 0) {
    console.log('      首个错误: ' + errors[0])
  }
}

console.log('[6/6] 语义一致性与本仓库数据')
const summary = descriptorFiles.map((fileName) => {
  const document = readJson(EXAMPLE_DIR + '/' + fileName)
  const ids = (document.capabilities || []).map((capability) => capability.id).join(',')
  return fileName.replace('.descriptor.json', '') + ' [' + document.format + '] ' + ids
})
for (const line of summary) {
  console.log('      ' + line)
}
const helper = (document, id) => (document.capabilities || []).some((capability) => capability.id === id)
const anthropic = readJson(EXAMPLE_DIR + '/anthropic.descriptor.json')
report('anthropic 声明 vision:image 与 document:read', helper(anthropic, 'vision:image') && helper(anthropic, 'document:read'))
const deepseekDocument = readJson(EXAMPLE_DIR + '/deepseek.descriptor.json')
report('deepseek 不声明 vision:image 与 document:read', !helper(deepseekDocument, 'vision:image') && !helper(deepseekDocument, 'document:read'))
report('deepseek 用 max_tokens 且声明 1..393216', isPlainObject(deepseekDocument.capabilities[0].params) && deepseekDocument.capabilities[0].params.maxTokens === 'max_tokens' && deepseekDocument.capabilities[0].limits.maxTokens.min === 1 && deepseekDocument.capabilities[0].limits.maxTokens.max === 393216)
report('anthropic 用 x-api-key 且带 anthropic-version 固定头', anthropic.credential.headers[0].name === 'x-api-key' && anthropic.endpoints.chat.headers.some((header) => header.name === 'anthropic-version'))
const openaiDocument = readJson(EXAMPLE_DIR + '/openai.descriptor.json')
report('openai 用 Bearer 且 max_completion_tokens', openaiDocument.credential.headers[0].prefix === 'Bearer ' && openaiDocument.capabilities[0].params.maxTokens === 'max_completion_tokens')
const deepseekAnthropic = readJson(EXAMPLE_DIR + '/deepseek-anthropic.descriptor.json')
report('deepseek-anthropic 走 /anthropic/v1/messages 且用 x-api-key', deepseekAnthropic.format === 'anthropic-compatible' && deepseekAnthropic.endpoints.chat.path === '/anthropic/v1/messages' && deepseekAnthropic.credential.headers[0].name === 'x-api-key' && deepseekAnthropic.endpoints.chat.headers === undefined)

const metaErrors = validateDocument(schemas.meta.document, deriveMetaFromPackage())
report('package.json 派生的 meta.json', metaErrors.length === 0, metaErrors.join('; '))
if (existsSync(path.join(ROOT, 'dist/meta.json'))) {
  const distErrors = validateDocument(schemas.meta.document, readJson('dist/meta.json'))
  report('构建产物 meta.json', distErrors.length === 0, distErrors.join('; '))
}

if (failures.length > 0) {
  console.error('自检未通过,失败项 ' + String(failures.length) + ' 个')
  process.exitCode = 1
} else {
  console.log('自检通过: 1 份来源描述 Schema,' + String(inlineExamples.length) + ' 条内联实例,' + String(descriptorFiles.length) + ' 份来源描述正例,' + String(fixtureFiles.length) + ' 份清单与 meta 正例,' + String(invalidFiles.length) + ' 个反例')
}
