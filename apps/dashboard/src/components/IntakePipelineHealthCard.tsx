/**
 * Intake-pipeline health card. Embedded into HealthPage.
 *
 * Three rows:
 *   1. Copilot CLI presence + auth (from `intake_first_run_setup`).
 *   2. Lock state (from `intake_lock_state`).
 *   3. Last run summary (from `intake_list_audit_records[0]`).
 *
 * Plus a button that opens the FirstRunWizard modal.
 */

import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke, isTauri, NotInTauriError } from '../intake/tauriBridge.js';
import type {
  FirstRunReport,
  IntakeAuditRecord,
  IntakeLockState,
} from '../intake/types.js';
import { FirstRunWizard } from '../intake/components/FirstRunWizard.js';

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const color = warn ? 'var(--warning, #f59e0b)' : ok ? 'var(--success, #10b981)' : 'var(--error, #ef4444)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        marginRight: 8,
      }}
    />
  );
}

export function IntakePipelineHealthCard({ enabled }: { enabled: boolean }) {
  const [report, setReport] = useState<FirstRunReport | null>(null);
  const [lock, setLock] = useState<IntakeLockState | null>(null);
  const [lastRun, setLastRun] = useState<IntakeAuditRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      // Fire all three commands in parallel; Tauri-only.
      const [r, l, audit] = await Promise.all([
        tauriInvoke<FirstRunReport>('intake_first_run_setup').catch((e) => {
          throw e;
        }),
        tauriInvoke<IntakeLockState>('intake_lock_state').catch((e) => {
          throw e;
        }),
        tauriInvoke<IntakeAuditRecord[]>('intake_list_audit_records').catch((e) => {
          throw e;
        }),
      ]);
      setReport(r);
      setLock(l);
      setLastRun(audit?.[0] ?? null);
    } catch (e) {
      if (e instanceof NotInTauriError) {
        setError('Intake pipeline health requires the Tauri desktop app.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled && isTauri) {
      refresh();
    }
  }, [enabled, refresh]);

  return (
    <div
      data-testid="intake-pipeline-health"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        padding: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>Intake pipeline</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={refresh}
            disabled={!enabled || !isTauri || loading}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-input, #111827)',
              color: 'var(--text)',
              cursor: !enabled || !isTauri || loading ? 'not-allowed' : 'pointer',
              opacity: !enabled || !isTauri || loading ? 0.5 : 1,
              fontSize: 12,
            }}
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button
            data-testid="open-first-run-wizard"
            onClick={() => setWizardOpen(true)}
            disabled={!isTauri}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: !isTauri ? 'not-allowed' : 'pointer',
              opacity: !isTauri ? 0.5 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Setup intake pipeline
          </button>
        </div>
      </div>

      {!enabled && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Enable <code>aiStack.enableSbOrchestration</code> to surface intake-pipeline state.
        </div>
      )}

      {enabled && (
        <>
          {error && (
            <div
              style={{
                padding: 10,
                borderRadius: 6,
                border: '1px solid var(--error, #ef4444)',
                color: 'var(--error, #ef4444)',
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          {/* Row 1: Copilot CLI */}
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              marginBottom: 8,
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <StatusDot
                ok={!!(report?.copilotPresent && report.copilotAuthed)}
                warn={!!report?.copilotPresent && !report.copilotAuthed}
              />
              <strong>Copilot CLI</strong>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 18 }}>
              {report
                ? `${report.copilotPresent ? 'present' : 'missing'} · ${report.copilotAuthed ? 'authed' : 'not authed'}`
                : 'unknown'}
            </div>
          </div>

          {/* Row 2: Lock state */}
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              marginBottom: 8,
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <StatusDot ok={!lock?.held} warn={!!lock?.lockFileExists && !lock?.held} />
              <strong>Managed-clone lock</strong>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 18 }}>
              {lock ? (
                <>
                  {lock.held ? 'held by another process' : 'free'}
                  {lock.lockFileExists && !lock.held && ' · stale lock file present'}
                  <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 2 }}>
                    {lock.managedClonePath}
                  </div>
                </>
              ) : (
                'unknown'
              )}
            </div>
          </div>

          {/* Row 3: Last run */}
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <StatusDot
                ok={lastRun?.status === 'success'}
                warn={lastRun?.status === 'running' || lastRun?.status === 'pending'}
              />
              <strong>Last run</strong>
              {lastRun && (
                <span
                  style={{
                    marginLeft: 8,
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {lastRun.runId}
                </span>
              )}
            </div>
            {lastRun ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 18 }}>
                {lastRun.projectSlug} · {lastRun.phase} · {lastRun.status} ·{' '}
                {fmtTs(lastRun.startedAt)}
                {lastRun.errorMessage && (
                  <div style={{ color: 'var(--error, #ef4444)', marginTop: 4 }}>
                    {lastRun.errorMessage}
                  </div>
                )}
                {lastRun.prUrl && (
                  <div style={{ marginTop: 4 }}>
                    PR:{' '}
                    <a
                      href={lastRun.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent)' }}
                    >
                      {lastRun.prUrl}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  paddingLeft: 18,
                }}
              >
                No runs yet.
              </div>
            )}
          </div>
        </>
      )}

      <FirstRunWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
