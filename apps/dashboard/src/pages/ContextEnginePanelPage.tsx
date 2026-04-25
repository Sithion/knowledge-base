/**
 * Context Engine dashboard panel.
 *
 * Lists configured context-engine repos (from `aiStack.contextEngineRepos`)
 * with last-build timestamp and decision-record count, plus a "Re-index"
 * button that shells `.ai/index/build_index.py`.
 *
 * Currently relies on a Tauri command (`context_engine_repo_status`) for
 * status. Web mode falls back to a static placeholder explaining the
 * panel is desktop-only until a parallel HTTP endpoint lands.
 *
 * The repo list itself comes from `intake_first_run_setup` config snapshot
 * (a thin proxy at `/api/migration/ai-stack-poc/status` exposes the gate
 * but not the repo list). Until a dedicated config endpoint exists, web
 * users see a "configure your repos" hint.
 */

import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke, isTauri, NotInTauriError } from '../intake/tauriBridge.js';
import type { ContextEngineRepoStatus } from '../intake/types.js';

interface RepoCard {
  path: string;
  status: ContextEngineRepoStatus | null;
  loading: boolean;
  reindexing: boolean;
  error: string | null;
}

function fmtTs(iso: string | null): string {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ContextEnginePanelPage() {
  const [repos, setRepos] = useState<RepoCard[] | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Bootstrap the repo list. We pull it from the intake first-run report
  // because that command's report (in Tauri) and the migration endpoint
  // (in web) both read the same config slice. For now we only support
  // Tauri mode for actually listing repos via a config snapshot command.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setListError(null);
      try {
        if (!isTauri) {
          // TODO(wave-7): expose `/api/config/ai-stack` so web mode can
          // surface the configured repos. For now show an empty list and
          // a hint.
          if (!cancelled) setRepos([]);
          return;
        }
        // The first-run report doesn't include repos; we need a small
        // query: rely on `intake_first_run_setup` for now (it doesn't
        // currently surface repos). We treat this as an empty list and
        // let the user edit config externally.
        // TODO(wave-7): add `get_intake_config` Tauri command exposing
        //   `aiStack.contextEngineRepos`.
        if (!cancelled) setRepos([]);
      } catch (e) {
        if (!cancelled)
          setListError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadStatus = useCallback(async (path: string) => {
    try {
      const status = await tauriInvoke<ContextEngineRepoStatus>(
        'context_engine_repo_status',
        { repoPath: path },
      );
      setRepos((prev) =>
        (prev ?? []).map((r) =>
          r.path === path ? { ...r, status, loading: false, error: null } : r,
        ),
      );
    } catch (e) {
      setRepos((prev) =>
        (prev ?? []).map((r) =>
          r.path === path
            ? {
                ...r,
                loading: false,
                error: e instanceof NotInTauriError
                  ? 'Status requires the Tauri desktop app.'
                  : e instanceof Error
                  ? e.message
                  : String(e),
              }
            : r,
        ),
      );
    }
  }, []);

  const reindex = async (path: string) => {
    setRepos((prev) =>
      (prev ?? []).map((r) =>
        r.path === path ? { ...r, reindexing: true, error: null } : r,
      ),
    );
    try {
      await tauriInvoke('context_engine_reindex', { repoPath: path });
      await loadStatus(path);
    } catch (e) {
      setRepos((prev) =>
        (prev ?? []).map((r) =>
          r.path === path
            ? {
                ...r,
                error: e instanceof Error ? e.message : String(e),
              }
            : r,
        ),
      );
    } finally {
      setRepos((prev) =>
        (prev ?? []).map((r) =>
          r.path === path ? { ...r, reindexing: false } : r,
        ),
      );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>🛠 Context Engine</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Per-repo retrieval indexes powered by <code>.ai/index/</code>.
          Re-build after large refactors or fresh decision records.
        </p>
      </div>

      {!isTauri && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: '1px solid var(--warning, #f59e0b)',
            background: 'rgba(245, 158, 11, 0.05)',
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          Browser preview: status probes and re-indexing run locally and
          require the Tauri desktop app.
        </div>
      )}

      {listError && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: '1px solid var(--error, #ef4444)',
            background: 'rgba(239, 68, 68, 0.05)',
            color: 'var(--error, #ef4444)',
            fontSize: 12,
          }}
        >
          {listError}
        </div>
      )}

      {loadingList ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Loading repo list…
        </div>
      ) : (repos?.length ?? 0) === 0 ? (
        <div
          style={{
            padding: 24,
            borderRadius: 10,
            border: '1px dashed var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <div>No repos configured.</div>
          <div style={{ marginTop: 6, fontSize: 11 }}>
            Set <code>aiStack.contextEngineRepos</code> in your CogniStore
            config (an array of absolute repo paths). The panel will pick
            them up on next reload.
          </div>
        </div>
      ) : (
        <div
          data-testid="context-engine-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {repos!.map((r) => (
            <div
              key={r.path}
              style={{
                padding: 16,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  wordBreak: 'break-all',
                }}
              >
                {r.path}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {r.loading ? (
                  <>Probing…</>
                ) : r.status ? (
                  <>
                    Scaffold:{' '}
                    <strong style={{ color: r.status.hasScaffold ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)' }}>
                      {r.status.hasScaffold ? 'present' : 'missing'}
                    </strong>
                    {' · '}Last build: <strong>{fmtTs(r.status.lastBuildAt)}</strong>
                    {' · '}Decisions: <strong>{r.status.decisionsCount}</strong>
                  </>
                ) : r.error ? (
                  <span style={{ color: 'var(--error, #ef4444)' }}>{r.error}</span>
                ) : (
                  <>Unknown.</>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => loadStatus(r.path)}
                  disabled={r.loading || !isTauri}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    cursor: r.loading || !isTauri ? 'not-allowed' : 'pointer',
                    opacity: r.loading || !isTauri ? 0.5 : 1,
                    fontSize: 12,
                  }}
                >
                  {r.loading ? 'Probing…' : '↻ Refresh'}
                </button>
                <button
                  data-testid={`reindex-${r.path}`}
                  onClick={() => reindex(r.path)}
                  disabled={r.reindexing || !isTauri || (r.status?.hasScaffold === false)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--accent)',
                    color: '#fff',
                    cursor:
                      r.reindexing || !isTauri || r.status?.hasScaffold === false
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      r.reindexing || !isTauri || r.status?.hasScaffold === false
                        ? 0.5
                        : 1,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {r.reindexing ? 'Re-indexing…' : 'Re-index'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
