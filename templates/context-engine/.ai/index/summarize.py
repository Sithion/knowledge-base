import argparse
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path, PurePosixPath

import yaml

from config import MEMORY_DIR, REPO_ROOT, SUMMARIES_DIR

DEFAULT_COGNISTORE_IPC_URL = "http://localhost:7321/ipc/addKnowledge"
COGNISTORE_TIMEOUT_SECONDS = 5

# Map common file extensions to language tags
_LANGUAGE_BY_EXT = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".rb": "ruby",
    ".cs": "csharp",
    ".sh": "bash",
    ".md": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".json": "json",
    ".sql": "sql",
}


STATUS_MAP = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "R": "modified",
    "C": "modified",
    "T": "modified",
    "U": "modified",
    "X": "modified",
    "B": "modified",
}


def _run_git_command(args: list[str]) -> tuple[int, str, str]:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def _parse_name_status(name_status_output: str) -> list[dict[str, str]]:
    changes: dict[str, dict[str, str]] = {}
    for line in name_status_output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        raw_status = parts[0]
        status_code = raw_status[0]
        if status_code in {"R", "C"} and len(parts) >= 3:
            file_path = parts[2]
        elif len(parts) >= 2:
            file_path = parts[1]
        else:
            continue

        normalized = PurePosixPath(file_path).as_posix()
        changes[normalized] = {
            "file": normalized,
            "change_type": STATUS_MAP.get(status_code, "modified"),
        }
    return list(changes.values())


def _collect_diff_changes() -> tuple[list[dict[str, str]], str]:
    stat_code, stat_output, stat_err = _run_git_command(["diff", "--stat"])
    if stat_code != 0:
        raise RuntimeError(stat_err or "Unable to run git diff --stat")

    name_code, name_output, name_err = _run_git_command(["diff", "--name-status"])
    if name_code != 0:
        raise RuntimeError(name_err or "Unable to run git diff --name-status")

    changes = _parse_name_status(name_output)
    stat_lines = [line.strip() for line in stat_output.splitlines() if line.strip()]
    stat_summary = stat_lines[-1] if stat_lines else ""
    return changes, stat_summary


def collect_diff_changes() -> tuple[list[dict[str, str]], str]:
    return _collect_diff_changes()


def _collect_explicit_file_changes(
    files: list[str],
) -> tuple[list[dict[str, str]], str]:
    changes: list[dict[str, str]] = []
    for file_path in files:
        normalized = PurePosixPath(file_path).as_posix()
        absolute = (REPO_ROOT / Path(normalized)).resolve()
        change_type = "deleted" if not absolute.exists() else "modified"
        changes.append({"file": normalized, "change_type": change_type})
    stat_summary = f"{len(changes)} file(s) provided via --files"
    return changes, stat_summary


def collect_explicit_file_changes(files: list[str]) -> tuple[list[dict[str, str]], str]:
    return _collect_explicit_file_changes(files)


def _merge_changes(*groups: list[dict[str, str]]) -> list[dict[str, str]]:
    merged: dict[str, dict[str, str]] = {}
    for group in groups:
        for item in group:
            merged[item["file"]] = item
    return [merged[key] for key in sorted(merged.keys())]


def merge_changes(*groups: list[dict[str, str]]) -> list[dict[str, str]]:
    return _merge_changes(*groups)


def _derive_modules(files: list[str]) -> list[str]:
    modules: set[str] = set()
    for file_path in files:
        parts = PurePosixPath(file_path).parts
        if len(parts) <= 1:
            modules.add("(root)")
            continue
        if parts[0].startswith(".") and len(parts) >= 2:
            modules.add(f"{parts[0]}/{parts[1]}")
            continue
        modules.add(parts[0])
    return sorted(modules)


def derive_modules(files: list[str]) -> list[str]:
    return _derive_modules(files)


def _build_message(
    provided_message: str | None,
    stat_summary: str,
    changes: list[dict[str, str]],
) -> tuple[str, str]:
    if provided_message:
        return provided_message.strip(), "User-provided message"

    if stat_summary:
        return (
            f"Updated project files ({stat_summary})",
            "Auto-generated from git diff statistics",
        )

    if changes:
        return f"Updated {len(changes)} file(s)", "Auto-generated from file metadata"

    return "No file-level changes detected", "Auto-generated fallback"


def build_message(
    message: str | None,
    stat_summary: str,
    changes: list[dict[str, str]],
) -> tuple[str, str]:
    return _build_message(message, stat_summary, changes)


def _append_decision_log(
    scope: str, decision: str, rationale: str, date_str: str
) -> Path:
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    decisions_path = MEMORY_DIR / "decisions.log"

    if not decisions_path.exists():
        decisions_path.write_text("# Decisions Log\n", encoding="utf-8")

    block = (
        "\n---\n"
        f"date: {date_str}\n"
        f"scope: {scope}\n"
        f"decision: {decision}\n"
        f"rationale: {rationale}\n"
        "---\n"
    )
    with decisions_path.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            handle.write(block)
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    return decisions_path


def append_decision_log(
    scope: str, decision: str, rationale: str, date_str: str
) -> Path:
    return _append_decision_log(scope, decision, rationale, date_str)


def _detect_repo_name() -> str:
    code, out, _ = _run_git_command(["rev-parse", "--show-toplevel"])
    if code == 0 and out:
        return Path(out).name
    return REPO_ROOT.name


def _detect_language_tags(files: list[str]) -> list[str]:
    langs: set[str] = set()
    for f in files:
        ext = PurePosixPath(f).suffix.lower()
        lang = _LANGUAGE_BY_EXT.get(ext)
        if lang:
            langs.add(f"language:{lang}")
    return sorted(langs)


def _bridge_config_path() -> Path:
    return REPO_ROOT / "summarize.config.toml"


def _read_bridge_config() -> dict:
    """Tiny TOML reader for summarize.config.toml.

    Uses stdlib ``tomllib`` when available (Python 3.11+); otherwise falls
    back to a minimal regex parser that handles only the keys we care about.
    """
    path = _bridge_config_path()
    if not path.exists():
        return {}
    try:
        import tomllib  # type: ignore[attr-defined]
        with path.open("rb") as fh:
            data = tomllib.load(fh)
        return data.get("cognistore", {}) if isinstance(data, dict) else {}
    except ModuleNotFoundError:
        text = path.read_text(encoding="utf-8")
        cfg: dict = {}
        m = re.search(
            r"(?ms)^\[cognistore\]\s*$(.*?)(?=^\[|\Z)", text
        )
        section = m.group(1) if m else text
        for line in section.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip("'\"")
            if val.lower() in {"true", "false"}:
                cfg[key] = val.lower() == "true"
            else:
                cfg[key] = val
        return cfg
    except Exception:
        return {}


def _bridge_enabled(cli_disabled: bool) -> bool:
    if cli_disabled:
        return False
    cfg = _read_bridge_config()
    # Default ON; config can opt-out via `enabled = false`.
    return bool(cfg.get("enabled", True))


def _cognistore_url() -> str:
    cfg = _read_bridge_config()
    url = os.environ.get("COGNISTORE_IPC_URL")
    if url:
        return url
    return str(cfg.get("ipc_url", DEFAULT_COGNISTORE_IPC_URL))


def _build_bridge_payload(
    repo_name: str,
    decision_text: str,
    message: str,
    rationale: str,
    scope_modules: str,
    files: list[str],
    extra_tags: list[str] | None = None,
) -> dict:
    tags = ["context-engine", repo_name]
    tags.extend(_detect_language_tags(files))
    if extra_tags:
        tags.extend(extra_tags)
    # de-duplicate, preserve order
    seen: set[str] = set()
    deduped = [t for t in tags if not (t in seen or seen.add(t))]

    stable_id = hashlib.sha256(
        f"{repo_name}\x00{decision_text}\x00{message}".encode("utf-8")
    ).hexdigest()

    return {
        "id": stable_id,
        "type": "decision",
        "scope": f"workspace:{repo_name}",
        "tags": deduped,
        "title": message,
        "content": (
            f"{message}\n\n"
            f"Rationale: {rationale}\n"
            f"Modules: {scope_modules}\n"
            f"Files: {', '.join(files) if files else '(none)'}"
        ),
        "source": "context-engine:summarize.py",
    }


def _send_to_cognistore(payload: dict, url: str) -> tuple[bool, str]:
    """POST payload to CogniStore IPC. Returns (ok, message)."""
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=COGNISTORE_TIMEOUT_SECONDS) as resp:
            status = getattr(resp, "status", 200)
            if 200 <= status < 300:
                return True, f"posted (HTTP {status})"
            return False, f"non-2xx HTTP {status}"
    except urllib.error.URLError as exc:
        return False, f"connection error: {exc.reason}"
    except TimeoutError:
        return False, "timeout"
    except Exception as exc:  # pragma: no cover - defensive
        return False, f"{type(exc).__name__}: {exc}"


def _candidate_module_summary_paths(module: str) -> list[Path]:
    safe_name = module.replace("/", "_")
    return [
        SUMMARIES_DIR / f"{module}.md",
        SUMMARIES_DIR / f"{safe_name}.md",
        SUMMARIES_DIR / module / "summary.md",
    ]


def _insert_recent_change(content: str, line: str) -> str:
    lines = content.splitlines()
    heading_indexes = [
        i for i, value in enumerate(lines) if value.strip() == "## Recent Changes"
    ]
    if heading_indexes:
        index = heading_indexes[0]
        lines.insert(index + 1, line)
        return "\n".join(lines) + "\n"

    appended = content
    if appended and not appended.endswith("\n"):
        appended += "\n"
    appended += f"\n## Recent Changes\n{line}\n"
    return appended


def _update_module_summaries(modules: list[str], line: str) -> list[str]:
    updated: list[str] = []
    for module in modules:
        for candidate in _candidate_module_summary_paths(module):
            if not candidate.exists() or not candidate.is_file():
                continue
            content = candidate.read_text(encoding="utf-8")
            new_content = _insert_recent_change(content, line)
            candidate.write_text(new_content, encoding="utf-8")
            updated.append(str(candidate))
            break
    return updated


def _record(args: argparse.Namespace) -> int:
    diff_changes: list[dict[str, str]] = []
    explicit_changes: list[dict[str, str]] = []
    stat_fragments: list[str] = []
    warnings: list[str] = []

    if args.diff:
        try:
            diff_changes, diff_stat = collect_diff_changes()
            if diff_stat:
                stat_fragments.append(diff_stat)
        except RuntimeError as error:
            warnings.append(
                f"Git diff unavailable ({error}). Falling back to explicit file input if provided."
            )

    if args.files:
        explicit_changes, files_stat = collect_explicit_file_changes(args.files)
        if files_stat:
            stat_fragments.append(files_stat)

    changes = merge_changes(diff_changes, explicit_changes)
    stat_summary = "; ".join(fragment for fragment in stat_fragments if fragment)
    message, rationale = build_message(args.message, stat_summary, changes)

    files = [item["file"] for item in changes]
    modules = derive_modules(files)
    scope = ", ".join(modules) if modules else "system-wide"

    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    timestamp = now.isoformat(timespec="seconds")

    decision_log_path = append_decision_log(scope, message, rationale, date_str)

    bridge_status: dict | None = None
    if _bridge_enabled(getattr(args, "no_cognistore_bridge", False)):
        repo_name = _detect_repo_name()
        url = _cognistore_url()
        payload = _build_bridge_payload(
            repo_name=repo_name,
            decision_text=message,
            message=message,
            rationale=rationale,
            scope_modules=scope,
            files=files,
        )
        ok, info = _send_to_cognistore(payload, url)
        if ok:
            bridge_status = {"cognistore_bridge": "ok", "url": url, "id": payload["id"]}
        else:
            print(
                f"[summarize] warning: CogniStore bridge unreachable ({info}); "
                f"decision recorded locally only at {decision_log_path}",
                file=sys.stderr,
            )
            bridge_status = {"cognistore_bridge": "skipped", "reason": info, "url": url}

    updated_summaries: list[str] = []
    if args.update_summaries and modules:
        update_line = f"- {date_str}: {message}"
        updated_summaries = _update_module_summaries(modules, update_line)

    summary = {
        "datetime": timestamp,
        "changed_files": changes,
        "message": message,
        "impacted_modules": modules,
        "decision_log": str(decision_log_path),
    }

    if updated_summaries:
        summary["updated_module_summaries"] = updated_summaries
    if bridge_status:
        summary["cognistore"] = bridge_status
    if warnings:
        summary["warnings"] = warnings

    print(yaml.safe_dump(summary, sort_keys=False, allow_unicode=True).strip())
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Post-task summary recorder")
    subparsers = parser.add_subparsers(dest="command", required=True)

    record_parser = subparsers.add_parser("record", help="Record a task summary")
    record_parser.add_argument(
        "--diff", action="store_true", help="Collect changes from git diff"
    )
    record_parser.add_argument(
        "--files",
        nargs="+",
        help="Explicit changed files",
    )
    record_parser.add_argument(
        "--message",
        type=str,
        help="What was done and why",
    )
    record_parser.add_argument(
        "--update-summaries",
        action="store_true",
        help="Update existing module summary files for impacted modules",
    )
    record_parser.add_argument(
        "--no-cognistore-bridge",
        action="store_true",
        dest="no_cognistore_bridge",
        help="Skip the CogniStore IPC bridge for this invocation (decisions stay local).",
    )
    record_parser.set_defaults(handler=_record)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "record" and not args.diff and not args.files:
        parser.error("record requires at least one of --diff or --files")

    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
