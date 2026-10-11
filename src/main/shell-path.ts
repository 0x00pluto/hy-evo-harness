import { execFile } from 'node:child_process';
import path from 'node:path';

/** 窗口进程不会读登录 shell 的配置。这两处是 Apple Silicon 和 Intel 上 Homebrew 的默认目录。 */
export const HOMEBREW_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'] as const;

const PATH_MARK = 'DEX_BUDDY_PATH';
const SHELL_TIMEOUT_MS = 5000;
const USER_PATH_KEY = 'HKCU\\Environment';
const MACHINE_PATH_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

export type PathReader = () => Promise<string | null>;

export interface UserSearchPathInput {
  platform: NodeJS.Platform;
  current: string | null | undefined;
  shellPath: string | null;
  registryPath: string | null;
}

/** 从登录 shell 的输出里取出 PATH。配置文件如果先打印了别的内容，标记外面的部分丢掉。 */
export function extractMarkedPath(output: string): string | null {
  const start = output.indexOf(PATH_MARK);
  if (start < 0) return null;
  const from = start + PATH_MARK.length;
  const end = output.indexOf(PATH_MARK, from);
  if (end < 0) return null;
  return output.slice(from, end);
}

/** `reg query ... /v Path` 的标准输出。没有这一值时返回 null。 */
export function parseRegPathValue(stdout: string): string | null {
  const match = /^\s*Path\s+REG_\w+\s+(.*)$/m.exec(stdout);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

export function expandWindowsPercent(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const found = env[name] ?? env[name.toUpperCase()] ?? env[name.toLowerCase()];
    return typeof found === 'string' ? found : whole;
  });
}

export function splitSearchPath(value: string | null | undefined, delimiter: string): string[] {
  if (!value) return [];
  return value.split(delimiter).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

export function mergeSearchPath(
  groups: readonly (readonly string[])[],
  options?: { delimiter?: string; caseInsensitive?: boolean },
): string {
  const delimiter = options?.delimiter ?? path.delimiter;
  const caseInsensitive = options?.caseInsensitive ?? false;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const trimmed = stripTrailingSep(entry.trim());
      if (!trimmed) continue;
      const key = caseInsensitive ? trimmed.replaceAll('/', '\\').toLowerCase() : trimmed;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(trimmed);
    }
  }
  return ordered.join(delimiter);
}

/**
 * 用户自己装的命令放在前面，Dex Buddy 原来的 PATH 留在后面。
 * macOS 始终带上 Homebrew 目录，这样登录 shell 超时也不会丢掉已经装好的命令。
 */
export function buildUserSearchPath(input: UserSearchPathInput): string {
  const windows = input.platform === 'win32';
  const delimiter = windows ? ';' : ':';
  const groups: string[][] = [];
  if (input.platform === 'darwin') groups.push([...HOMEBREW_DIRS]);
  if (windows) groups.push(splitSearchPath(input.registryPath, delimiter));
  else groups.push(splitSearchPath(input.shellPath, delimiter));
  groups.push(splitSearchPath(input.current, delimiter));
  return mergeSearchPath(groups, { delimiter, caseInsensitive: windows });
}

export async function collectUserSearchPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  read: { shell: PathReader; registry: PathReader },
): Promise<string> {
  let shellPath: string | null = null;
  let registryPath: string | null = null;
  try {
    if (platform === 'win32') registryPath = await read.registry();
    else shellPath = await read.shell();
  } catch {
    shellPath = null;
    registryPath = null;
  }
  return buildUserSearchPath({
    platform,
    current: env.PATH ?? env.Path,
    shellPath,
    registryPath,
  });
}

/** 写回调用方传入的环境。失败时仍写入合并结果，不抛错。 */
export async function applyUserSearchPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  read?: { shell: PathReader; registry: PathReader },
): Promise<void> {
  const sources = read ?? {
    shell: () => readLoginShellPath(env, platform),
    registry: () => readWindowsRegistryPath(env),
  };
  const next = await collectUserSearchPath(env, platform, sources);
  env.PATH = next;
  if (platform === 'win32') env.Path = next;
}

export function readLoginShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (platform === 'win32') return Promise.resolve(null);
  const shell = loginShell(env, platform);
  const script = `printf '%s%s%s' '${PATH_MARK}' "$PATH" '${PATH_MARK}'`;
  return new Promise((resolve) => {
    execFile(shell, ['-lc', script], {
      timeout: SHELL_TIMEOUT_MS,
      env,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (_err, stdout) => {
      // 有的登录配置会在打印 PATH 之后以非零退出。标记已经齐了就仍采用这段路径。
      resolve(extractMarkedPath(String(stdout ?? '')));
    });
  });
}

export async function readWindowsRegistryPath(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const user = await queryRegistryPath(USER_PATH_KEY);
  const machine = await queryRegistryPath(MACHINE_PATH_KEY);
  const parts = [user, machine].filter((value): value is string => Boolean(value));
  if (parts.length === 0) return null;
  return parts.map((value) => expandWindowsPercent(value, env)).join(';');
}

function loginShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const fromEnv = env.SHELL;
  if (typeof fromEnv === 'string' && fromEnv.startsWith('/') && !fromEnv.includes('\0')) return fromEnv;
  return platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

function queryRegistryPath(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', 'Path'], {
      timeout: SHELL_TIMEOUT_MS,
      windowsHide: true,
    }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(parseRegPathValue(String(stdout ?? '')));
    });
  });
}

function stripTrailingSep(entry: string): string {
  if (entry === '/' || /^[A-Za-z]:\\$/.test(entry)) return entry;
  return entry.replace(/[\\/]+$/, '');
}
