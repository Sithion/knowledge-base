/**
 * Project picker, populated from `GET /api/sb/projects`. Includes a
 * "Create new project" affordance that calls
 * `POST /api/sb/projects/scaffold` with a slug entered by the user.
 *
 * When the orchestration gate is off (HTTP 409 with `disabled: true`),
 * renders a disabled placeholder.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SbProject } from '../types.js';

interface Props {
  value: string | null;
  onChange: (slug: string | null) => void;
}

interface ProjectsResponse {
  disabled?: boolean;
  reason?: string;
  error?: string;
  details?: string;
  projects?: SbProject[];
}

export function ProjectPicker({ value, onChange }: Props) {
  const [projects, setProjects] = useState<SbProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

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
        // Endpoint returns a bare array in some shapes.
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

  const handleCreate = async () => {
    const slug = newName.trim();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug must match ^[a-z0-9-]+$');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/sb/projects/scaffold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: slug }),
      });
      const j: any = await r.json();
      if (!r.ok) {
        setError(j.details || j.error || `HTTP ${r.status}`);
        return;
      }
      // Server validated; the actual scaffold happens via run_intake with
      // the scaffold-project prompt template (Wave-7 polish).
      setNewName('');
      onChange(slug);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  if (disabled) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        AI Stack orchestration is disabled. Enable{' '}
        <code>aiStack.enableSbOrchestration</code> to use the intake pipeline.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Project</div>
      <select
        data-testid="project-picker"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        style={{
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg-input, #111827)',
          color: 'var(--text)',
          fontSize: 13,
        }}
      >
        <option value="">{loading ? 'Loading…' : '— Select project —'}</option>
        {(projects ?? []).map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
            {p.brainExists ? '' : ' (no brain.md)'}
          </option>
        ))}
      </select>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          placeholder="new-project-slug"
          value={newName}
          onChange={(e) => setNewName(e.target.value.toLowerCase())}
          disabled={creating}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-input, #111827)',
            color: 'var(--text)',
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            cursor: creating ? 'not-allowed' : 'pointer',
            opacity: creating || !newName.trim() ? 0.5 : 1,
            fontSize: 12,
          }}
        >
          {creating ? 'Creating…' : '+ New project'}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--error, #ef4444)' }}>{error}</div>
      )}
    </div>
  );
}
