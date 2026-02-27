export const WINDOW_CHANNELS = {
  hide: "window:hide",
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  state: "window:state",
  maximizedChanged: "window:maximized-changed",
} as const;

export const LEGACY_WINDOW_CHANNELS = {
  hide: "hidden",
  minimize: "minimize",
  toggleMaximize: "toggle-maximize",
  state: "get-window-state",
  maximizedChanged: "window-maximized-changed",
} as const;

export const DEFAULT_SEND_CHANNELS = [
  WINDOW_CHANNELS.hide,
  WINDOW_CHANNELS.minimize,
  WINDOW_CHANNELS.toggleMaximize,
  LEGACY_WINDOW_CHANNELS.hide,
  LEGACY_WINDOW_CHANNELS.minimize,
  LEGACY_WINDOW_CHANNELS.toggleMaximize,
] as const;

export const DEFAULT_INVOKE_CHANNELS = [
  WINDOW_CHANNELS.state,
  LEGACY_WINDOW_CHANNELS.state,
] as const;

export const DEFAULT_ON_CHANNELS = [
  WINDOW_CHANNELS.maximizedChanged,
  LEGACY_WINDOW_CHANNELS.maximizedChanged,
] as const;
