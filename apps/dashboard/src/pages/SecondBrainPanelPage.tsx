/**
 * Second Brain dashboard panel.
 *
 * Lists projects under the managed Second Brain clone (resolved server-
 * side from `aiStack.secondBrainPath`), each rendered as a card. Clicking
 * a project surfaces metadata only (no brain.md content yet — see TODO).
 *
 * When the orchestration gate is off, renders a stack-disabled card.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SbProject } from '../intake/types.js';

interface ProjectsResponse {
  disabled?: boolean;
  reason?: string;
  error?: string;
  details?: string;
  projects?: SbProject[];
}

export function SecondBrainPanelPage() {
  const [projects, setProjects] = useState<SbProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SbProject | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/sb/projects');
      const j: ProjectsResponse = await r.json();
      if (j.disabled) {
        setDisabled(true);
        setProjects([]);
      } else if (j.error) {
        setError(`${j.error}: ${j.details ?? ''}`);
        setProjects([]);
      } else if (Array.isArray(j.projects)) {
        setProjects(j.projects);
      } else if (Array.isArray(j as any)) {
        setProjects(j as unknown as SbProject[]);
      } else {
        setProjects([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (disabled) {
    return (
      <div style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>🧠 Second Brain</h2>
        <div
          style={{
            padding: 16,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            fontSize: 13,
          }}
        >
          AI Stack orchestration is disabled, so the Second Brain panel
          cannot enumerate projects. Enable it from the Health tab to
          unlock this view.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>🧠 Second Brain</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Projects under the managed Second Brain clone. brain.md is the
          authoritative knowledge file for each project.
        </p>
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

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading projects…</div>
      ) : (projects?.length ?? 0) === 0 ? (
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
          No projects yet. Stage files in the{' '}
          <a href="/workspace" style={{ color: 'var(--accent)' }}>
            Project Workspace
          </a>{' '}
          to scaffold one.
        </div>
      ) : (
        <div
          data-testid="sb-projects-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
          }}
        >
          {projects!.map((p) => {
            const active = selected?.name === p.name;
            return (
              <button
                key={p.name}
                onClick={() => setSelected(active ? null : p)}
                style={{
                  textAlign: 'left',
                  padding: 16,
                  borderRadius: 10,
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-card)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: 'var(--text-secondary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {p.path}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 11, marginTop: 4 }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: p.brainExists ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      color: p.brainExists ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)',
                    }}
                  >
                    {p.brainExists ? '✓ brain.md' : '⚠ no brain.md'}
                  </span>
                  {typeof p.decisionRecordCount === 'number' && (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {p.decisionRecordCount} decision(s)
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{selected.name}</strong>
            <button
              onClick={() => setSelected(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <div>Path: <code style={{ fontFamily: 'monospace' }}>{selected.path}</code></div>
            <div>brain.md: {selected.brainExists ? 'present' : 'missing'}</div>
            {typeof selected.decisionRecordCount === 'number' && (
              <div>Decisions: {selected.decisionRecordCount}</div>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              padding: 12,
              borderRadius: 6,
              background: 'var(--bg-input, #0b0d14)',
              border: '1px dashed var(--border)',
            }}
          >
            TODO(wave-7): expose <code>GET /api/sb/projects/:slug/brain</code> so the panel can render
            <code> brain.md</code> content inline. For now use your editor of choice on the path above.
          </div>
        </div>
      )}
    </div>
  );
}
