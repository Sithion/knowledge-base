#!/usr/bin/env python3
# pyright: reportMissingImports=false

import argparse
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import config as cfg


def _load_runtime_deps():
    try:
        import chromadb
        from llama_index.core import (
            SimpleDirectoryReader,
            StorageContext,
            VectorStoreIndex,
        )
        from llama_index.core.node_parser import SentenceSplitter
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        from llama_index.vector_stores.chroma import ChromaVectorStore
    except ModuleNotFoundError as exc:
        print(
            f"Missing dependency: {exc.name}. Install indexing dependencies first.",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc

    return (
        chromadb,
        SimpleDirectoryReader,
        StorageContext,
        VectorStoreIndex,
        SentenceSplitter,
        HuggingFaceEmbedding,
        ChromaVectorStore,
    )


def load_runtime_deps():
    return _load_runtime_deps()


def _collect_sources() -> list[Path]:
    ordered_sources = [*cfg.INDEX_SOURCES, *cfg.CODE_SOURCE_DIRS]
    seen: set[Path] = set()
    sources: list[Path] = []
    for src in ordered_sources:
        p = Path(src).resolve()
        if p not in seen:
            sources.append(p)
            seen.add(p)
    return sources


def collect_sources() -> list[Path]:
    return _collect_sources()


def _is_ignored(path: Path, ignore_dirs: set[str], ignore_exts: set[str]) -> bool:
    if any(part in ignore_dirs for part in path.parts):
        return True
    return path.suffix.lower() in ignore_exts


def _discover_files(sources: list[Path]) -> tuple[list[Path], list[Path]]:
    ignore_dirs = {d.lower() for d in cfg.IGNORE_DIRS}
    ignore_exts = {e.lower() for e in cfg.IGNORE_EXTENSIONS}

    found: list[Path] = []
    missing: list[Path] = []

    for source in sources:
        if not source.exists():
            missing.append(source)
            continue

        if source.is_file():
            if not _is_ignored(source, ignore_dirs, ignore_exts):
                found.append(source)
            continue

        for item in source.rglob("*"):
            if not item.is_file():
                continue

            rel_parts = [part.lower() for part in item.relative_to(source).parts]
            if any(part in ignore_dirs for part in rel_parts):
                continue

            if item.suffix.lower() in ignore_exts:
                continue

            found.append(item)

    found.sort()
    return found, missing


def discover_files(sources: list[Path]) -> tuple[list[Path], list[Path]]:
    return _discover_files(sources)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Chroma-backed context index")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show files that would be indexed without building index",
    )
    args = parser.parse_args()

    start = time.perf_counter()
    sources = collect_sources()
    files, missing_sources = discover_files(sources)

    for missing in missing_sources:
        print(f"[warn] source does not exist: {missing}", file=sys.stderr)

    if not files:
        print("[info] no files found to index.", file=sys.stderr)
        return 0

    if args.dry_run:
        for file_path in files:
            print(str(file_path))
        print(f"[dry-run] files to index: {len(files)}", file=sys.stderr)
        return 0

    (
        chromadb,
        SimpleDirectoryReader,
        StorageContext,
        VectorStoreIndex,
        SentenceSplitter,
        HuggingFaceEmbedding,
        ChromaVectorStore,
    ) = load_runtime_deps()

    # ── Phase 1: Load files ──────────────────────────────────────────────
    print(f"[1/4] loading {len(files)} files...", file=sys.stderr)
    documents = []
    load_errors = 0
    batch_size = max(1, len(files) // 20)  # report ~20 progress ticks
    for i, fpath in enumerate(files):
        try:
            reader = SimpleDirectoryReader(input_files=[str(fpath)])
            documents.extend(reader.load_data())
        except Exception as exc:
            load_errors += 1
            if load_errors <= 5:
                print(f"  [warn] skip {fpath.name}: {exc}", file=sys.stderr)
            elif load_errors == 6:
                print("  [warn] suppressing further load warnings...", file=sys.stderr)
        if (i + 1) % batch_size == 0 or i + 1 == len(files):
            print(
                f"  [{i + 1}/{len(files)}] files read ({len(documents)} docs)",
                file=sys.stderr,
            )

    if load_errors:
        print(f"[1/4] {load_errors} files skipped due to errors", file=sys.stderr)

    if not documents:
        print("[info] no readable documents were loaded.", file=sys.stderr)
        return 0

    # ── Phase 2: Load embedding model ─────────────────────────────────
    print(
        f"[2/4] loading embedding model ({cfg.EMBEDDING_MODEL})...",
        file=sys.stderr,
    )
    embed_model = HuggingFaceEmbedding(model_name=cfg.EMBEDDING_MODEL)
    print("[2/4] embedding model ready", file=sys.stderr)

    # ── Phase 3: Chunk documents ──────────────────────────────────────
    splitter = SentenceSplitter(
        chunk_size=cfg.CHUNK_SIZE, chunk_overlap=cfg.CHUNK_OVERLAP
    )
    nodes = splitter.get_nodes_from_documents(documents)
    print(
        f"[3/4] chunked {len(documents)} docs → {len(nodes)} nodes "
        f"(chunk_size={cfg.CHUNK_SIZE})",
        file=sys.stderr,
    )

    # ── Phase 4: Build vector index ───────────────────────────────────
    print(f"[4/4] building vector index ({len(nodes)} nodes)...", file=sys.stderr)

    persist_dir = Path(cfg.CHROMA_PERSIST_DIR)
    persist_dir.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(persist_dir))

    try:
        client.delete_collection(name=cfg.CHROMA_COLLECTION_NAME)
    except ValueError:
        pass

    collection = client.get_or_create_collection(name=cfg.CHROMA_COLLECTION_NAME)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    VectorStoreIndex(
        nodes=nodes,
        storage_context=storage_context,
        embed_model=embed_model,
    )

    elapsed = time.perf_counter() - start
    print(f"[4/4] done in {elapsed:.1f}s", file=sys.stderr)
    print(f"documents_indexed\t{len(documents)}")
    print(f"nodes_created\t{len(nodes)}")
    print(f"elapsed_seconds\t{elapsed:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
