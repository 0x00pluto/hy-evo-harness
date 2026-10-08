import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const hookedPartitions = new Set<string>();

export interface PluginPathLookup {
  getPlugin(id: string): { absPath: string } | undefined;
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

/**
 * 在词法校验之后再看真实路径。
 * 插件目录本身可以是开发软链接，但目录内的符号链接不能指向外部文件。
 */
export function resolvePluginAsset(absPath: string, relativePath: string): string | null {
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

  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

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

    const plugin = lookup.getPlugin(pluginId);
    if (!plugin) return new Response('Not found', { status: 404 });

    const asset = resolvePluginAsset(plugin.absPath, filePath);
    if (!asset) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(asset).toString());
  });
  hookedPartitions.add(partition);
}
