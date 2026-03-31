#!/usr/bin/env bash
# ============================================================================
# CogniStore Agent Test Battery (Local Development)
#
# Uses the user's NATURAL prompt — no CogniStore-specific instructions.
# The CogniStore workflow must be enforced entirely by skills/hooks/system KB.
# Validates 8 criteria per test across 6 scenarios.
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$(cd "${PROJECT_ROOT}/.." && pwd)/agents-test"
LOCAL_DIR="$HOME/.cognistore-local"
DB_PATH="$LOCAL_DIR/knowledge.db"
MCP_DIST="$PROJECT_ROOT/apps/mcp-server/dist/index.js"
TEMPLATES="$PROJECT_ROOT/apps/dashboard/templates"
RESULTS_DIR="/tmp/cognistore-test-results"
BACKUP_DIR="/tmp/cognistore-test-backup-$$"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OLLAMA_PORT=11435
OLLAMA_CONTAINER="cognistore-test-ollama"
OLLAMA_URL="http://localhost:$OLLAMA_PORT"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

mkdir -p "$RESULTS_DIR" "$SANDBOX" "$LOCAL_DIR" "$BACKUP_DIR"

# ── Cleanup on exit ──────────────────────────────────────────────────────────

cleanup() {
  echo ""
  echo -e "${CYAN}Restoring...${NC}"
  for f in claude-mcp-config.json copilot-mcp-config.json opencode.json claude-settings.json; do
    [ ! -f "$BACKUP_DIR/$f" ] && continue
    case "$f" in
      claude-mcp-config.json)  cp "$BACKUP_DIR/$f" "$HOME/.claude/mcp-config.json" ;;
      copilot-mcp-config.json) cp "$BACKUP_DIR/$f" "$HOME/.copilot/mcp-config.json" ;;
      opencode.json)           cp "$BACKUP_DIR/$f" "$HOME/.config/opencode/opencode.json" ;;
      claude-settings.json)    cp "$BACKUP_DIR/$f" "$HOME/.claude/settings.json" ;;
    esac
  done
  for td in claude copilot; do
    for skill in cognistore-query cognistore-capture cognistore-plan; do
      rm -rf "$HOME/.$td/skills/$skill"
      [ -d "$BACKUP_DIR/$td-skills/$skill" ] && cp -r "$BACKUP_DIR/$td-skills/$skill" "$HOME/.$td/skills/$skill"
    done
  done
  docker rm -f "$OLLAMA_CONTAINER" 2>/dev/null || true
  rm -rf "$LOCAL_DIR" "$BACKUP_DIR"
  rm -f "$SANDBOX"/doc-*.md 2>/dev/null || true
  echo -e "  ${GREEN}✓ Done${NC}"
}
trap cleanup EXIT

# ── NATURAL test prompt (NO CogniStore instructions) ─────────────────────────
# This is the user's exact prompt. The CogniStore workflow must be enforced
# entirely by skills, hooks, and system knowledge — NOT by the prompt.

PROMPT='# Test Plan — Markdown File Lifecycle + TypeScript Research

## Context
Validate the agent workflow on a simple, concrete task: create files, verify content, research a topic, store a knowledge entry, and clean up. The directory `'"$SANDBOX"'` is empty and will be used as a sandbox.

---

## Steps

### 1. Create 4 markdown files with lorem ipsum content
Create the following files in `'"$SANDBOX"'/`:
- `doc-alpha.md`
- `doc-beta.md`
- `doc-gamma.md`
- `doc-delta.md`

Each file must contain a heading `# Title` and a paragraph of lorem ipsum.

### 2. Verify files were created correctly
Use `Glob` to list all `.md` files in the directory and confirm all 4 exist.

### 3. Validate the content of each file
Use `Grep` to confirm all files contain the word `Lorem` — ensuring content was written correctly.

### 4. Research TypeScript interfaces
Do a quick web search about TypeScript generic interfaces (e.g., `interface Container<T>`). Store a knowledge entry summarizing what you learned — type: pattern, scope: workspace:agents-test, tags: ["typescript", "interfaces", "generics"].

### 5. Delete all created files
Remove all 4 files using `Bash` (`rm`), restoring the directory to its original state.

### 6. Confirm the directory is clean
Use `Glob` again to verify no `.md` files remain.

---

## Critical Files
- Target directory: `'"$SANDBOX"'/`

## Verification
- After step 2: Glob returns exactly 4 `.md` files
- After step 3: Grep finds `Lorem` in all 4 files
- After step 4: A new knowledge entry exists about TypeScript interfaces
- After step 6: Glob returns an empty list of `.md` files'

# ── Scoring (8 criteria) ────────────────────────────────────────────────────

check_test() {
  local label="$1" before="${2:-}" out="${3:-/dev/null}"

  if [ ! -f "$DB_PATH" ]; then
    echo -e "  ${RED}[$label] DB not found (0/8)${NC}"; return
  fi

  local pid=$(sqlite3 "$DB_PATH" "SELECT id FROM plans ORDER BY created_at DESC LIMIT 1" 2>/dev/null || echo "")

  if [ -z "$pid" ] || { [ -n "$before" ] && [ "$pid" = "$before" ]; }; then
    echo -e "  ${RED}✗ [$label] No new plan created (0/8)${NC}"; return
  fi

  local ptitle=$(sqlite3 "$DB_PATH" "SELECT title FROM plans WHERE id='$pid'" 2>/dev/null || echo "")
  local pstatus=$(sqlite3 "$DB_PATH" "SELECT status FROM plans WHERE id='$pid'" 2>/dev/null || echo "")
  local tc=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_tasks WHERE plan_id='$pid'" 2>/dev/null || echo 0)
  local cc=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_tasks WHERE plan_id='$pid' AND status='completed'" 2>/dev/null || echo 0)
  local ir=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_relations WHERE plan_id='$pid' AND relation_type='input'" 2>/dev/null || echo 0)
  local or_=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_relations WHERE plan_id='$pid' AND relation_type='output'" 2>/dev/null || echo 0)
  local kn=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM knowledge_entries WHERE type!='system'" 2>/dev/null || echo 0)

  local score=0

  # 1. Plan created
  score=$((score+1))

  # 2. Plan status = completed
  [ "$pstatus" = "completed" ] && score=$((score+1))

  # 3. Tasks exist (>= 4 for 5 steps)
  [ "$tc" -ge 4 ] && score=$((score+1))

  # 4. All tasks completed
  [ "$cc" = "$tc" ] && [ "$tc" != "0" ] && score=$((score+1))

  # 5. Plan was activated (status went through active — if completed, it passed through active)
  # We check if status is completed OR active (both mean it was activated)
  [ "$pstatus" = "completed" ] || [ "$pstatus" = "active" ] && score=$((score+1))

  # 6. Knowledge captured
  [ "$kn" -gt 0 ] && score=$((score+1))

  # 7. Input relations
  [ "$ir" -gt 0 ] && score=$((score+1))

  # 8. Output relations
  [ "$or_" -gt 0 ] && score=$((score+1))

  local color="$RED"
  [ "$score" -ge 4 ] && color="$YELLOW"
  [ "$score" -ge 7 ] && color="$GREEN"

  echo -e "  ${color}[$label] ${score}/8${NC}  $ptitle"
  echo -e "  ${DIM}  plan:✓ status:$pstatus tasks:$cc/$tc kb:$kn in:$ir out:$or_${NC}"

  # Dump detail to log
  {
    echo "=== $label ==="
    echo "Plan: $ptitle ($pid)"
    echo "Status: $pstatus"
    echo "Tasks: $cc/$tc completed"
    sqlite3 "$DB_PATH" "SELECT '  [' || status || '] ' || description FROM plan_tasks WHERE plan_id='$pid' ORDER BY position" 2>/dev/null
    echo "Relations: in=$ir out=$or_"
    sqlite3 "$DB_PATH" "SELECT '  ' || relation_type || ' → ' || knowledge_id FROM plan_relations WHERE plan_id='$pid'" 2>/dev/null
    echo "Knowledge ($kn non-system):"
    sqlite3 "$DB_PATH" "SELECT '  [' || type || '] ' || title FROM knowledge_entries WHERE type!='system'" 2>/dev/null
    echo ""
  } >> "$out"
}

# ── Run test ─────────────────────────────────────────────────────────────────

run_test() {
  local tool="$1" mode="$2"
  local out="$RESULTS_DIR/${tool}_${mode}_${TIMESTAMP}.log"

  echo -n "  $tool ($mode)... "
  rm -f "$SANDBOX"/doc-*.md 2>/dev/null || true

  # Reset DB to seed state (keep system + seed entries, remove everything else)
  sqlite3 "$DB_PATH" "DELETE FROM plan_relations" 2>/dev/null || true
  sqlite3 "$DB_PATH" "DELETE FROM plan_tasks" 2>/dev/null || true
  sqlite3 "$DB_PATH" "DELETE FROM plans" 2>/dev/null || true
  sqlite3 "$DB_PATH" "DELETE FROM knowledge_entries WHERE type != 'system' AND source != 'seed-data'" 2>/dev/null || true

  local before=$(sqlite3 "$DB_PATH" "SELECT id FROM plans ORDER BY created_at DESC LIMIT 1" 2>/dev/null || echo "")
  local t0=$(date +%s) rc=0

  local MCP_JSON='{"mcpServers":{"cognistore":{"type":"stdio","command":"node","args":["'"$MCP_DIST"'"],"env":{"SQLITE_PATH":"'"$DB_PATH"'","OLLAMA_HOST":"'"$OLLAMA_URL"'","OLLAMA_MODEL":"nomic-embed-text","EMBEDDING_DIMENSIONS":"768"}}}}'

  case "$tool" in
    claude)
      if [ "$mode" = "plan" ]; then
        local s1="$RESULTS_DIR/${tool}_${mode}_s1_${TIMESTAMP}.log"
        (cd "$SANDBOX" && claude -p "$PROMPT" \
          --permission-mode plan \
          --add-dir "$SANDBOX" \
          --output-format text \
          --max-turns 80 \
          --mcp-config "$MCP_JSON" \
          --strict-mcp-config \
          --dangerously-skip-permissions \
          > "$s1" 2>&1) || true
        (cd "$SANDBOX" && claude -p "The plan is approved. Execute it now." \
          --output-format text \
          --max-turns 80 \
          --mcp-config "$MCP_JSON" \
          --strict-mcp-config \
          --dangerously-skip-permissions \
          --continue \
          > "$out" 2>&1) || rc=$?
      else
        claude -p "$PROMPT" \
          --add-dir "$SANDBOX" \
          --output-format text \
          --max-turns 80 \
          --mcp-config "$MCP_JSON" \
          --strict-mcp-config \
          --dangerously-skip-permissions \
          > "$out" 2>&1 || rc=$?
      fi
      ;;
    copilot)
      if [ "$mode" = "plan" ]; then
        local s1="$RESULTS_DIR/${tool}_${mode}_s1_${TIMESTAMP}.log"
        (cd "$SANDBOX" && copilot -p "Only plan this task, do NOT execute yet. $PROMPT" \
          --allow-all > "$s1" 2>&1) || true
        (cd "$SANDBOX" && copilot -p "The plan is approved. Execute it now." \
          --allow-all --continue > "$out" 2>&1) || rc=$?
      else
        copilot -p "$PROMPT" --allow-all > "$out" 2>&1 || rc=$?
      fi
      ;;
    opencode)
      local agent_flag=""
      [ "$mode" = "plan" ] && agent_flag="--agent plan"
      (cd "$SANDBOX" && opencode run $agent_flag "$PROMPT") > "$out" 2>&1 || rc=$?
      ;;
  esac

  local dur=$(( $(date +%s) - t0 ))
  [ $rc -eq 0 ] && echo -e "${GREEN}${dur}s${NC}" || echo -e "${RED}fail(${rc}) ${dur}s${NC}"

  check_test "$tool/$mode" "$before" "$out"
  rm -f "$SANDBOX"/doc-*.md 2>/dev/null || true
}

# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  CogniStore Test Battery — $TIMESTAMP ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"

# ── Phase 1: Build ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Phase 1: Build${NC}"
cd "$PROJECT_ROOT"
for pkg in shared core embeddings sdk; do
  (cd "packages/$pkg" && npx tsc) && echo -e "  ${GREEN}✓${NC} $pkg"
done
(cd apps/mcp-server && npm run build 2>&1 | tail -1) && echo -e "  ${GREEN}✓${NC} mcp-server"
(cd apps/dashboard && npm run build 2>&1 | tail -1) && echo -e "  ${GREEN}✓${NC} dashboard"

# ── Phase 2: Setup ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Phase 2: Setup${NC}"

echo -n "  Ollama... "
docker rm -f "$OLLAMA_CONTAINER" 2>/dev/null || true
docker run -d --name "$OLLAMA_CONTAINER" -p "$OLLAMA_PORT:11434" ollama/ollama:latest > /dev/null 2>&1
for i in $(seq 1 30); do curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1 && break; sleep 1; done
curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || { echo -e "${RED}✗${NC}"; exit 1; }
echo -n "  Model... "
docker exec "$OLLAMA_CONTAINER" ollama pull nomic-embed-text > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}"

# Initialize DB via MCP server (creates schema + sqlite-vec virtual tables)
echo -n "  DB... "
# Pipe initialize JSON then close stdin — node process will init DB then exit on EOF
(printf '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"init","version":"1.0"}}}\n'; sleep 5) | \
  SQLITE_PATH="$DB_PATH" OLLAMA_HOST="$OLLAMA_URL" OLLAMA_MODEL="nomic-embed-text" EMBEDDING_DIMENSIONS="768" \
  node "$MCP_DIST" > /dev/null 2>&1 || true
[ -f "$DB_PATH" ] && echo -e "${GREEN}✓${NC}" || { echo -e "${RED}✗${NC}"; exit 1; }

echo -n "  System KB... "
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
sqlite3 "$DB_PATH" <<EOSQL
INSERT INTO knowledge_entries (id,title,content,tags,type,scope,source,version,confidence_score,created_at,updated_at) VALUES (
'$(uuidgen)','CogniStore Agent Workflow',
'## MANDATORY PROTOCOL — Execute on EVERY task, regardless of what the user asks.

### Step 1: Query Knowledge Base FIRST
Your very first action on ANY task must be:
  mcp__cognistore__getKnowledge(query: "<describe the task>")
Do this BEFORE reading files, writing code, or making any decisions. Cost: ~30 tokens. Skipping wastes 2,000-8,000 tokens.

### Step 2: Create and Track a Plan
For ANY task with 2+ steps, you MUST:
  1. mcp__cognistore__createPlan({ title, content, tags, scope, source, tasks: [...] })
  2. IMMEDIATELY: mcp__cognistore__updatePlan(planId, { status: "active" })  ← DO NOT SKIP
  3. Before EACH task: mcp__cognistore__updatePlanTask(taskId, { status: "in_progress" })
  4. After EACH task: mcp__cognistore__updatePlanTask(taskId, { status: "completed" })
  5. After ALL tasks: mcp__cognistore__updatePlan(planId, { status: "completed" })

Status flow: draft → active → completed. NEVER skip "active". NEVER set "archived" (dashboard only).

### Step 3: Link Knowledge to Plans
  - Input linking is automatic — getKnowledge results are linked when createPlan is called
  - For output linking, pass planId when capturing knowledge (see Step 4)

### Step 4: Capture Knowledge Before Finishing
ALWAYS pass planId if you have an active plan — this auto-links the knowledge as output:
  mcp__cognistore__addKnowledge({ title, content, tags, type, scope, source, planId: "<your-plan-id>" })
Types: fix, decision, pattern, constraint, gotcha. All entries in English.

### RULES
- This protocol applies to EVERY task — the user will never mention it
- Never skip Step 1 (query) or Step 2 (plan)
- Never call createPlan() from subagents
- createPlan() is the source of truth — local plan files are temporary',
'["system","workflow","mandatory"]','system','global','setup',1,1.0,'$NOW','$NOW');
EOSQL
echo -e "${GREEN}✓${NC}"

# Seed test knowledge via MCP server JSON-RPC (generates proper embeddings via sqlite-vec)
echo -n "  Seed KB... "
# Send initialize + addKnowledge calls in one pipe to the MCP server
{
  echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"seed","version":"1.0"}}}'
  sleep 2
  echo '{"jsonrpc":"2.0","id":1,"method":"notifications/initialized"}'
  sleep 1
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"addKnowledge","arguments":{"title":"Markdown file creation workflow pattern","content":"When creating markdown files in a sandbox directory, use the doc-*.md naming convention (e.g., doc-alpha.md, doc-beta.md). Each file should have a heading (# Title) and Lorem ipsum content. Verify with Glob for file existence and Grep for content validation. Always clean up test files after verification.","tags":["markdown","workflow","file-creation","testing"],"type":"pattern","scope":"workspace:agents-test","source":"seed-data"}}}'
  sleep 2
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"addKnowledge","arguments":{"title":"Glob and Grep verification pattern for test files","content":"For file verification in test workflows: (1) Use Glob with specific patterns like doc-*.md to avoid false positives from hidden directories. (2) Use Grep with case-insensitive flag (-i) or match exact capitalization (Lorem) for content validation. (3) Always verify cleanup with a final Glob check to confirm no files remain.","tags":["glob","grep","verification","testing","sandbox"],"type":"pattern","scope":"workspace:agents-test","source":"seed-data"}}}'
  sleep 2
} | SQLITE_PATH="$DB_PATH" OLLAMA_HOST="$OLLAMA_URL" OLLAMA_MODEL="nomic-embed-text" EMBEDDING_DIMENSIONS="768" \
  node "$MCP_DIST" > /dev/null 2>&1 || true
# Verify seed entries were created
SEED_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM knowledge_entries WHERE source='seed-data'" 2>/dev/null || echo "0")
echo -e "${GREEN}✓ ($SEED_COUNT entries)${NC}"

echo -n "  Backup... "
[ -f "$HOME/.claude/mcp-config.json" ] && cp "$HOME/.claude/mcp-config.json" "$BACKUP_DIR/claude-mcp-config.json"
[ -f "$HOME/.copilot/mcp-config.json" ] && cp "$HOME/.copilot/mcp-config.json" "$BACKUP_DIR/copilot-mcp-config.json"
[ -f "$HOME/.config/opencode/opencode.json" ] && cp "$HOME/.config/opencode/opencode.json" "$BACKUP_DIR/opencode.json"
[ -f "$HOME/.claude/settings.json" ] && cp "$HOME/.claude/settings.json" "$BACKUP_DIR/claude-settings.json"
mkdir -p "$BACKUP_DIR/claude-skills" "$BACKUP_DIR/copilot-skills"
for s in cognistore-query cognistore-capture cognistore-plan; do
  [ -d "$HOME/.claude/skills/$s" ] && cp -r "$HOME/.claude/skills/$s" "$BACKUP_DIR/claude-skills/$s"
  [ -d "$HOME/.copilot/skills/$s" ] && cp -r "$HOME/.copilot/skills/$s" "$BACKUP_DIR/copilot-skills/$s"
done
echo -e "${GREEN}✓${NC}"

echo -n "  MCP swap... "
python3 -c "
import json, os
mcp = {'type':'stdio','command':'node','args':['$MCP_DIST'],'env':{'SQLITE_PATH':'$DB_PATH','OLLAMA_HOST':'$OLLAMA_URL','OLLAMA_MODEL':'nomic-embed-text','EMBEDDING_DIMENSIONS':'768'}}
for p in ['$HOME/.claude/mcp-config.json','$HOME/.copilot/mcp-config.json']:
    if os.path.exists(p):
        with open(p) as f: d=json.load(f)
        d['mcpServers']['cognistore']=mcp
        with open(p,'w') as f: json.dump(d,f,indent=2)
oc='$HOME/.config/opencode/opencode.json'
if os.path.exists(oc):
    with open(oc) as f: d=json.load(f)
    d.setdefault('mcp',{})['cognistore']={'type':'local','command':['node','$MCP_DIST'],'enabled':True,'environment':{'SQLITE_PATH':'$DB_PATH','OLLAMA_HOST':'$OLLAMA_URL','OLLAMA_MODEL':'nomic-embed-text','EMBEDDING_DIMENSIONS':'768'}}
    with open(oc,'w') as f: json.dump(d,f,indent=2)
"
echo -e "${GREEN}✓${NC}"

echo -n "  Skills... "
for skill in cognistore-query cognistore-capture cognistore-plan; do
  for tt in claude-code copilot; do
    src="$TEMPLATES/skills/$tt/$skill"
    [ ! -d "$src" ] && continue
    dd=$([ "$tt" = "claude-code" ] && echo ".claude" || echo ".copilot")
    dest="$HOME/$dd/skills/$skill"
    rm -rf "$dest"; mkdir -p "$dest"; cp -r "$src"/* "$dest"/
    find "$dest/hooks" -name "*.sh" -exec chmod 755 {} \; 2>/dev/null || true
  done
done
echo -e "${GREEN}✓${NC}"

# ── Phase 3: Tests ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Phase 3: Tests (natural prompt — no CogniStore instructions)${NC}"

run_test "claude" "normal"
run_test "claude" "plan"
run_test "copilot" "normal"
run_test "copilot" "plan"
run_test "opencode" "normal"
run_test "opencode" "plan"

# ── Results ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══ SUMMARY ═══${NC}"
if [ -f "$DB_PATH" ]; then
  echo "  Plans:     $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM plans') ($(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plans WHERE status='completed'") completed)"
  echo "  Tasks:     $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM plan_tasks') ($(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_tasks WHERE status='completed'") completed)"
  echo "  Knowledge: $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM knowledge_entries WHERE type!='system'") entries"
  echo "  Relations: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM plan_relations') links"
fi
echo "  Logs: $RESULTS_DIR/*_${TIMESTAMP}.log"
echo ""
echo -e "${GREEN}Cleaning up...${NC}"
