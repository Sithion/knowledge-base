/**
 * First-run setup wizard modal. Renders the report from
 * `intake_first_run_setup`: a list of preflight steps with pass/fail
 * status, detail, and remediation hints.
 *
 * The Tauri command actually performs the checks (sb-clone-ready,
 * copilot-present/authed, gh-present, …) and returns a report; this
 * component is a presenter, with a "Re-run" button to re-invoke.
 */

import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke, isTauri, NotInTauriError } from '../tauriBridge.js';
import type { FirstRunReport, FirstRunStepStatus } from '../types.js';

const STATUS_COLOR: Record<FirstRunStepStatus, string> = {
  pass: 'var(--success, #10b981)',
  fail: 'var(--error, #ef4444)',
  skipped: 'var(--text-secondary)',
  unknown: 'var(--warning, #f59e0b)',
};

const STATUS_ICON: Record<FirstRunStepStatus, string> = {
  pass: '✓',
  fail: '✗',
  skipped: '–',
  unknown: '?',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FirstRunWizard({ open, onClose }: Props) {
  const [report, setReport] = useState<FirstRunReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await tauriInvoke<FirstRunReport>('intake_first_run_setup');
      setReport(r);
    } catch (e) {
      if (e instanceof NotInTauriError) {
        setError('First-run setup must be invoked from the Tauri desktop app.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && isTauri && !report) {
      run();
    }
  }, [open, report, run]);

  if (!open) return null;

  const blocked = report?.blockingSteps ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="first-run-wizard"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          width: '100%',
          maxWidth: 640,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div
          style={{
            padding: 20,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Setup intake pipeline</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
              CogniStore checks the prerequisites for the AI-stack POC.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 22,
              padding: 4,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              The setup wizard runs local checks (clone availability,
              Copilot CLI, gh CLI) and is only available in the Tauri
              desktop app.
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

          {loading && !report && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Running checks…
            </div>
          )}

          {report && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <SummaryChip label="SB clone" ok={report.sbCloneReady} />
                <SummaryChip label="Copilot present" ok={report.copilotPresent} />
                <SummaryChip label="Copilot authed" ok={report.copilotAuthed} />
                <SummaryChip label="gh CLI" ok={report.ghPresent} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {report.steps.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-input, #0b0d14)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          color: STATUS_COLOR[s.status],
                          fontWeight: 700,
                          width: 16,
                          textAlign: 'center',
                        }}
                      >
                        {STATUS_ICON[s.status]}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{s.label}</span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-secondary)',
                          textTransform: 'uppercase',
                          marginLeft: 'auto',
                        }}
                      >
                        {s.status}
                      </span>
                    </div>
                    {s.detail && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {s.detail}
                      </div>
                    )}
                    {s.remediation && s.status !== 'pass' && (
                      <div style={{ fontSize: 11, color: 'var(--accent)' }}>
                        ↳ {s.remediation}
                      </div>
                    )}
                    {s.status !== 'pass' && (
                      <StepActions
                        stepId={s.id}
                        onRefresh={run}
                        setError={setError}
                        setBusyAction={setBusyAction}
                        busyAction={busyAction}
                      />
                    )}
                  </div>
                ))}
              </div>

              {blocked.length > 0 && (
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
                  <strong>Blocking steps:</strong> {blocked.join(', ')}
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            padding: 16,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            onClick={run}
            disabled={loading || !isTauri}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: loading || !isTauri ? 'not-allowed' : 'pointer',
              opacity: loading || !isTauri ? 0.5 : 1,
              fontSize: 12,
            }}
          >
            {loading ? 'Re-running…' : '↻ Re-run checks'}
          </button>
          <button
            onClick={onClose}
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
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        border: `1px solid ${ok ? 'var(--success, #10b981)' : 'var(--error, #ef4444)'}`,
        background: ok ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{label}</span>
      <span style={{ color: ok ? 'var(--success, #10b981)' : 'var(--error, #ef4444)', fontWeight: 700 }}>
        {ok ? '✓' : '✗'}
      </span>
    </div>
  );
}

function SbCloneActions({
  onRefresh,
  setError,
  busy,
  setBusy,
}: {
  onRefresh: () => Promise<void>;
  setError: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [url, setUrl] = useState(
    'https://ablcode.visualstudio.com/DefaultCollection/Mojito/_git/Second%20Brain',
  );

  const cloneOnly = async () => {
    setBusy(true);
    setError(null);
    try {
      await tauriInvoke('sb_clone_ensure');
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAndClone = async () => {
    if (!url.trim()) {
      setError('Please paste a Git remote URL.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tauriInvoke('sb_clone_save_remote_url', { url: url.trim() });
      await onRefresh();
      setShowUrlInput(false);
      setUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (showUrlInput) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/your-org/second-brain.git"
          disabled={busy}
          style={{
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--bg-input, #0b0d14)',
            color: 'var(--text)',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={saveAndClone}
            disabled={busy}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {busy ? 'Cloning…' : 'Save & clone'}
          </button>
          <button
            onClick={() => {
              setShowUrlInput(false);
              setUrl('');
              setError(null);
            }}
            disabled={busy}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Cancel
          </button>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
          The URL is saved to <code>~/.cognistore/sb-remote-url.txt</code> for next launch.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      <button
        onClick={cloneOnly}
        disabled={busy}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: 'none',
          background: 'var(--accent)',
          color: '#fff',
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.5 : 1,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {busy ? 'Cloning…' : 'Clone now (use saved URL)'}
      </button>
      <button
        onClick={() => setShowUrlInput(true)}
        disabled={busy}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text)',
          cursor: busy ? 'not-allowed' : 'pointer',
          fontSize: 11,
        }}
      >
        Set / change remote URL…
      </button>
    </div>
  );
}

interface StepActionsProps {
  stepId: string;
  onRefresh: () => Promise<void>;
  setError: (msg: string | null) => void;
  setBusyAction: (id: string | null) => void;
  busyAction: string | null;
}

function StepActions({ stepId, onRefresh, setError, setBusyAction, busyAction }: StepActionsProps) {
  const busy = busyAction === stepId;
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const button = (
    label: string,
    onClick: () => void | Promise<void>,
    primary = true,
  ) => (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: '6px 12px',
        borderRadius: 6,
        border: primary ? 'none' : '1px solid var(--border)',
        background: primary ? 'var(--accent)' : 'transparent',
        color: primary ? '#fff' : 'var(--text)',
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.5 : 1,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );

  if (stepId === 'sb-clone') {
    return (
      <SbCloneActions
        onRefresh={onRefresh}
        setError={setError}
        busy={busy}
        setBusy={(v) => setBusyAction(v ? stepId : null)}
      />
    );
  }

  if (stepId === 'copilot-authed') {
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
        {button(copied ? 'Copied ✓' : 'Copy `copilot auth login`', () => copy('copilot auth login'))}
        {button('Re-check', onRefresh, false)}
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Run that command in a terminal, then click Re-check.
        </span>
      </div>
    );
  }

  if (stepId === 'copilot-present') {
    const cmd = 'npm install -g @githubnext/github-copilot-cli';
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
        {button(copied ? 'Copied ✓' : `Copy install command`, () => copy(cmd))}
        {button('Re-check', onRefresh, false)}
      </div>
    );
  }

  if (stepId === 'gh-present') {
    const cmd = 'brew install gh';
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
        {button(copied ? 'Copied ✓' : `Copy install command (macOS)`, () => copy(cmd))}
        {button('Re-check', onRefresh, false)}
      </div>
    );
  }

  return null;
}
