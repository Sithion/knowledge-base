import { useCallback } from 'react';

export function useWidgetClose() {
  return useCallback(() => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().close();
    }).catch(() => {
      window.close();
    });
  }, []);
}
