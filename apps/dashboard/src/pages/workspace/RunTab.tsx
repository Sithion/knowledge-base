/**
 * Run tab — selects the intake model, kicks off `run_intake`, and shows
 * a live transcript. Cancel button calls the new `cancel_intake_run`
 * command (signal to the agent process; runner cleans up on next yield).
 */

import { useState } from 'react';
import { ModelPicker } from '../../intake/components/ModelPicker.js';
import { TranscriptView } from '../../intake/components/TranscriptView.js';
import { tauriInvoke, isTauri, NotInTauriError } from '../../intake/tauriBridge.js';
import { useWorkspace } from '../../intake/workspaceStore.js';
import type { IntakeResult } from '../../intake/types.js';

export function RunTab() {
  const {
    state,
    setIntakeModel,
    runStarted,
    runFinished,
    setTab,
  } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun =
    !!state.projectSlug &&
    state.stagedFiles.length > 0 &&
    state.status !== 'running';

  const handleRun = async () => {
    if (!state.projectSlug || state.stagedFiles.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const result = await tauriInvoke<IntakeResult>('run_intake', {
        args: {
          projectSlug: state.projectSlug,
          inboxFiles: state.stagedFiles.map((f) => f.path),
          model: state.intakeModel,
        },
      });
      // Session id is `intake:<run_id>` per runner.rs.
      const sessionId = `intake:${result.runId}`;
      runStarted(result.runId, sessionId, 'intake');
      runFinished(result.status, {
        branch: result.branchName,
        errorMessage: result.errorMessage,
      });
      if (result.status === 'success') {
        setTab('review');
      }
    } catch (e) {
      if (e instanceof NotInTauriError) {
        setError('Run requires the Tauri desktop app — not available in browser preview.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!state.currentSessionId) return;
    try {
      await tauriInvoke('cancel_intake_run', { sessionId: state.currentSessionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
            label="Intake model"
            value={state.intakeModel}
            onChange={setIntakeModel}
            compact
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {state.status === 'running' ? (
            <button
              data-testid="cancel-run"
              onClick={handleCancel}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: '1px solid var(--error, #ef4444)',
                background: 'transparent',
                color: 'var(--error, #ef4444)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              data-testid="run-intake"
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
              {busy ? 'Starting…' : '▶ Run intake'}
            </button>
          )}
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
          Browser preview: triggering a run requires the Tauri desktop app.
        </div>
      )}

      {!state.projectSlug && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Pick a project on the Inbox tab first.
        </div>
      )}
      {state.projectSlug && state.stagedFiles.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Stage at least one file before running.
        </div>
      )}

      {state.currentRunId && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            <strong>Run:</strong>{' '}
            <code style={{ fontFamily: 'monospace' }}>{state.currentRunId}</code>
          </div>
          {state.currentBranch && (
            <div>
              <strong>Branch:</strong>{' '}
              <code style={{ fontFamily: 'monospace' }}>{state.currentBranch}</code>
            </div>
          )}
          {state.status && (
            <div>
              <strong>Status:</strong> {state.status}
            </div>
          )}
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
      {state.errorMessage && (
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
          <strong>Run failed:</strong> {state.errorMessage}
        </div>
      )}

      <TranscriptView lines={state.transcript} />
    </div>
  );
}
