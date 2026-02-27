const WINDOW_CHANNELS = {
  hide: "window:hide",
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  state: "window:state",
  maximizedChanged: "window:maximized-changed"
};
const LEGACY_WINDOW_CHANNELS = {
  hide: "hidden",
  minimize: "minimize",
  toggleMaximize: "toggle-maximize",
  state: "get-window-state",
  maximizedChanged: "window-maximized-changed"
};
const DEFAULT_SEND_CHANNELS = [
  WINDOW_CHANNELS.hide,
  WINDOW_CHANNELS.minimize,
  WINDOW_CHANNELS.toggleMaximize,
  LEGACY_WINDOW_CHANNELS.hide,
  LEGACY_WINDOW_CHANNELS.minimize,
  LEGACY_WINDOW_CHANNELS.toggleMaximize
];
const DEFAULT_INVOKE_CHANNELS = [
  WINDOW_CHANNELS.state,
  LEGACY_WINDOW_CHANNELS.state
];
const DEFAULT_ON_CHANNELS = [
  WINDOW_CHANNELS.maximizedChanged,
  LEGACY_WINDOW_CHANNELS.maximizedChanged
];

export { DEFAULT_INVOKE_CHANNELS as D, LEGACY_WINDOW_CHANNELS as L, WINDOW_CHANNELS as W, DEFAULT_ON_CHANNELS as a, DEFAULT_SEND_CHANNELS as b };
