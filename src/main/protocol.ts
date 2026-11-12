import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const hookedPartitions = new Set<string>();

export interface PluginAssetContext {
  absPath: string;
  /** 宿主自管的真实根（如 plugin-runtime/<id>/env），词法仍须落在插件目录内。 */
  allowedRealRoots?: readonly string[];
}

export interface PluginPathLookup {
  resolveAssetContext(id: string): PluginAssetContext | undefined;
}

interface ElectronProtocolModule {
  protocol: {
    registerSchemesAsPrivileged: (
      schemes: Array<{ scheme: string; privileges: Record<string, boolean> }>,
    ) => void;
  };
  net: {
    fetch: (input: string) => Promise<Response>;
  };
  session: {
    fromPartition: (name: string) => {
      protocol: {
        handle: (scheme: string, handler: (request: Request) => Response | Promise<Response>) => void;
      };
    };
  };
}

/** 词法路径必须落在插件目录内。空路径、绝对路径和 `..` 都拒绝。 */
export function resolvePluginFile(absPath: string, relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0')) {
    return null;
  }
  const root = path.resolve(absPath);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return target;
}

function isUnderRealRoot(realRoot: string, realFile: string): boolean {
  const relative = path.relative(realRoot, realFile);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * 在词法校验之后再看真实路径。
 * 插件目录本身可以是开发软链接；目录内联接默认不能指到外部。
 * 可选 `allowedRealRoots`：允许真实文件落在宿主自管的 runtime env 内（已安装插件的 node_modules 联接）。
 */
export function resolvePluginAsset(
  absPath: string,
  relativePath: string,
  options?: { allowedRealRoots?: readonly string[] },
): string | null {
  const lexical = resolvePluginFile(absPath, relativePath);
  if (!lexical || !fs.existsSync(lexical)) return null;

  let realRoot: string;
  let realFile: string;
  try {
    realRoot = fs.realpathSync(absPath);
    realFile = fs.realpathSync(lexical);
  } catch {
    return null;
  }

  let allowed = isUnderRealRoot(realRoot, realFile);
  if (!allowed) {
    for (const candidate of options?.allowedRealRoots ?? []) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue;
      if (!fs.existsSync(candidate)) continue;
      let realAllowed: string;
      try {
        realAllowed = fs.realpathSync(candidate);
      } catch {
        continue;
      }
      if (isUnderRealRoot(realAllowed, realFile)) {
        allowed = true;
        break;
      }
    }
  }
  if (!allowed) return null;

  try {
    if (!fs.statSync(realFile).isFile()) return null;
  } catch {
    return null;
  }
  return realFile;
}

export function pluginPartition(pluginId: string): string {
  return `persist:hyplugin-${pluginId}`;
}

export function registerPluginScheme(): void {
  const { protocol } = require('electron') as ElectronProtocolModule;
  // Electron 只在 app ready 之前接受特权协议注册。
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app-plugin',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function ensurePluginProtocol(lookup: PluginPathLookup, partition: string): void {
  if (hookedPartitions.has(partition)) return;
  const { session, net } = require('electron') as ElectronProtocolModule;
  const partitionSession = session.fromPartition(partition);
  partitionSession.protocol.handle('app-plugin', (request) => {
    let pluginId = '';
    let filePath = '';
    try {
      const url = new URL(request.url);
      pluginId = url.hostname;
      filePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const context = lookup.resolveAssetContext(pluginId);
    if (!context) return new Response('Not found', { status: 404 });

    const asset = resolvePluginAsset(context.absPath, filePath, {
      allowedRealRoots: context.allowedRealRoots,
    });
    if (!asset) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(asset).toString());
  });
  hookedPartitions.add(partition);
}
