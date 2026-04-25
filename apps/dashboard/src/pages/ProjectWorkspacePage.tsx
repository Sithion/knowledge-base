/**
 * Project Workspace page — tab-based shell driving the intake pipeline.
 *
 * Tabs:
 *  - Inbox  : project picker + dropzone
 *  - Stage  : staged-file review with per-file token estimate
 *  - Run    : model picker + Run / Cancel buttons + live transcript
 *  - Review : git diff of intake branch + Approve / Reject
 *  - PR-cut : run Phase B + PR URL capture
 *
 * State is held in a React-Context store (`workspaceStore`) so tab
 * switches don't reset progress. Tauri events are wired here at the
 * page level so the subscription survives tab switches but stops when
 * the user navigates away.
 */

import { useEffect, useState } from 'react';
import { tauriListen, isTauri, tauriInvoke } from '../intake/tauriBridge.js';
import { WorkspaceProvider, useWorkspace } from '../intake/workspaceStore.js';
import type {
  IntakeLifecycleEvent,
  TranscriptEventPayload,
  WorkspaceTab,
} from '../intake/types.js';
import { InboxTab } from './workspace/InboxTab.js';
import { StageTab } from './workspace/StageTab.js';
import { RunTab } from './workspace/RunTab.js';
import { ReviewTab } from './workspace/ReviewTab.js';
import { PrCutTab } from './workspace/PrCutTab.js';

const TABS: { id: WorkspaceTab; label: string; icon: string }[] = [
  { id: 'inbox', label: 'Inbox', icon: '📥' },
  { id: 'stage', label: 'Stage', icon: '📋' },
  { id: 'run', label: 'Run', icon: '▶' },
  { id: 'review', label: 'Review', icon: '🔍' },
  { id: 'pr-cut', label: 'PR-cut', icon: '🚀' },
];

function GateBanner({ enabled }: { enabled: boolean }) {
  if (enabled) return null;
  return (
    <div
      data-testid="gate-disabled-banner"
      style={{
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--warning, #f59e0b)',
        background: 'rgba(245, 158, 11, 0.05)',
        color: 'var(--text)',
        fontSize: 13,
      }}
    >
      <strong>AI Stack orchestration is disabled.</strong> The intake
      pipeline is hidden until you enable it. Open <em>Health</em> →
      <em> Setup intake pipeline</em>, or set{' '}
      <code>aiStack.enableSbOrchestration</code> in your CogniStore config
      (or env <code>COGNISTORE_ENABLE_SB_ORCHESTRATION=1</code>).
    </div>
  );
}

function WorkspaceShell() {
  const { state, setTab, pushLifecycleEvent, pushTranscriptEvent } = useWorkspace();

  // Subscribe to Tauri events at the shell level so they accumulate while
  // the user navigates tabs.
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let cancelled = false;
    (async () => {
      const u1 = await tauriListen<IntakeLifecycleEvent>('intake:event', (p) => {
        if (!cancelled) pushLifecycleEvent(p);
      });
      const u2 = await tauriListen<TranscriptEventPayload>('agent-transcript-event', (p) => {
        if (!cancelled) pushTranscriptEvent(p);
      });
      unlisteners.push(u1, u2);
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [pushLifecycleEvent, pushTranscriptEvent]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22 }}>Project Workspace</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Stage files → run intake agent → review diff → cut PR. All work
          happens on a fresh per-run branch in the managed Second Brain
          clone.
        </p>
      </div>

      {/* Tab strip */}
      <div
        data-testid="workspace-tabs"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {TABS.map((t) => {
          const active = state.activeTab === t.id;
          // Reflect lifecycle phase as a small badge dot when the tab is
          // the "current" phase.
          const phaseDot =
            (t.id === 'run' && state.phase === 'intake') ||
            (t.id === 'review' && state.phase === 'review') ||
            (t.id === 'pr-cut' && state.phase === 'pr-cut');
          return (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px',
                background: active ? 'var(--bg-card)' : 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                color: active ? 'var(--text)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {phaseDot && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      <div style={{ paddingTop: 8 }}>
        {state.activeTab === 'inbox' && <InboxTab />}
        {state.activeTab === 'stage' && <StageTab />}
        {state.activeTab === 'run' && <RunTab />}
        {state.activeTab === 'review' && <ReviewTab />}
        {state.activeTab === 'pr-cut' && <PrCutTab />}
      </div>
    </div>
  );
}

/**
 * Top-level wrapper: probes the orchestration gate and either renders
 * the workspace or a stack-disabled placeholder.
 */
export function ProjectWorkspacePage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Mirrors how HealthPage reads the gate: try `sb_freshness_status`,
      // which already exposes the resolved gate state.
      if (!isTauri) {
        // In web mode, try the migration-status endpoint (it surfaces
        // `enableSbOrchestration` based on the same SDK config).
        try {
          const r = await fetch('/api/migration/ai-stack-poc/status');
          const j = await r.json();
          if (!cancelled) setEnabled(!!j.enableSbOrchestration);
        } catch {
          if (!cancelled) setEnabled(false);
        }
        return;
      }
      try {
        const s = await tauriInvoke<{ enabled: boolean }>('sb_freshness_status');
        if (!cancelled) setEnabled(!!s.enabled);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading…</div>
    );
  }

  return (
    <div style={{ padding: 0 }}>
      <GateBanner enabled={enabled} />
      {enabled && (
        <WorkspaceProvider>
          <WorkspaceShell />
        </WorkspaceProvider>
      )}
    </div>
  );
}
