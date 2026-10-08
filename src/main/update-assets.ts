export const UPDATE_APP_SLUG = 'dex-buddy';
export const UPDATE_GITHUB_OWNER = '0x00pluto';
export const UPDATE_GITHUB_REPO = 'hy-evo-harness';

export interface UpdateFileRef {
  url: string;
  size?: number | null;
}

export function macDmgFileName(version: string): string {
  return `${UPDATE_APP_SLUG}-${version}.dmg`;
}

export function resolveMacDmgUrl(version: string, fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) {
    return fileUrl;
  }
  const name = fileUrl.split('/').pop() || fileUrl;
  return `https://github.com/${UPDATE_GITHUB_OWNER}/${UPDATE_GITHUB_REPO}/releases/download/v${version}/${name}`;
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
