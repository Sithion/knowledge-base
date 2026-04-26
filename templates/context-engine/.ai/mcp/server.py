# pyright: reportMissingImports=false

import json
import sys
import time
from datetime import datetime
from pathlib import Path

from mcp.server.fastmcp import FastMCP


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
INDEX_DIR = REPO_ROOT / ".ai" / "index"
VENV_SITE_PACKAGES = (
    REPO_ROOT
    / ".venv-context"
    / "lib"
    / f"python{sys.version_info.major}.{sys.version_info.minor}"
    / "site-packages"
)

if VENV_SITE_PACKAGES.exists() and str(VENV_SITE_PACKAGES) not in sys.path:
    sys.path.insert(0, str(VENV_SITE_PACKAGES))

for candidate in sorted(
    (REPO_ROOT / ".venv-context" / "lib").glob("python*/site-packages")
):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

if str(INDEX_DIR) not in sys.path:
    sys.path.insert(0, str(INDEX_DIR))

import build_index
import config as cfg
import dependency_graph
import retrieve
import summarize


mcp = FastMCP("context-engine")


def _error(message: str) -> str:
    return json.dumps({"error": message}, ensure_ascii=False)


# MCP tools must always return JSON errors instead of crashing the stdio server process.


@mcp.tool()
def context_retrieve(query: str, hint: str = "", top_k: int = 20) -> str:
    try:
        persist_dir = Path(cfg.CHROMA_PERSIST_DIR)
        if not persist_dir.exists():
            return _error(
                f"Index not found at {persist_dir}. Run build_index.py first."
            )

        (
            chromadb,
            StorageContext,
            VectorStoreIndex,
            HuggingFaceEmbedding,
            ChromaVectorStore,
        ) = retrieve.load_runtime_deps()

        try:
            client = chromadb.PersistentClient(path=str(persist_dir))
            collection = client.get_collection(name=cfg.CHROMA_COLLECTION_NAME)
        except ValueError as exc:
            return _error(f"Index collection error: {exc}. Run build_index.py first.")

        if collection.count() == 0:
            return _error("Index exists but is empty. Rebuild with build_index.py.")

        embed_model = HuggingFaceEmbedding(model_name=cfg.EMBEDDING_MODEL)
        vector_store = ChromaVectorStore(chroma_collection=collection)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(
            vector_store=vector_store,
            storage_context=storage_context,
            embed_model=embed_model,
        )

        query_text = query if not hint else f"{query}\nHint: {hint}"
        retriever = index.as_retriever(similarity_top_k=max(1, int(top_k)))
        nodes = retriever.retrieve(query_text)
        rows = retrieve.build_rows(nodes)
        return json.dumps(rows, ensure_ascii=False)
    except SystemExit as exc:
        return _error(f"Retrieval failed: {exc}")
    except ValueError as exc:
        return _error(f"Retrieval input/config error: {exc}")
    except OSError as exc:
        return _error(f"Retrieval filesystem error: {exc}")
    except Exception as exc:
        return _error(f"Retrieval failed: {exc}")


@mcp.tool()
def context_index(dry_run: bool = False) -> str:
    try:
        start = time.perf_counter()
        sources = build_index.collect_sources()
        files, missing_sources = build_index.discover_files(sources)

        if dry_run:
            return json.dumps(
                {
                    "files": [str(p) for p in files],
                    "missing_sources": [str(p) for p in missing_sources],
                },
                ensure_ascii=False,
            )

        if not files:
            return json.dumps(
                {
                    "documents_indexed": 0,
                    "elapsed_seconds": round(time.perf_counter() - start, 2),
                    "missing_sources": [str(p) for p in missing_sources],
                },
                ensure_ascii=False,
            )

        (
            chromadb,
            SimpleDirectoryReader,
            StorageContext,
            VectorStoreIndex,
            SentenceSplitter,
            HuggingFaceEmbedding,
            ChromaVectorStore,
        ) = build_index.load_runtime_deps()

        reader = SimpleDirectoryReader(input_files=[str(p) for p in files])
        documents = reader.load_data()
        if not documents:
            return json.dumps(
                {
                    "documents_indexed": 0,
                    "elapsed_seconds": round(time.perf_counter() - start, 2),
                    "missing_sources": [str(p) for p in missing_sources],
                },
                ensure_ascii=False,
            )

        embed_model = HuggingFaceEmbedding(model_name=cfg.EMBEDDING_MODEL)
        splitter = SentenceSplitter(
            chunk_size=cfg.CHUNK_SIZE,
            chunk_overlap=cfg.CHUNK_OVERLAP,
        )

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

        VectorStoreIndex.from_documents(
            documents,
            storage_context=storage_context,
            embed_model=embed_model,
            transformations=[splitter],
        )

        return json.dumps(
            {
                "documents_indexed": len(documents),
                "elapsed_seconds": round(time.perf_counter() - start, 2),
                "missing_sources": [str(p) for p in missing_sources],
            },
            ensure_ascii=False,
        )
    except SystemExit as exc:
        return _error(f"Indexing failed: {exc}")
    except ValueError as exc:
        return _error(f"Indexing input/config error: {exc}")
    except OSError as exc:
        return _error(f"Indexing filesystem error: {exc}")
    except Exception as exc:
        return _error(f"Indexing failed: {exc}")


@mcp.tool()
def context_summarize(
    message: str,
    use_diff: bool = True,
    files: list[str] | None = None,
) -> str:
    try:
        diff_changes: list[dict[str, str]] = []
        explicit_changes: list[dict[str, str]] = []
        stat_fragments: list[str] = []
        warnings: list[str] = []

        if use_diff:
            try:
                diff_changes, diff_stat = summarize.collect_diff_changes()
                if diff_stat:
                    stat_fragments.append(diff_stat)
            except RuntimeError as exc:
                warnings.append(
                    f"Git diff unavailable ({exc}). Falling back to explicit file input if provided."
                )

        if files:
            explicit_changes, files_stat = summarize.collect_explicit_file_changes(
                files
            )
            if files_stat:
                stat_fragments.append(files_stat)

        changes = summarize.merge_changes(diff_changes, explicit_changes)
        stat_summary = "; ".join(fragment for fragment in stat_fragments if fragment)
        msg, rationale = summarize.build_message(message, stat_summary, changes)

        changed_files = [item["file"] for item in changes]
        modules = summarize.derive_modules(changed_files)
        scope = ", ".join(modules) if modules else "system-wide"

        now = datetime.now()
        date_str = now.strftime("%Y-%m-%d")
        timestamp = now.isoformat(timespec="seconds")

        decision_log_path = summarize.append_decision_log(
            scope,
            msg,
            rationale,
            date_str,
        )

        summary_payload: dict[str, object] = {
            "datetime": timestamp,
            "changed_files": changes,
            "message": msg,
            "impacted_modules": modules,
            "decision_log": str(decision_log_path),
        }
        if warnings:
            summary_payload["warnings"] = warnings

        return json.dumps(summary_payload, ensure_ascii=False)
    except RuntimeError as exc:
        return _error(f"Summarization runtime error: {exc}")
    except (ValueError, TypeError) as exc:
        return _error(f"Summarization input error: {exc}")
    except OSError as exc:
        return _error(f"Summarization filesystem error: {exc}")
    except Exception as exc:
        return _error(f"Summarization failed: {exc}")


@mcp.tool()
def context_deps(
    command: str,
    file: str = "",
    depth: int = 2,
    path: str = "",
) -> str:
    try:
        cmd = (command or "").strip().lower()
        if cmd == "build":
            roots = dependency_graph.resolve_roots(path or None)
            if not roots:
                return json.dumps(
                    {
                        "graph_path": str(dependency_graph.GRAPH_PATH),
                        "nodes": 0,
                        "edges": 0,
                    },
                    ensure_ascii=False,
                )

            graph = dependency_graph.build_graph(roots)
            dependency_graph.save_graph(graph)
            return json.dumps(
                {
                    "graph_path": str(dependency_graph.GRAPH_PATH),
                    "nodes": graph.number_of_nodes(),
                    "edges": graph.number_of_edges(),
                },
                ensure_ascii=False,
            )

        if cmd == "neighbors":
            if not file:
                return _error("'file' is required for command='neighbors'.")

            graph = dependency_graph.load_graph()
            if graph is None:
                return _error(
                    f"No saved graph found at {dependency_graph.GRAPH_PATH}. Run 'build' first."
                )

            target = str(Path(file).expanduser().resolve())
            if target not in graph:
                return _error(f"File not found in graph: {target}")

            max_depth = max(1, int(depth))
            deps = dependency_graph.bfs_neighbors(
                graph,
                target,
                graph.successors,
                max_depth,
            )
            revs = dependency_graph.bfs_neighbors(
                graph,
                target,
                graph.predecessors,
                max_depth,
            )
            neighbors = sorted(deps | revs)
            return json.dumps(
                {"file": target, "depth": max_depth, "neighbors": neighbors},
                ensure_ascii=False,
            )

        if cmd == "show":
            graph = dependency_graph.load_graph()
            if graph is None:
                return _error(
                    f"No saved graph found at {dependency_graph.GRAPH_PATH}. Run 'build' first."
                )

            ranking = sorted(
                ((node, graph.degree(node)) for node in graph.nodes()),
                key=lambda item: item[1],
                reverse=True,
            )
            most_connected = [
                {"file": node, "degree": degree} for node, degree in ranking[:10]
            ]
            return json.dumps(
                {
                    "nodes": graph.number_of_nodes(),
                    "edges": graph.number_of_edges(),
                    "most_connected": most_connected,
                },
                ensure_ascii=False,
            )

        return _error("Invalid command. Use 'build', 'neighbors', or 'show'.")
    except ValueError as exc:
        return _error(f"Dependency graph input error: {exc}")
    except OSError as exc:
        return _error(f"Dependency graph filesystem error: {exc}")
    except Exception as exc:
        return _error(f"Dependency graph command failed: {exc}")


if __name__ == "__main__":
    mcp.run(transport="stdio")
