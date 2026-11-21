/*
 * 测试用的 TypeScript 解析钩子。
 *
 * 源码内部的相对导入按 Node 的 ESM 规则写成 .js 说明符(构建产物能直接运行),
 * 测试直接加载 src 下的 .ts 文件时,需要把 ./x.js 回退到 x.ts。
 * 这里只在原说明符解析失败时回退,不改变正常解析结果;
 * 只使用 node: 内置模块,不引入任何第三方依赖。
 *
 * 用法见 package.json 的 test 脚本:先加载本钩子,再交给 node --test。
 */
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const isRelative = (specifier) => specifier.startsWith('./') || specifier.startsWith('../')

const toTypeScript = (specifier) => specifier.replace(/\.js$/, '.ts')

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!isRelative(specifier) || !specifier.endsWith('.js') || context.parentURL === undefined) {
        throw error
      }
      const candidate = new URL(toTypeScript(specifier), context.parentURL)
      if (!existsSync(fileURLToPath(candidate))) {
        throw error
      }
      return nextResolve(candidate.href, context)
    }
  },
})
