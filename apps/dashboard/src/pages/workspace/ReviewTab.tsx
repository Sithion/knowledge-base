/**
 * Review tab — fetches the unified diff for the current run's intake
 * branch via `git_diff_intake_branch`, lets the operator scan it, then
 * either Approve (advance to PR-cut tab) or Reject (clear current run).
 *
 * Rejection is non-destructive on the Rust side — the branch lingers
 * in the managed clone for forensic value. Cleanup is a separate concern.
 */

import { useCallback, useEffect, useState } from 'react';
import { DiffViewer } from '../../intake/components/DiffViewer.js';
import { tauriInvoke, isTauri, NotInTauriError } from '../../intake/tauriBridge.js';
import { useWorkspace } from '../../intake/workspaceStore.js';

export function ReviewTab() {
  const { state, setTab, resetRun } = useWorkspace();
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!state.currentRunId) return;
    setLoading(true);
    setError(null);
    try {
      const out = await tauriInvoke<string>('git_diff_intake_branch', {
        runId: state.currentRunId,
      });
      setDiff(out);
    } catch (e) {
      if (e instanceof NotInTauriError) {
        setError('Diff viewer requires the Tauri desktop app.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [state.currentRunId]);

  useEffect(() => {
    if (state.currentRunId && isTauri) {
      load();
    }
  }, [load, state.currentRunId]);

  if (!state.currentRunId) {
    return (
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
        No run to review yet. Start an intake on the Run tab first.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          fontSize: 12,
        }}
      >
        <div>
          <strong>Run:</strong>{' '}
          <code style={{ fontFamily: 'monospace' }}>{state.currentRunId}</code>
          {state.currentBranch && (
            <>
              {' · '}
              <strong>Branch:</strong>{' '}
              <code style={{ fontFamily: 'monospace' }}>{state.currentBranch}</code>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12,
            }}
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button
            data-testid="reject-run"
            onClick={() => {
              if (confirm('Reject this run and clear workspace state? The branch is preserved.')) {
                resetRun();
                setTab('inbox');
              }
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--error, #ef4444)',
              background: 'transparent',
              color: 'var(--error, #ef4444)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ✗ Reject
          </button>
          <button
            data-testid="approve-run"
            onClick={() => setTab('pr-cut')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--success, #10b981)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ✓ Approve → PR-cut
          </button>
        </div>
      </div>

      {error && (
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
          {error}
        </div>
      )}

      {loading && !diff && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          Loading diff…
        </div>
      )}

      {diff !== null && <DiffViewer diff={diff} />}
    </div>
  );
}
