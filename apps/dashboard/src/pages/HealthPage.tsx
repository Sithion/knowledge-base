/**
 * Health pane — Second Brain freshness + AI Stack POC gate state.
 *
 * Wired to Wave-3 Tauri commands:
 *  - `sb_freshness_check`             — re-check (no mutation)
 *  - `sb_freshness_pull_and_import`   — pull + sync
 *  - `sb_freshness_status`            — cached snapshot
 *
 * Subscribes to the `sb-freshness-event` Tauri event so progress streams
 * in live during long-running operations.
 *
 * Renders a graceful fallback when not running inside Tauri (the dashboard
 * is also served as a plain web app for development).
 */

import { useEffect, useState, useCallback } from 'react';
import { IntakePipelineHealthCard } from '../components/IntakePipelineHealthCard.js';

const isTauri = !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;

interface FreshnessStatus {
  enabled: boolean;
  configuredPath?: string | null;
  initialized: boolean;
  localSha?: string | null;
  remoteSha?: string | null;
  commitsBehind?: number | null;
  lastCheckedAt?: string | null;
  lastPulledAt?: string | null;
  lastImportedAt?: string | null;
  lastError?: string | null;
}

type FreshnessEvent =
  | { kind: 'check_started'; ts: string }
  | { kind: 'check_complete'; ts: string; localSha: string; remoteSha: string; isBehind: boolean; commitsBehind: number }
  | { kind: 'pull_started'; ts: string }
  | { kind: 'pull_complete'; ts: string; newSha: string; commitsPulled: number }
  | { kind: 'import_started'; ts: string; scriptPath: string }
  | { kind: 'import_complete'; ts: string; exitCode: number; stdoutTail: string; stderrTail: string }
  | { kind: 'failed'; ts: string; kind_?: string; message: string };

function shortSha(sha?: string | null): string {
  if (!sha) return '—';
  return sha.slice(0, 8);
}

function formatTs(ts?: string | null): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function statusColor(s: FreshnessStatus): string {
  if (!s.enabled) return 'var(--text-secondary)';
  if (!s.initialized) return 'var(--error, #ef4444)';
  if (s.lastError) return 'var(--error, #ef4444)';
  if ((s.commitsBehind ?? 0) > 0) return 'var(--warning, #f59e0b)';
  return 'var(--success, #10b981)';
}

function statusLabel(s: FreshnessStatus): string {
  if (!s.enabled) return 'Disabled by gate';
  if (!s.initialized) return 'Not initialized';
  if (s.lastError) return 'Error';
  const behind = s.commitsBehind ?? 0;
  if (behind > 0) return `Behind by ${behind} commit${behind === 1 ? '' : 's'}`;
  if (!s.lastCheckedAt) return 'Not yet checked';
  return 'In sync';
}

export function HealthPage() {
  const [status, setStatus] = useState<FreshnessStatus | null>(null);
  const [busy, setBusy] = useState<'check' | 'pull' | null>(null);
  const [log, setLog] = useState<FreshnessEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const s = await invoke<FreshnessStatus>('sb_freshness_status');
      setStatus(s);
    } catch (e: any) {
      setError(`Failed to load status: ${e?.message ?? e}`);
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    refreshStatus();
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<FreshnessEvent>('sb-freshness-event', (event) => {
        setLog((prev) => [...prev.slice(-49), event.payload]);
        // Refresh cached snapshot opportunistically
        refreshStatus();
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshStatus]);

  const handleCheck = async () => {
    if (!isTauri || busy) return;
    setBusy('check');
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sb_freshness_check');
      await refreshStatus();
    } catch (e: any) {
      setError(`Check failed: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const handlePullAndImport = async () => {
    if (!isTauri || busy) return;
    setBusy('pull');
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sb_freshness_pull_and_import');
      await refreshStatus();
    } catch (e: any) {
      setError(`Pull & re-import failed: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  if (!isTauri) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Health</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Health monitoring is only available in the desktop app.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22 }}>Health</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Second Brain freshness and AI Knowledge Stack integration state.
        </p>
      </div>

      {/* AI Stack POC gate banner */}
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: 10,
          border: `1px solid ${status?.enabled ? 'var(--success, #10b981)' : 'var(--border)'}`,
          padding: 16,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 24 }}>{status?.enabled ? '🟢' : '⚪'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            AI Stack POC orchestration: {status?.enabled ? 'enabled' : 'disabled'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Set <code>aiStack.enableSbOrchestration: true</code> (or env{' '}
            <code>COGNISTORE_ENABLE_SB_ORCHESTRATION=1</code>) to enable Second Brain integration.
          </div>
        </div>
      </div>

      {/* Freshness card */}
      <div
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: 10,
          border: `1px solid ${status ? statusColor(status) : 'var(--border)'}`,
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Second Brain freshness</h3>
          <span style={{ color: status ? statusColor(status) : undefined, fontWeight: 600, fontSize: 13 }}>
            {status ? statusLabel(status) : 'Loading…'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Managed clone path</span>
          <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {status?.configuredPath ?? '—'}
          </span>

          <span style={{ color: 'var(--text-secondary)' }}>Local HEAD</span>
          <span style={{ fontFamily: 'monospace' }}>{shortSha(status?.localSha)}</span>

          <span style={{ color: 'var(--text-secondary)' }}>Remote HEAD</span>
          <span style={{ fontFamily: 'monospace' }}>{shortSha(status?.remoteSha)}</span>

          <span style={{ color: 'var(--text-secondary)' }}>Last checked</span>
          <span>{formatTs(status?.lastCheckedAt)}</span>

          <span style={{ color: 'var(--text-secondary)' }}>Last pulled</span>
          <span>{formatTs(status?.lastPulledAt)}</span>

          <span style={{ color: 'var(--text-secondary)' }}>Last imported</span>
          <span>{formatTs(status?.lastImportedAt)}</span>

          {status?.lastError && (
            <>
              <span style={{ color: 'var(--text-secondary)' }}>Last error</span>
              <span style={{ color: 'var(--error, #ef4444)', fontFamily: 'monospace', fontSize: 12 }}>
                {status.lastError}
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button
            onClick={handleCheck}
            disabled={!isTauri || !status?.enabled || busy !== null}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-input, #111827)',
              color: 'var(--text)',
              cursor: !status?.enabled || busy !== null ? 'not-allowed' : 'pointer',
              opacity: !status?.enabled || busy !== null ? 0.5 : 1,
              fontSize: 13,
            }}
          >
            {busy === 'check' ? 'Checking…' : 'Check freshness'}
          </button>
          <button
            onClick={handlePullAndImport}
            disabled={!isTauri || !status?.enabled || !status.initialized || busy !== null}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: !status?.enabled || !status.initialized || busy !== null ? 'not-allowed' : 'pointer',
              opacity: !status?.enabled || !status.initialized || busy !== null ? 0.5 : 1,
              fontSize: 13,
            }}
          >
            {busy === 'pull' ? 'Pulling & re-importing…' : 'Pull & re-import'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: 'var(--error, #ef4444)', fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>

      {/* Intake pipeline (Wave 6) */}
      <IntakePipelineHealthCard enabled={!!status?.enabled} />

      {/* Recent events log */}
      {log.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: 10,
            border: '1px solid var(--border)',
            padding: 16,
          }}
        >
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Recent activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'monospace', fontSize: 11 }}>
            {log.slice().reverse().map((ev, i) => (
              <div
                key={i}
                style={{
                  color:
                    ev.kind === 'failed'
                      ? 'var(--error, #ef4444)'
                      : ev.kind.endsWith('_complete')
                      ? 'var(--success, #10b981)'
                      : 'var(--text-secondary)',
                }}
              >
                <span style={{ opacity: 0.6 }}>{formatTs(ev.ts)}</span>{' '}
                <strong>{ev.kind}</strong>
                {ev.kind === 'failed' && <> — {(ev as any).message}</>}
                {ev.kind === 'check_complete' && (
                  <> — {(ev as any).commitsBehind} behind</>
                )}
                {ev.kind === 'pull_complete' && (
                  <> — pulled {(ev as any).commitsPulled} commit(s)</>
                )}
                {ev.kind === 'import_complete' && (
                  <> — exit {(ev as any).exitCode}</>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
