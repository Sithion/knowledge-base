/**
 * Thin wrapper around `@tauri-apps/api/core::invoke` that:
 *  - dynamically imports so the dashboard still builds + runs as a plain
 *    web page (no Tauri shell present),
 *  - throws a friendly error when called outside a Tauri context,
 *  - typed by command name → return shape.
 *
 * Wave-6 surface only — extend as commands are added.
 */

export const isTauri = !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;

export class NotInTauriError extends Error {
  constructor(cmd: string) {
    super(`Tauri command "${cmd}" is only available in the desktop app.`);
    this.name = 'NotInTauriError';
  }
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new NotInTauriError(cmd);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function tauriListen<T>(
  topic: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<T>(topic, (ev) => handler(ev.payload));
  return unlisten;
}

/** Open an external URL in the default browser via Tauri's process plugin. */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    // Tauri 2 exposes `shell` via plugin; if not configured we fall back
    // to `window.open` which works in the embedded webview.
    const mod = await import('@tauri-apps/plugin-process').catch(() => null);
    if (mod && (mod as any).Command) {
      // Best-effort: use `open` (macOS), `xdg-open` (linux), `start`
      // (windows). When the plugin isn't allowlisted in tauri.conf, fall
      // through to window.open below.
      const cmdName = navigator.platform.toLowerCase().includes('mac')
        ? 'open'
        : navigator.platform.toLowerCase().includes('win')
        ? 'cmd'
        : 'xdg-open';
      try {
        const c = (mod as any).Command.create(cmdName, cmdName === 'cmd' ? ['/c', 'start', url] : [url]);
        await c.execute();
        return;
      } catch {
        /* fall through */
      }
    }
  } catch {
    /* ignore */
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
