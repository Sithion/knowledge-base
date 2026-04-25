#!/usr/bin/env python3
# pyright: reportMissingImports=false

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import config as cfg


def _load_runtime_deps():
    try:
        import chromadb
        from llama_index.core import StorageContext, VectorStoreIndex
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        from llama_index.vector_stores.chroma import ChromaVectorStore
    except ModuleNotFoundError as exc:
        print(
            f"Missing dependency: {exc.name}. Install retrieval dependencies first.",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc

    return (
        chromadb,
        StorageContext,
        VectorStoreIndex,
        HuggingFaceEmbedding,
        ChromaVectorStore,
    )


def load_runtime_deps():
    return _load_runtime_deps()


def _format_score(score: float | None) -> str:
    if score is None:
        return "-"
    return f"{score:.4f}"


def _snippet(text: str, max_len: int = 200) -> str:
    clean = " ".join((text or "").split())
    if len(clean) <= max_len:
        return clean
    return clean[: max_len - 3] + "..."


def _extract_source(node_with_score) -> str:
    md = node_with_score.node.metadata or {}
    return str(
        md.get("file_path")
        or md.get("source")
        or md.get("document_id")
        or md.get("filename")
        or "<unknown>"
    )


def _build_rows(nodes) -> list[dict]:
    rows: list[dict] = []
    for nws in nodes:
        rows.append(
            {
                "source": _extract_source(nws),
                "score": nws.score,
                "snippet": _snippet(nws.node.get_content()),
            }
        )
    return rows


def build_rows(nodes) -> list[dict]:
    return _build_rows(nodes)


def _print_table(rows: list[dict]) -> None:
    headers = ["source", "score", "snippet"]
    score_values = [_format_score(row["score"]) for row in rows]

    source_width = (
        max(len(headers[0]), *(len(str(r["source"])) for r in rows))
        if rows
        else len(headers[0])
    )
    score_width = (
        max(len(headers[1]), *(len(v) for v in score_values))
        if rows
        else len(headers[1])
    )
    snippet_width = (
        max(len(headers[2]), *(len(str(r["snippet"])) for r in rows))
        if rows
        else len(headers[2])
    )

    def line() -> str:
        return f"+-{'-' * source_width}-+-{'-' * score_width}-+-{'-' * snippet_width}-+"

    print(line())
    print(
        f"| {headers[0].ljust(source_width)} | {headers[1].ljust(score_width)} | {headers[2].ljust(snippet_width)} |"
    )
    print(line())
    for idx, row in enumerate(rows):
        print(
            f"| {str(row['source']).ljust(source_width)} | {score_values[idx].ljust(score_width)} | {str(row['snippet']).ljust(snippet_width)} |"
        )
    print(line())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Retrieve context from persisted Chroma index"
    )
    parser.add_argument(
        "task", help="Task description to retrieve relevant context for"
    )
    parser.add_argument(
        "--hint", default="", help="Optional file/module hint to improve retrieval"
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=cfg.DEFAULT_TOP_K,
        help="Number of matches to return",
    )
    parser.add_argument(
        "--json", action="store_true", help="Output machine-readable JSON"
    )
    args = parser.parse_args()

    persist_dir = Path(cfg.CHROMA_PERSIST_DIR)
    if not persist_dir.exists():
        print(
            f"Index not found at {persist_dir}. Run build_index.py first.",
            file=sys.stderr,
        )
        return 1

    (
        chromadb,
        StorageContext,
        VectorStoreIndex,
        HuggingFaceEmbedding,
        ChromaVectorStore,
    ) = load_runtime_deps()

    try:
        client = chromadb.PersistentClient(path=str(persist_dir))
        collection = client.get_collection(name=cfg.CHROMA_COLLECTION_NAME)
    except (ValueError, Exception) as exc:
        print(
            f"Index collection error: {exc}. Run build_index.py first.", file=sys.stderr
        )
        return 1

    collection_count = collection.count()
    if collection_count == 0:
        print(
            "Index exists but is empty. Rebuild with build_index.py.", file=sys.stderr
        )
        return 1

    embed_model = HuggingFaceEmbedding(model_name=cfg.EMBEDDING_MODEL)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    index = VectorStoreIndex.from_vector_store(
        vector_store=vector_store,
        storage_context=storage_context,
        embed_model=embed_model,
    )

    query_text = args.task if not args.hint else f"{args.task}\nHint: {args.hint}"
    retriever = index.as_retriever(similarity_top_k=max(1, args.top_k))
    nodes = retriever.retrieve(query_text)

    if not nodes:
        print("No relevant results found.", file=sys.stderr)
        return 0

    rows = build_rows(nodes)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        _print_table(rows)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
