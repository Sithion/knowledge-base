"""
Centralized configuration for the context engine.
All paths are resolved relative to the repository root (detected dynamically).
"""

import os
from pathlib import Path


def _find_repo_root(start: Path | None = None) -> Path:
    """Walk up from start until we find a directory containing .ai/ or .git/."""
    current = (
        start or Path(__file__).resolve().parent.parent.parent
    )  # .ai/index/ -> repo root
    for parent in [current, *current.parents]:
        if (parent / ".ai").is_dir() or (parent / ".git").is_dir():
            return parent
    return current


REPO_ROOT = _find_repo_root()

# ── Paths ──────────────────────────────────────────────────────────────────
AI_DIR = REPO_ROOT / ".ai"
CONTEXT_DIR = AI_DIR / "context"
MEMORY_DIR = AI_DIR / "memory"
SUMMARIES_DIR = AI_DIR / "summaries"
INDEX_DIR = AI_DIR / "index"
AGENTS_DIR = AI_DIR / "agents"
TASKS_DIR = AI_DIR / "tasks"

# Persistent vector store location
CHROMA_PERSIST_DIR = str(INDEX_DIR / "chroma_db")
STORAGE_PERSIST_DIR = str(INDEX_DIR / "storage")

# ── Indexing settings ──────────────────────────────────────────────────────
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
CHROMA_COLLECTION_NAME = "context_engine"

CHUNK_SIZE = 512
CHUNK_OVERLAP = 64

# Default retrieval
DEFAULT_TOP_K = 20

# ── Document sources ──────────────────────────────────────────────────────
# Directories whose contents should be indexed.
# Add project source directories here when adopting into a real repo.
INDEX_SOURCES = [
    str(CONTEXT_DIR),
    str(SUMMARIES_DIR),
    str(MEMORY_DIR),
]

# Optional: add real source-code directories for a live repo.
# Example: INDEX_SOURCES.append(str(REPO_ROOT / "src"))
CODE_SOURCE_DIRS: list[str] = []

# ── Ignore patterns ───────────────────────────────────────────────────────
IGNORE_DIRS = {
    ".git",
    ".venv",
    ".venv-context",
    "node_modules",
    "__pycache__",
    "dist",
    "build",
    ".ruff_cache",
    ".pytest_cache",
    ".mypy_cache",
    "chroma_db",
    "storage",
}

IGNORE_EXTENSIONS = {
    ".pyc",
    ".pyo",
    ".so",
    ".dll",
    ".exe",
    ".bin",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".lock",
}

# ── Dependency graph ──────────────────────────────────────────────────────
DEPENDENCY_MAX_DEPTH = 3

# Supported file extensions for import scanning
DEPENDENCY_SCAN_EXTENSIONS = {".py", ".js", ".ts", ".tsx", ".jsx"}
