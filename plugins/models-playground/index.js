const path = require('node:path');
const { spawn } = require('node:child_process');
const { bindModels, childEnv } = require('./lib/dex-models');

function pickModel(list, kind, fallback) {
  const data = list && Array.isArray(list.data) ? list.data : [];
  const found = data.find((item) => item && item.kind === kind && typeof item.id === 'string');
  return found ? found.id : fallback;
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
      async chat(params) {
        const prompt = params && typeof params.prompt === 'string' ? params.prompt.trim() : '';
        const listed = await models.list();
        const model = pickModel(listed, 'chat', 'dexbuddy-chat');
        return models.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt || '用一句话介绍 Dex Buddy' }],
        });
      },
      async image(params) {
        const prompt = params && typeof params.prompt === 'string' ? params.prompt.trim() : '';
        const listed = await models.list();
        const model = pickModel(listed, 'image', 'dexbuddy-image');
        const outputPath = path.join(ctx.dirs.cache, `playground-${Date.now()}.png`);
        return models.images.generate({
          model,
          input: { prompt: prompt || '一只白色独角兽，简约插画' },
          outputPath,
        });
      },
      async pythonChat(params) {
        const prompt = params && typeof params.prompt === 'string' ? params.prompt.trim() : '';
        return runPython(ctx, { kind: 'chat', prompt });
      },
    });
  },

  dispose() {},
};
