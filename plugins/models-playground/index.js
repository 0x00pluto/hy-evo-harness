const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { bindModels, requireEntitlement, childEnv } = require('./lib/dex-buddy-sdk');
const { listedId } = require('./lib/mock-shop');

function pickModel(list, kind, fallback) {
  const data = list && Array.isArray(list.data) ? list.data : [];
  const found = data.find((item) => item && item.kind === kind && typeof item.id === 'string');
  return found ? found.id : fallback;
}

/**
 * 文案 / 图片各一份 key 文件。
 * 生成：换新 key（若上次 pending 失败则加一）。
 * 重放：同一把 last/in-flight key；没有历史则报错。
 * @param {string} cacheDir
 * @param {'chat' | 'image'} kind
 * @param {{ replay?: boolean }} [options]
 */
function takePlaygroundKey(cacheDir, kind, options) {
  const replay = !!(options && options.replay);
  const keyPath = path.join(cacheDir, `playground-${kind}-idempotency.json`);
  let n = 1;
  let pending = false;
  let exists = false;
  try {
    const saved = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    exists = true;
    if (saved && typeof saved.n === 'number' && saved.n >= 1) n = saved.n;
    pending = saved && saved.pending === true;
  } catch {
    // 首次或坏文件。
  }

  fs.mkdirSync(cacheDir, { recursive: true });

  let useN;
  if (replay) {
    if (!exists) {
      throw new Error('没有可重放的任务，请先生成一次');
    }
    useN = pending ? n : n - 1;
    if (useN < 1) {
      throw new Error('没有可重放的任务，请先生成一次');
    }
  } else {
    useN = pending ? n + 1 : n;
  }

  const key = `playground:${kind}:gen-${useN}`;
  fs.writeFileSync(keyPath, JSON.stringify({ n: useN, pending: true }));
  return {
    key,
    markSucceeded() {
      fs.writeFileSync(keyPath, JSON.stringify({ n: useN + 1, pending: false }));
    },
  };
}

function pythonBin(ctx) {
  if (ctx.runtime && typeof ctx.runtime.python === 'string' && ctx.runtime.python) {
    return ctx.runtime.python;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function runPython(ctx, payload) {
  return childEnv(ctx, { ...process.env, ...(ctx.pluginEnv ? ctx.pluginEnv() : {}) }).then((env) => {
    return new Promise((resolve, reject) => {
      const child = spawn(pythonBin(ctx), [path.join(__dirname, 'python', 'generate.py')], {
        cwd: __dirname,
        env,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `python 退出码 ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(stdout.trim() || 'python 没有返回 JSON'));
        }
      });
      child.stdin.end(JSON.stringify(payload));
    });
  });
}

module.exports = {
  apply(ctx) {
    const models = bindModels(ctx);
    ctx.registerService('modelsPlayground', {
      async checkAccess() {
        await requireEntitlement(ctx);
        return { ok: true };
      },
      async checkOwned() {
        await requireEntitlement(ctx, { pluginId: listedId, mockOwned: true });
        return { ok: true, entitled: true };
      },
      async checkUnowned() {
        await requireEntitlement(ctx, { pluginId: listedId, mockOwned: false });
        return { ok: true, entitled: true };
      },
      async chat(params) {
        const prompt = params && typeof params.prompt === 'string' ? params.prompt.trim() : '';
        const replay = !!(params && params.replay);
        const slot = takePlaygroundKey(ctx.dirs.cache, 'chat', { replay });
        const listed = await models.list();
        const model = pickModel(listed, 'chat', 'dexbuddy-chat');
        const body = await models.chat.completions.create(
          {
            model,
            messages: [{ role: 'user', content: prompt || '用一句话介绍 Dex Buddy' }],
          },
          { idempotencyKey: slot.key },
        );
        slot.markSucceeded();
        return body;
      },
      async image(params) {
        const prompt = params && typeof params.prompt === 'string' ? params.prompt.trim() : '';
        const replay = !!(params && params.replay);
        const listed = await models.list();
        const model = pickModel(listed, 'image', 'dexbuddy-image');
        const outputPath = path.join(ctx.dirs.cache, `playground-${Date.now()}.png`);
        const slot = takePlaygroundKey(ctx.dirs.cache, 'image', { replay });
        const result = await models.images.generate(
          {
            model,
            input: { prompt: prompt || '一只白色独角兽，简约插画' },
            outputPath,
          },
          { idempotencyKey: slot.key },
        );
        slot.markSucceeded();
        return result;
      },
      async pythonChat(params) {
        const prompt = params && typeof params.prompt === 'string' ? params.prompt.trim() : '';
        return runPython(ctx, { kind: 'chat', prompt });
      },
    });
  },

  dispose() {},
};
