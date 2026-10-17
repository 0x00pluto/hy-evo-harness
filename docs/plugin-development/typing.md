# 后端 JavaScript

[返回目录](README.md)

插件后端仍是 CommonJS 的 `.js`。`plugin.manifest.json` 的 `main` 继续指向现有入口，例如 `index.js`。本页是写法约定，用来把 JavaScript 写得更严；宿主不检查你有没有开检查，检查不过也不阻止挂载。

不要把入口改成 `.ts`，也不要靠编译出一份 `dist/` 再发版。插件中心从 tag 复制源文件打 zip，不会替你跑编译。

页面仍是 HTML / JS，本页不管页面。

## 文件顶上打开检查

入口文件第一行写：

```javascript
// @ts-check
```

编辑器会按类型规则标红。本机也可以装 TypeScript，只用来检查、不产出：

```bash
pnpm add -D typescript
pnpm exec tsc --noEmit
```

可选的根上 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "strict": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "commonjs"
  },
  "include": ["*.js"]
}
```

`include` 用 `*.js`，同目录拆出去的文件也会进检查。`strict` 会拦住缺类型。

## 防线纪律

- 禁止写 `/** @type {any} */`，也不要把未标注的值当任意对象用。
- 外部传入的 `params` 一律先当 `unknown`，用小函数收窄（见下面的 `textFrom`），不要一步断言成业务大对象。
- 允许把已确认是对象的值收窄成 `{ text?: unknown }` 这类窄形状，再读字段；不允许断言成 `any`。

不确定时标成 `unknown`，再用 `typeof` 或字段检查收窄。

## 用 JSDoc 标形状

服务的参数和返回值必须是普通数据，见 [运行](runtime.md)。在 JSDoc 里把形状写清楚。给整份导出标上 `PluginModule`，漏写或拼错 `apply` 时检查会报；`dispose` 可选。

```javascript
// @ts-check

/**
 * @typedef {{ info: (msg: string) => void; error: (msg: string) => void }} Logger
 * @typedef {{
 *   logger: Logger;
 *   registerService: (name: string, service: Record<string, Function>) => void;
 * }} AppContext
 * @typedef {{
 *   apply: (ctx: AppContext) => void | Promise<void>;
 *   dispose?: () => void | Promise<void>;
 * }} PluginModule
 */

/**
 * @param {unknown} params
 * @returns {string}
 */
function textFrom(params) {
  if (!params || typeof params !== 'object') return '';
  const text = /** @type {{ text?: unknown }} */ (params).text;
  return typeof text === 'string' ? text : '';
}

/**
 * @type {PluginModule}
 */
module.exports = {
  apply(ctx) {
    ctx.logger.info('我的工具已挂载');
    ctx.registerService('myToolService', {
      /**
       * @param {unknown} params
       */
      async run(params) {
        const text = textFrom(params);
        return { success: true, text };
      },
    });
  },

  dispose() {
    // 关掉 apply 里保存的定时器、子进程
  },
};
```

本仓库不发布官方插件 `.d.ts`。只用到的 `ctx` 字段在本地用 `@typedef` 声明即可，不要另建 `types.js` 专门给检查用。

## 拆成多个文件时

单文件可以不管这一节。拆出 `utils.js` 时，被 `require` 的文件也要有 `// @ts-check` 和 JSDoc，推导才稳。入口里可以这样写：

```javascript
/** @type {typeof import('./utils')} */
const utils = require('./utils');
```

## 和发布的关系

交给同事或插件中心的仍是这份 `index.js`（以及清单里写的路径）。不要另交一份编译目录。`tsconfig.json` 可以进仓库方便本机检查，也可以不进包；打 zip 的规则见 [打包](pack.md)。
