import type { KnowledgeSDK } from '@cognistore/sdk';

export const createPlanTool = {
  name: 'createPlan',
  description: 'Create a new plan in the knowledge base. Plans are the ONLY way to persist implementation plans — never use local files. Automatically sets type=plan and status=draft. Deduplicates automatically against existing plans in the same scope.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Plan title (short, descriptive)' },
      content: { type: 'string', description: 'Full plan content (steps, approach, considerations)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
      scope: { type: 'string', description: 'Scope: "global" or "workspace:<project-name>"' },
      source: { type: 'string', description: 'Source/context of the plan' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Task description' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority (default: medium)' },
          },
          required: ['description'],
        },
        description: 'Tasks for this plan (created inline)',
      },
      relatedKnowledgeIds: { type: 'array', items: { type: 'string' }, description: 'IDs of knowledge entries consulted during planning (creates input relations)' },
    },
    required: ['title', 'content', 'tags', 'scope', 'source'],
  },
  handler: async (sdk: KnowledgeSDK, params: Record<string, unknown>) => {
    const result = await sdk.createPlan({
      title: params.title as string,
      content: params.content as string,
      tags: params.tags as string[],
      scope: params.scope as string,
      source: params.source as string,
      tasks: params.tasks as { description: string; priority?: string }[] | undefined,
      relatedKnowledgeIds: params.relatedKnowledgeIds as string[] | undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};
