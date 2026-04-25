#!/usr/bin/env python3
# pyright: reportMissingModuleSource=false

import argparse
import json
import os
import re
import sys
from collections import deque
from pathlib import Path

import networkx as nx

from config import (
    CODE_SOURCE_DIRS,
    DEPENDENCY_MAX_DEPTH,
    DEPENDENCY_SCAN_EXTENSIONS,
    IGNORE_DIRS,
    INDEX_DIR,
    REPO_ROOT,
)


GRAPH_PATH = INDEX_DIR / "dep_graph.json"
PY_EXTENSIONS = {".py"}
JS_TS_EXTENSIONS = {".js", ".ts", ".tsx", ".jsx"}

PY_IMPORT_RE = re.compile(
    r"^\s*import\s+([A-Za-z_][\w\.]*\s*(?:,\s*[A-Za-z_][\w\.]*\s*)*)$",
    re.MULTILINE,
)
PY_FROM_RE = re.compile(
    r"^\s*from\s+((?:[\.]+)|(?:[\.]*[A-Za-z_][\w\.]*))\s+import\s+(.+)$",
    re.MULTILINE,
)

JS_IMPORT_FROM_RE = re.compile(
    r"(?:^|;)\s*import\s+(?:[^;]*?\s+from\s+)?[\"']([^\"']+)[\"']",
    re.MULTILINE,
)
JS_REQUIRE_RE = re.compile(r"require\(\s*[\"']([^\"']+)[\"']\s*\)")


def _normalize_path(path: Path) -> str:
    return str(path.resolve())


def _iter_source_files(root: Path):
    if not root.exists() or not root.is_dir():
        return

    for current_root, dirnames, filenames in os.walk(root, topdown=True):
        current_root = Path(current_root)
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]

        for filename in filenames:
            file_path = current_root / filename
            if file_path.suffix.lower() not in DEPENDENCY_SCAN_EXTENSIONS:
                continue
            yield file_path.resolve()


def _get_containing_root(file_path: Path, roots: list[Path]) -> Path | None:
    for root in roots:
        try:
            file_path.relative_to(root)
            return root
        except ValueError:
            continue
    return None


def _build_python_module_index(
    files: list[Path], roots: list[Path]
) -> dict[str, set[str]]:
    module_index: dict[str, set[str]] = {}
    for file_path in files:
        if file_path.suffix.lower() not in PY_EXTENSIONS:
            continue

        root = _get_containing_root(file_path, roots)
        if root is None:
            continue

        rel = file_path.relative_to(root)
        parts = list(rel.parts)

        if not parts:
            continue

        if parts[-1] == "__init__.py":
            module_parts = parts[:-1]
        else:
            module_parts = parts
            module_parts[-1] = Path(module_parts[-1]).stem

        if not module_parts:
            continue

        module_name = ".".join(module_parts)
        module_index.setdefault(module_name, set()).add(_normalize_path(file_path))

    return module_index


def _resolve_python_module_candidates(
    module_name: str,
    imported_names: list[str],
    module_index: dict[str, set[str]],
) -> set[str]:
    resolved: set[str] = set()

    if module_name:
        if module_name in module_index:
            resolved.update(module_index[module_name])
        for name in imported_names:
            if name == "*":
                continue
            candidate = f"{module_name}.{name}"
            if candidate in module_index:
                resolved.update(module_index[candidate])

    return resolved


def _resolve_relative_python_module(
    module_expr: str,
    imported_names: list[str],
    file_path: Path,
    roots: list[Path],
    module_index: dict[str, set[str]],
) -> set[str]:
    match = re.match(r"^(\.+)(.*)$", module_expr)
    if not match:
        return set()

    dots = match.group(1)
    rest = match.group(2).lstrip(".")

    root = _get_containing_root(file_path, roots)
    if root is None:
        return set()

    rel = file_path.relative_to(root)
    package_parts = list(rel.parts[:-1])

    up = max(len(dots) - 1, 0)
    if up > len(package_parts):
        return set()

    if up:
        package_parts = package_parts[:-up]

    module_parts = package_parts.copy()
    if rest:
        module_parts.extend(rest.split("."))

    base_module = ".".join(module_parts)
    return _resolve_python_module_candidates(base_module, imported_names, module_index)


def _parse_python_imports(
    file_path: Path,
    content: str,
    roots: list[Path],
    module_index: dict[str, set[str]],
) -> set[str]:
    deps: set[str] = set()

    for match in PY_IMPORT_RE.finditer(content):
        modules = [part.strip() for part in match.group(1).split(",")]
        for module in modules:
            module_name = module.split(" as ")[0].strip()
            deps.update(
                _resolve_python_module_candidates(module_name, [], module_index)
            )

    for match in PY_FROM_RE.finditer(content):
        module_expr = match.group(1).strip()
        names_expr = match.group(2).strip()

        imported_names = []
        for chunk in names_expr.split(","):
            part = chunk.strip()
            if not part:
                continue
            if " as " in part:
                part = part.split(" as ")[0].strip()
            if part.startswith("("):
                part = part[1:].strip()
            if part.endswith(")"):
                part = part[:-1].strip()
            if part:
                imported_names.append(part)

        if module_expr.startswith("."):
            deps.update(
                _resolve_relative_python_module(
                    module_expr,
                    imported_names,
                    file_path,
                    roots,
                    module_index,
                )
            )
        else:
            deps.update(
                _resolve_python_module_candidates(
                    module_expr,
                    imported_names,
                    module_index,
                )
            )

    deps.discard(_normalize_path(file_path))
    return deps


def _resolve_js_ts_relative_import(file_path: Path, spec: str) -> set[str]:
    if not spec.startswith("."):
        return set()

    base = (file_path.parent / spec).resolve()
    candidates = []

    if base.suffix:
        candidates.append(base)
    else:
        for ext in JS_TS_EXTENSIONS:
            candidates.append(base.with_suffix(ext))
        for ext in JS_TS_EXTENSIONS:
            candidates.append(base / f"index{ext}")

    resolved: set[str] = set()
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            resolved.add(_normalize_path(candidate))
    return resolved


def _parse_js_ts_imports(file_path: Path, content: str) -> set[str]:
    deps: set[str] = set()

    for match in JS_IMPORT_FROM_RE.finditer(content):
        spec = match.group(1).strip()
        deps.update(_resolve_js_ts_relative_import(file_path, spec))

    for match in JS_REQUIRE_RE.finditer(content):
        spec = match.group(1).strip()
        deps.update(_resolve_js_ts_relative_import(file_path, spec))

    deps.discard(_normalize_path(file_path))
    return deps


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def build_graph(source_roots: list[Path]) -> nx.DiGraph:
    graph = nx.DiGraph()

    files: list[Path] = []
    for root in source_roots:
        files.extend(list(_iter_source_files(root)))

    for file_path in files:
        graph.add_node(_normalize_path(file_path))

    module_index = _build_python_module_index(files, source_roots)

    for file_path in files:
        content = _read_text(file_path)
        if not content:
            continue

        deps: set[str] = set()
        suffix = file_path.suffix.lower()

        if suffix in PY_EXTENSIONS:
            deps = _parse_python_imports(file_path, content, source_roots, module_index)
        elif suffix in JS_TS_EXTENSIONS:
            deps = _parse_js_ts_imports(file_path, content)

        source = _normalize_path(file_path)
        for dep in deps:
            graph.add_node(dep)
            graph.add_edge(source, dep)

    return graph


def save_graph(graph: nx.DiGraph, path: Path = GRAPH_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "nodes": sorted(graph.nodes()),
        "edges": sorted((u, v) for u, v in graph.edges()),
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_graph(path: Path = GRAPH_PATH) -> nx.DiGraph | None:
    if not path.exists():
        return None

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    graph = nx.DiGraph()
    for node in payload.get("nodes", []):
        graph.add_node(node)
    for edge in payload.get("edges", []):
        if isinstance(edge, list) and len(edge) == 2:
            graph.add_edge(edge[0], edge[1])
        elif isinstance(edge, tuple) and len(edge) == 2:
            graph.add_edge(edge[0], edge[1])
    return graph


def _bfs_neighbors(
    graph: nx.DiGraph,
    start: str,
    get_neighbors,
    depth: int,
) -> set[str]:
    seen: set[str] = {start}
    found: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(start, 0)])

    while queue:
        node, dist = queue.popleft()
        if dist >= depth:
            continue

        for nxt in get_neighbors(node):
            if nxt in seen:
                continue
            seen.add(nxt)
            found.add(nxt)
            queue.append((nxt, dist + 1))

    return found


def bfs_neighbors(
    graph: nx.DiGraph,
    start: str,
    get_neighbors,
    depth: int,
) -> set[str]:
    return _bfs_neighbors(graph, start, get_neighbors, depth)


def _resolve_roots(cli_path: str | None) -> list[Path]:
    roots: list[Path] = []

    if cli_path:
        root = Path(cli_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            print(f"Directory does not exist: {root}")
            return []
        return [root]

    if not CODE_SOURCE_DIRS:
        print(
            "No source directories configured. Set CODE_SOURCE_DIRS in .ai/index/config.py or use --path."
        )
        return []

    for configured in CODE_SOURCE_DIRS:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            path = (REPO_ROOT / path).resolve()
        else:
            path = path.resolve()

        if not path.exists() or not path.is_dir():
            print(f"Skipping missing source directory: {path}")
            continue
        roots.append(path)

    if not roots:
        print("No valid source directories found to scan.")
    return roots


def resolve_roots(cli_path: str | None) -> list[Path]:
    return _resolve_roots(cli_path)


def _cmd_build(args: argparse.Namespace) -> int:
    roots = resolve_roots(args.path)
    if not roots:
        return 0

    graph = build_graph(roots)
    save_graph(graph)
    print(f"Saved dependency graph to {GRAPH_PATH}")
    print(f"Nodes: {graph.number_of_nodes()} | Edges: {graph.number_of_edges()}")
    return 0


def _cmd_neighbors(args: argparse.Namespace) -> int:
    graph = load_graph()
    if graph is None:
        print(f"No saved graph found at {GRAPH_PATH}. Run 'build' first.")
        return 0

    target = str(Path(args.file).expanduser().resolve())
    if target not in graph:
        print(f"File not found in graph: {target}")
        return 0

    depth = max(1, args.depth)
    deps = bfs_neighbors(graph, target, graph.successors, depth)
    revs = bfs_neighbors(graph, target, graph.predecessors, depth)
    neighbors = sorted(deps | revs)

    for path in neighbors:
        print(path)
    return 0


def _cmd_show(_: argparse.Namespace) -> int:
    graph = load_graph()
    if graph is None:
        print(f"No saved graph found at {GRAPH_PATH}. Run 'build' first.")
        return 0

    print(f"Nodes: {graph.number_of_nodes()}")
    print(f"Edges: {graph.number_of_edges()}")

    if graph.number_of_nodes() == 0:
        print("Most connected: none")
        return 0

    ranking = sorted(
        ((node, graph.degree(node)) for node in graph.nodes()),
        key=lambda item: item[1],
        reverse=True,
    )

    print("Most connected:")
    for node, degree in ranking[:10]:
        print(f"{degree}\t{node}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Lightweight dependency graph scanner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser(
        "build", help="Scan code and build dependency graph"
    )
    build_parser.add_argument(
        "--path",
        type=str,
        help="Directory to scan instead of configured CODE_SOURCE_DIRS",
    )
    build_parser.set_defaults(func=_cmd_build)

    neighbors_parser = subparsers.add_parser(
        "neighbors", help="Show neighbors for a file"
    )
    neighbors_parser.add_argument("file", type=str, help="Path to file node")
    neighbors_parser.add_argument("--depth", type=int, default=DEPENDENCY_MAX_DEPTH)
    neighbors_parser.set_defaults(func=_cmd_neighbors)

    show_parser = subparsers.add_parser("show", help="Show graph statistics")
    show_parser.set_defaults(func=_cmd_show)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
