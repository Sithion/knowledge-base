import type { Plugin } from "opencode";

export default {
  name: "cognistore-plan-enforcement",
  events: {
    "tool.execute.after": async (event) => {
      const workTools = ["Write", "Edit", "MultiEdit", "Bash", "NotebookEdit"];
      const toolName = event.tool || "";
      if (toolName.startsWith("mcp__cognistore__")) return;
      if (workTools.includes(toolName)) {
        console.log("📋 If you have an active plan, ensure task tracking is current.");
      }
    },
    "session.end": async () => {
      console.log(
        "🛑 Session ending — check plan completion and capture knowledge."
      );
    },
    "experimental.session.compacting": async () => {
      console.log(
        "📋 Context compacted — run listPlanTasks(planId) to reload plan state."
      );
    }
  }
} satisfies Plugin;
