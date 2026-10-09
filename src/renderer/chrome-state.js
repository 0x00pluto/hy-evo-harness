// 宽侧栏只有嵌入或浮层。图标轨不进这组状态，收起按钮不会把它藏起来。
// 会话只活在内存里：冷启动是工作区，不记住上次的表面或侧栏。

export function createChromeSession() {
  return {
    pinned: true,
    surface: 'workspace',
    pluginsFocus: null,
    back: null,
    forward: null,
  };
}

export function canGoBack(session) {
  if (session.surface === 'settings' || session.surface === 'plugins') return true;
  return session.surface === 'workspace' && session.back != null;
}

export function canGoForward(session) {
  return session.surface === 'workspace' && session.forward != null;
}

export function canCollapse(session) {
  return session.surface === 'workspace';
}

export function togglePin(session) {
  if (session.surface !== 'workspace') return session;
  return { ...session, pinned: !session.pinned, back: null, forward: null };
}

export function enterSettings(session) {
  if (session.surface === 'settings') return session;
  return {
    ...session,
    surface: 'settings',
    pluginsFocus: null,
    back: null,
    forward: null,
  };
}

export function enterPlugins(session) {
  if (session.surface === 'plugins') {
    if (session.pluginsFocus == null) return session;
    return { ...session, pluginsFocus: null };
  }
  return {
    ...session,
    surface: 'plugins',
    pluginsFocus: null,
    back: null,
    forward: null,
  };
}

export function selectPluginsFocus(session, pluginId) {
  if (session.surface !== 'plugins') return session;
  if (session.pluginsFocus === pluginId) return session;
  return { ...session, pluginsFocus: pluginId };
}

export function usePlugin(session, pluginId) {
  return {
    ...session,
    surface: 'workspace',
    pluginsFocus: null,
    back: { pluginId },
    forward: null,
  };
}

export function clearNavigation(session) {
  if (session.back == null && session.forward == null) return session;
  return { ...session, back: null, forward: null };
}

export function goBack(session) {
  if (session.surface === 'settings' || session.surface === 'plugins') {
    const forward = session.surface === 'settings'
      ? { surface: 'settings' }
      : { surface: 'plugins', pluginsFocus: session.pluginsFocus };
    return {
      ...session,
      surface: 'workspace',
      pluginsFocus: null,
      back: null,
      forward,
    };
  }
  if (session.surface === 'workspace' && session.back) {
    return {
      ...session,
      surface: 'plugins',
      pluginsFocus: session.back.pluginId,
      back: null,
      forward: null,
    };
  }
  return session;
}

export function goForward(session) {
  if (!canGoForward(session)) return session;
  const forward = session.forward;
  return {
    ...session,
    surface: forward.surface,
    pluginsFocus: forward.surface === 'plugins' ? forward.pluginsFocus : null,
    back: null,
    forward: null,
  };
}

export function splitWidthKey(surface) {
  if (surface === 'settings') return 'dex.settingsNavWidth';
  if (surface === 'plugins') return 'dex.pluginsNavWidth';
  return null;
}

export function showUpdateDot(status) {
  return status === 'readyToInstall';
}

export function updateRowMode(status) {
  if (status === 'readyToInstall') return 'install';
  if (status === 'error') return 'retry';
  return 'hidden';
}
