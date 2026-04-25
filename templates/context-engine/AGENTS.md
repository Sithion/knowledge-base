# AGENTS.md — Context-First Development

All AI agents working in this project MUST use the context engine before and after every task.

## Default Workflow (Non-Negotiable)

```
BEFORE any implementation:
  1. Retrieve context:  python .ai/index/retrieve.py "<task description>"
  2. Read the top results — they contain architecture, standards, prior decisions
  3. If editing code: python .ai/index/dependency_graph.py neighbors <file> --depth 2

DURING implementation:
  4. Respect retrieved context — follow existing patterns and decisions
  5. Stay within scope of retrieved files and their neighbors

AFTER implementation:
  6. Summarize:  python .ai/index/summarize.py record --diff --message "<what and why>"
  7. If significant changes: python .ai/index/build_index.py
```

## Activation

The context engine requires its Python virtual environment:

```bash
source .venv-context/bin/activate
```

If `.venv-context/` doesn't exist, run `bash scripts/setup_context_engine.sh` first.

If the MCP server is configured, tools are available directly as `context_retrieve`, `context_index`, `context_summarize`, `context_deps` — no manual activation needed.

## Rules

- Never make changes without first retrieving relevant context
- Never ignore prior decisions recorded in `.ai/memory/decisions.log`
- Never dump full files into context when summaries exist
- Always record decisions and changes after completing work
- Prefer `.ai/context/` docs over raw code for understanding architecture

## Skill

Load the `context-engine` skill for detailed tool usage and role-based context budgets.

---

## Document-to-DevOps Pipeline

This project includes a 6-skill pipeline that transforms raw documents into Azure DevOps work items.

```
Documents → Ingest → Classify → Extract Requirements → Generate BRD / Spec → Sync to Azure DevOps
```

### Available Skills

| Skill | What It Does | Trigger Phrases |
|---|---|---|
| `document-ingester` | Parse PDFs, DOCX, XLSX, PPTX, images, emails into structured text | "ingest", "parse", "extract text from" |
| `document-classifier` | Classify by type, domain, priority, complexity | "classify", "categorize", "sort by type" |
| `requirements-extractor` | Extract requirements with IDs, acceptance criteria, quality scores | "extract requirements", "pull out user stories" |
| `brd-generator` | Generate Business Requirements Documents | "generate BRD", "create business requirements document" |
| `spec-generator` | Generate technical specifications with APIs, data models | "generate spec", "create technical specification" |
| `azure-devops-syncer` | Create work items in Azure DevOps with proper hierarchy | "sync to DevOps", "create work items", "push to Azure DevOps" |

### Supported Document Formats

| Format | Extensions |
|---|---|
| PDF | `.pdf` (OCR for scanned documents) |
| Word | `.docx` |
| Excel | `.xlsx` |
| PowerPoint | `.pptx` |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff` |
| Email | `.eml`, `.msg` |
| HTML/Markdown/Text | `.html`, `.md`, `.txt` |

### Pipeline Usage

**Full pipeline:**
> "Run the full pipeline on `./docs/`. Generate BRD, tech spec, and sync to Azure DevOps."

**Partial pipeline:**
> "Ingest and classify the documents in `./discovery/`. Don't extract requirements yet."

> "Generate a BRD from the extracted requirements. Use the professional template."

> "Sync to Azure DevOps with dry-run first."

### Pipeline Rules

- Always use **dry-run** before syncing to Azure DevOps
- Review generated BRDs and specs before sharing externally
- Flag requirements with quality scores below 0.7 for manual review
- The agent reads and processes documents but never modifies originals

### Quality Scores

The requirements extractor scores each requirement on: specificity, testability, clarity, completeness, priority alignment, and domain consistency.

| Score Range | Meaning |
|---|---|
| 85-100 | Excellent |
| 70-84 | Good |
| 50-69 | Needs refinement |
| Below 50 | Flag for rewrite |

### Templates

| Skill | Available Templates |
|---|---|
| BRD Generator | `professional` (default), `startup` (lean), `agile` |
| Spec Generator | `api-first` (default), `database-first`, `architecture` |

### Pipeline Guide

Load the `pipeline-guide` skill for detailed orchestration instructions, edge case handling, and optimization strategies.
