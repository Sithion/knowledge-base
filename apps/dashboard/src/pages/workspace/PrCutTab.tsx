/**
 * PR-cut tab — runs Phase B (`run_pr_cut`) against the current run's
 * branch, captures the PR URL from the lifecycle event stream, offers
 * "Open in browser".
 */

import { useState } from 'react';
import { ModelPicker } from '../../intake/components/ModelPicker.js';
import { TranscriptView } from '../../intake/components/TranscriptView.js';
import {
  tauriInvoke,
  isTauri,
  NotInTauriError,
  openExternal,
} from '../../intake/tauriBridge.js';
import { useWorkspace } from '../../intake/workspaceStore.js';
import type { PrCutResult } from '../../intake/types.js';

export function PrCutTab() {
  const { state, setPrCutModel, runStarted, runFinished, resetRun, setTab } =
    useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun =
    !!state.currentRunId &&
    state.status !== 'running' &&
    state.phase !== 'pr-cut';

  const handleRun = async () => {
    if (!state.currentRunId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await tauriInvoke<PrCutResult>('run_pr_cut', {
        args: { runId: state.currentRunId, model: state.prCutModel },
      });
      const sessionId = `pr-cut:${result.runId}`;
      runStarted(result.runId, sessionId, 'pr-cut');
      runFinished(result.status, {
        errorMessage: result.errorMessage,
        prUrl: result.prUrl,
      });
    } catch (e) {
      if (e instanceof NotInTauriError) {
        setError('PR-cut requires the Tauri desktop app.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

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
        No run available. Approve a run on the Review tab first.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 16,
          alignItems: 'center',
          padding: 16,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
        }}
      >
        <div>
          <ModelPicker
            label="PR-cut model"
            value={state.prCutModel}
            onChange={setPrCutModel}
            compact
          />
        </div>
        <div>
          <button
            data-testid="run-pr-cut"
            onClick={handleRun}
            disabled={!canRun || busy || !isTauri}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: !canRun || busy || !isTauri ? 'not-allowed' : 'pointer',
              opacity: !canRun || busy || !isTauri ? 0.5 : 1,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {busy ? 'Cutting PR…' : '🚀 Cut PR'}
          </button>
        </div>
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
          Browser preview: cutting a PR requires the Tauri desktop app.
        </div>
      )}

      {state.prUrl && (
        <div
          data-testid="pr-url-card"
          style={{
            padding: 16,
            borderRadius: 10,
            border: '1px solid var(--success, #10b981)',
            background: 'rgba(16, 185, 129, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong style={{ color: 'var(--success, #10b981)' }}>
              ✓ Pull request opened
            </strong>
            <a
              href={state.prUrl}
              onClick={(e) => {
                e.preventDefault();
                openExternal(state.prUrl!);
              }}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: 'var(--accent)',
                wordBreak: 'break-all',
              }}
            >
              {state.prUrl}
            </a>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => openExternal(state.prUrl!)}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Open ↗
            </button>
            <button
              onClick={() => {
                resetRun();
                setTab('inbox');
              }}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              New run
            </button>
          </div>
        </div>
      )}

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

      <TranscriptView lines={state.transcript} />
    </div>
  );
}
