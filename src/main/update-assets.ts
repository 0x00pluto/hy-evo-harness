export const UPDATE_APP_SLUG = 'dex-buddy';
// 末尾不要加斜杠。electron-builder 的 publish.url 必须带斜杠，两边指向同一目录。
export const UPDATE_FEED_BASE_URL = 'https://oss.ai.66plat.com/dex-buddy';

export interface UpdateFileRef {
  url: string;
  size?: number | null;
}

export function macDmgFileName(version: string): string {
  return `${UPDATE_APP_SLUG}-${version}.dmg`;
}

export function resolveMacDmgUrl(_version: string, fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) {
    return fileUrl;
  }
  const name = fileUrl.split('/').pop() || fileUrl;
  return `${UPDATE_FEED_BASE_URL}/${name}`;
}

export function extractMacDmgInfo(info: {
  version: string;
  files?: UpdateFileRef[] | null;
}): { url: string; size: number | null } {
  const dmgFile = info.files?.find((file) => file.url.endsWith('.dmg'));
  if (dmgFile) {
    return {
      url: resolveMacDmgUrl(info.version, dmgFile.url),
      size: dmgFile.size ?? null,
    };
  }
  return {
    url: resolveMacDmgUrl(info.version, macDmgFileName(info.version)),
    size: null,
  };
}
