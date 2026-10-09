// 渲染进程没有打包器，也不能解析裸导入。UMD 挂在 globalThis.lucide 上。
// 不从 lucide.mjs 桶文件导入：那个文件会把全部图标都接进模块图。
const ICON_NAMES = [
  'ArrowLeft',
  'ArrowRight',
  'PanelLeftClose',
  'PanelLeftOpen',
  'House',
  'Plus',
  'Ellipsis',
  'CircleUser',
  'Settings',
  'CircleHelp',
  'ChevronRight',
  'Download',
  'Puzzle',
  'Circle',
  'Tag',
  'ArrowUpRight',
  'Folder',
  'RefreshCw',
  'Trash2',
  'ExternalLink',
  'Eye',
  'EyeOff',
];

export function mountIcons(root = document) {
  const lucide = globalThis.lucide;
  if (!lucide || typeof lucide.createIcons !== 'function') return;
  const icons = {};
  for (const name of ICON_NAMES) {
    if (lucide[name]) icons[name] = lucide[name];
  }
  lucide.createIcons({
    icons,
    attrs: {
      width: 16,
      height: 16,
      'stroke-width': 1.5,
    },
    root,
  });
}
