import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_TOOL_CATALOG, getAgentFunctionDeclarations } from './agent-profile';

describe('Generic routed tool catalog', () => {
  it('includes the new smart routing tools in the dashboard catalog', () => {
    const keys = DEFAULT_AGENT_TOOL_CATALOG.map((tool) => tool.key);

    expect(keys).toContain('people-memory-search');
    expect(keys).toContain('recent-call-history');
    expect(keys).toContain('service-directory');
    expect(keys).toContain('callback-capture');
    expect(keys).toContain('external-knowledge-search');
  });

  it('declares the new Gemini Live function calls', () => {
    const names = getAgentFunctionDeclarations().map((tool) => tool.name);

    expect(names).toContain('search_people_memory');
    expect(names).toContain('get_recent_call_history');
    expect(names).toContain('lookup_service_directory');
    expect(names).toContain('collect_callback_request');
    expect(names).toContain('search_external_knowledge');
  });
});
