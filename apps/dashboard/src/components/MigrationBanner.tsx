/**
 * Migration prompt banner.
 *
 * Polls `GET /api/migration/ai-stack-poc/status` once on mount. When the
 * endpoint reports `shouldPrompt: true` (i.e. the user hasn't yet
 * decided whether to enable the AI Stack POC), renders a prominent
 * banner with Enable / Decline / Defer buttons that POSTs the choice to
 * `…/respond`. Hides itself afterwards.
 */

import { useCallback, useEffect, useState } from 'react';

interface MigrationStatus {
  shouldPrompt: boolean;
  prompted: boolean;
  response: 'enabled' | 'declined' | 'deferred' | null;
  defaultSecondBrainPath: string | null;
  enableSbOrchestration: boolean;
}

type Decision = 'enable' | 'decline' | 'defer';

export function MigrationBanner() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/migration/ai-stack-poc/status');
      if (!r.ok) return;
      const j: MigrationStatus = await r.json();
      setStatus(j);
    } catch {
      // Silent: migration is optional, banner just stays hidden.
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const respond = async (decision: Decision) => {
    setBusy(decision);
    setError(null);
    try {
      const r = await fetch('/api/migration/ai-stack-poc/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!r.ok) {
        const j: any = await r.json().catch(() => null);
        setError(j?.details || j?.error || `HTTP ${r.status}`);
        return;
      }
      setDismissed(true);
      // Refresh in case the server now reports `enabled`.
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!status || !status.shouldPrompt || dismissed) return null;

  return (
    <div
      data-testid="migration-banner"
      style={{
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--accent)',
        background: 'rgba(99, 102, 241, 0.08)',
        marginBottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>✨</span>
        <strong style={{ fontSize: 14 }}>Enable the AI Stack POC?</strong>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        CogniStore can manage a local Second Brain clone, run an intake
        agent over your dropped files, and cut PRs to your{' '}
        <code>second-brain</code> repo for review. This is opt-in — nothing
        runs until you enable it.
        {status.defaultSecondBrainPath && (
          <>
            {' '}Default Second Brain path:{' '}
            <code style={{ fontFamily: 'monospace' }}>
              {status.defaultSecondBrainPath}
            </code>
            .
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          data-testid="migration-enable"
          onClick={() => respond('enable')}
          disabled={busy !== null}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            cursor: busy !== null ? 'not-allowed' : 'pointer',
            opacity: busy !== null ? 0.6 : 1,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {busy === 'enable' ? 'Enabling…' : '✓ Enable'}
        </button>
        <button
          onClick={() => respond('defer')}
          disabled={busy !== null}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            cursor: busy !== null ? 'not-allowed' : 'pointer',
            opacity: busy !== null ? 0.6 : 1,
            fontSize: 13,
          }}
        >
          {busy === 'defer' ? 'Deferring…' : 'Ask later'}
        </button>
        <button
          onClick={() => respond('decline')}
          disabled={busy !== null}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: busy !== null ? 'not-allowed' : 'pointer',
            opacity: busy !== null ? 0.6 : 1,
            fontSize: 13,
          }}
        >
          {busy === 'decline' ? 'Declining…' : 'No thanks'}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--error, #ef4444)' }}>{error}</div>
      )}
    </div>
  );
}
