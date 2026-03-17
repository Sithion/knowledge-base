import type { KnowledgeSDK } from '@cognistore/sdk';

export const listTagsTool = {
  name: 'listTags',
  description: 'List all unique tags across all knowledge entries.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  handler: async (sdk: KnowledgeSDK) => {
    const tags = await sdk.listTags();
    return JSON.stringify(tags);
  },
};
