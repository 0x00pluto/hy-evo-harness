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

/** 插件资源失败（协议 404 或分区 webRequest），推给宿主窗展示与复制。 */
export type PluginAssetErrorReporter = (event: {
  pluginId: string;
  url: string;
  kind: 'protocol-404' | 'web-request';
  resourceType?: string;
  error?: string;
}) => void;

const ASSET_ERROR_TYPES = new Set(['script', 'stylesheet']);

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
      webRequest: {
        onErrorOccurred: (
          filter: { urls: string[] } | null,
          listener:
            | ((details: {
                url: string;
                resourceType: string;
                error: string;
              }) => void)
            | null,
        ) => void;
      };
      clearCache: () => Promise<void>;
    };
  };
}

/** 插件静态资源须每次向磁盘校验；覆盖安装后同一 URL 内容会变。不用 no-store，以免误伤 bfcache。 */
export function pluginAssetResponseHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-cache' };
}

export function pluginAssetResponse(body: BodyInit | null, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(pluginAssetResponseHeaders())) {
    headers.set(key, value);
  }
  return new Response(body, { ...init, headers });
}

export async function withPluginAssetCacheHeaders(source: Response): Promise<Response> {
  const headers = new Headers(source.headers);
  for (const [key, value] of Object.entries(pluginAssetResponseHeaders())) {
    headers.set(key, value);
  }
  return new Response(source.body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/**
 * 清掉该插件 persist 分区的 HTTP 缓存。覆盖安装后同一 app-plugin URL 可能仍命中旧正文或旧 404。
 * 失败只打日志，不让安装/卸载失败。
 */
export async function clearPluginPartitionCache(pluginId: string): Promise<void> {
  if (typeof pluginId !== 'string' || pluginId.trim() === '') return;
  try {
    const { session } = require('electron') as ElectronProtocolModule;
    await session.fromPartition(pluginPartition(pluginId)).clearCache();
  } catch (err) {
    console.error(
      `[protocol] 清理插件分区缓存失败 (${pluginId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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

function reportProtocol404(
  onAssetError: PluginAssetErrorReporter | undefined,
  pluginId: string,
  url: string,
): void {
  if (!onAssetError || !pluginId) return;
  onAssetError({
    pluginId,
    url,
    kind: 'protocol-404',
    error: 'Not found',
  });
}

/**
 * 每个 partition 只挂一次 app-plugin 协议。
 * 可选 onAssetError：协议回 404，以及同分区 script/stylesheet 的 webRequest 错误。
 */
export function ensurePluginProtocol(
  lookup: PluginPathLookup,
  partition: string,
  onAssetError?: PluginAssetErrorReporter,
): void {
  if (hookedPartitions.has(partition)) return;
  const { session, net } = require('electron') as ElectronProtocolModule;
  const partitionSession = session.fromPartition(partition);
  partitionSession.protocol.handle('app-plugin', async (request) => {
    let pluginId = '';
    let filePath = '';
    try {
      const url = new URL(request.url);
      pluginId = url.hostname;
      filePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return pluginAssetResponse('Bad request', { status: 400 });
    }

    const context = lookup.resolveAssetContext(pluginId);
    if (!context) {
      reportProtocol404(onAssetError, pluginId, request.url);
      return pluginAssetResponse('Not found', { status: 404 });
    }

    const asset = resolvePluginAsset(context.absPath, filePath, {
      allowedRealRoots: context.allowedRealRoots,
    });
    if (!asset) {
      reportProtocol404(onAssetError, pluginId, request.url);
      return pluginAssetResponse('Not found', { status: 404 });
    }
    const fetched = await net.fetch(pathToFileURL(asset).toString());
    return withPluginAssetCacheHeaders(fetched);
  });

  if (onAssetError) {
    try {
      partitionSession.webRequest.onErrorOccurred(
        { urls: ['app-plugin://*/*', '*://*/*'] },
        (details) => {
        if (!ASSET_ERROR_TYPES.has(details.resourceType)) return;
        let pluginId = '';
        try {
          pluginId = new URL(details.url).hostname;
        } catch {
          return;
        }
        if (!pluginId) return;
        onAssetError({
          pluginId,
          url: details.url,
          kind: 'web-request',
          resourceType: details.resourceType,
          error: details.error,
        });
      });
    } catch (err) {
      console.error(
        `[protocol] 挂载 webRequest.onErrorOccurred 失败 (${partition}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  hookedPartitions.add(partition);
}
