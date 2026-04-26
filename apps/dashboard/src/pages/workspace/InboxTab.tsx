/**
 * Inbox tab — pick (or scaffold) a project, then drop files in.
 * Auto-advances to the Stage tab once at least one file is staged.
 */

import { useWorkspace } from '../../intake/workspaceStore.js';
import { InboxDropzone } from '../../intake/components/InboxDropzone.js';
import { ProjectPicker } from '../../intake/components/ProjectPicker.js';

export function InboxTab() {
  const { state, setProject, addFiles, setTab } = useWorkspace();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
        }}
      >
        <ProjectPicker value={state.projectSlug} onChange={setProject} />
      </div>

      <InboxDropzone
        disabled={!state.projectSlug}
        onAdd={(files) => {
          addFiles(files);
          if (state.stagedFiles.length === 0 && files.length > 0) {
            setTab('stage');
          }
        }}
      />

      {!state.projectSlug && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Pick or create a project before staging files.
        </div>
      )}

      {state.stagedFiles.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {state.stagedFiles.length} file(s) currently staged. Open the{' '}
          <button
            onClick={() => setTab('stage')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              fontSize: 'inherit',
            }}
          >
            Stage tab
          </button>{' '}
          to review.
        </div>
      )}
    </div>
  );
}
