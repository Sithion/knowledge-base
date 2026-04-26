/**
 * Second Brain dashboard panel.
 *
 * Lists projects under the managed Second Brain clone (resolved server-
 * side from `aiStack.secondBrainPath`), each rendered as a card. Clicking
 * a project loads its analysis, decision records, specs, and root-level
 * docs from `/api/sb/projects/:slug/details` and renders the markdown
 * inline.
 *
 * When the orchestration gate is off, renders a stack-disabled card.
 */

import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SbProject } from '../intake/types.js';

interface ProjectsResponse {
  disabled?: boolean;
  reason?: string;
  error?: string;
  details?: string;
  projects?: SbProject[];
}

interface ProjectFile {
  name: string;
  relPath: string;
  sizeBytes: number;
  mtimeMs: number;
  content: string;
  truncated: boolean;
}

interface ProjectSection {
  id: 'analysis' | 'decisions' | 'specs' | 'root';
  label: string;
  dir: string | null;
  files: ProjectFile[];
}

interface ProjectDetailsResponse {
  project: string;
  path: string;
  sections: ProjectSection[];
  error?: string;
  details?: string;
}

export function SecondBrainPanelPage() {
  const [projects, setProjects] = useState<SbProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SbProject | null>(null);
  const [details, setDetails] = useState<ProjectDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/sb/projects');
      const j = (await r.json()) as ProjectsResponse;
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

  useEffect(() => {
    if (!selected) {
      setDetails(null);
      setDetailsError(null);
      setOpenFile(null);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);
    setDetails(null);
    setOpenFile(null);
    (async () => {
      try {
        const r = await fetch(`/api/sb/projects/${encodeURIComponent(selected.name)}/details`);
        const j = (await r.json()) as ProjectDetailsResponse;
        if (cancelled) return;
        if (j.error) {
          setDetailsError(`${j.error}: ${j.details ?? ''}`);
        } else {
          setDetails(j);
          const firstFile = j.sections.flatMap((s) => s.files)[0];
          if (firstFile) setOpenFile(firstFile.relPath);
        }
      } catch (e) {
        if (!cancelled) setDetailsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

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
          Projects under the managed Second Brain clone. Click a project to
          read its decision records, gaps & analysis, and spec docs inline.
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
        <ProjectDetailsView
          project={selected}
          details={details}
          loading={detailsLoading}
          error={detailsError}
          openFile={openFile}
          onOpenFile={setOpenFile}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface DetailsViewProps {
  project: SbProject;
  details: ProjectDetailsResponse | null;
  loading: boolean;
  error: string | null;
  openFile: string | null;
  onOpenFile: (relPath: string | null) => void;
  onClose: () => void;
}

function ProjectDetailsView({ project, details, loading, error, openFile, onOpenFile, onClose }: DetailsViewProps) {
  const allFiles = details?.sections.flatMap((s) => s.files.map((f) => ({ ...f, sectionId: s.id, sectionLabel: s.label }))) ?? [];
  const current = allFiles.find((f) => f.relPath === openFile) ?? null;

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ fontSize: 15 }}>{project.name}</strong>
          <div
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--text-secondary)',
              marginTop: 2,
              wordBreak: 'break-all',
            }}
          >
            {project.path}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 18,
            padding: 4,
          }}
          aria-label="Close project details"
        >
          ×
        </button>
      </div>

      {loading && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading project documents…</div>
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

      {details && allFiles.length === 0 && !loading && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: '1px dashed var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 13,
          }}
        >
          No analysis, decision, or spec documents found yet for this project.
        </div>
      )}

      {details && allFiles.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, minHeight: 320 }}>
          <nav
            data-testid="sb-project-file-list"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              maxHeight: '70vh',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {details.sections.map((sec) => (
              <div key={sec.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  {sec.label} {sec.files.length > 0 && <span style={{ opacity: 0.6 }}>({sec.files.length})</span>}
                </div>
                {sec.files.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6, paddingLeft: 4 }}>
                    none
                  </div>
                ) : (
                  sec.files.map((f) => {
                    const active = f.relPath === openFile;
                    return (
                      <button
                        key={f.relPath}
                        onClick={() => onOpenFile(f.relPath)}
                        style={{
                          textAlign: 'left',
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                          background: active ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                          color: active ? 'var(--text)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontFamily: 'inherit',
                        }}
                        title={f.relPath}
                      >
                        {f.name}
                      </button>
                    );
                  })
                )}
              </div>
            ))}
          </nav>

          <article
            data-testid="sb-project-file-content"
            style={{
              padding: 16,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-input, #0b0d14)',
              maxHeight: '70vh',
              overflowY: 'auto',
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            {current ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 12,
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <code style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{current.relPath}</code>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                    {(current.sizeBytes / 1024).toFixed(1)} KB
                    {current.truncated && ' · truncated'}
                  </span>
                </div>
                <div className="sb-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{current.content}</Markdown>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Select a document on the left to read its contents.
              </div>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
