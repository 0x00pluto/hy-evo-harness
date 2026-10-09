// 宽侧栏只有嵌入或浮层。图标轨不进这组状态，收起按钮不会把它藏起来。
// 会话只活在内存里：冷启动是嵌入，不记住上次是否点亮浮层。

export function createChromeSession() {
  return {
    pinned: true,
    surface: 'workspace',
    canForward: false,
  };
}

export function canGoBack(session) {
  return session.surface === 'settings';
}

export function canCollapse(session) {
  return session.surface !== 'settings';
}

export function togglePin(session) {
  if (session.surface === 'settings') return session;
  return { ...session, pinned: !session.pinned, canForward: false };
}

export function enterSettings(session) {
  if (session.surface === 'settings') return session;
  return { ...session, surface: 'settings', canForward: false };
}

export function goBack(session) {
  if (session.surface !== 'settings') return session;
  return { ...session, surface: 'workspace', canForward: true };
}

export function goForward(session) {
  if (!session.canForward || session.surface !== 'workspace') return session;
  return { ...session, surface: 'settings', canForward: false };
}

export function clearForward(session) {
  if (!session.canForward) return session;
  return { ...session, canForward: false };
}

export function showUpdateDot(status) {
  return status === 'readyToInstall';
}

export function updateRowMode(status) {
  if (status === 'readyToInstall') return 'install';
  if (status === 'error') return 'retry';
  return 'hidden';
}
