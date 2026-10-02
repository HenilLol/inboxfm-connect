import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { agentIdDropdown } from './props';
import * as clientModule from './client';

describe('agentIdDropdown (Issue #477)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /v2/list-agents with limit 100 and parses array response', async () => {
    const apiSpy = vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue([
      {
        agent_id: 'agent_123',
        agent_name: 'Customer Support Bot',
        version: 1,
        is_published: true,
        voice_id: 'voice_1',
      },
    ]);

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: 'retell_api_key' as never }, {} as never);

    expect(apiSpy).toHaveBeenCalledWith({
      auth: 'retell_api_key',
      method: HttpMethod.POST,
      url: '/v2/list-agents',
      body: { limit: 100 },
    });

    expect(result).toEqual({
      disabled: false,
      options: [
        {
          label: 'Customer Support Bot (agent_123)',
          value: 'agent_123',
        },
      ],
    });
  });

  it('parses { items: [...] } response format from v2 list-agents endpoint', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({
      items: [
        {
          agent_id: 'agent_456',
          agent_name: 'Sales Rep',
          version: 2,
          is_published: true,
          voice_id: 'voice_2',
        },
      ],
    } as never);

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: 'retell_api_key' as never }, {} as never);

    expect(result).toEqual({
      disabled: false,
      options: [
        {
          label: 'Sales Rep (agent_456)',
          value: 'agent_456',
        },
      ],
    });
  });

  it('returns placeholder when no agents found', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({ items: [] } as never);

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: 'retell_api_key' as never }, {} as never);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'No agents found in your workspace.',
    });
  });

  it('handles API errors gracefully with descriptive placeholder', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockRejectedValue(new Error('Network error'));

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: 'retell_api_key' as never }, {} as never);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'Error loading agents: Network error',
    });
  });
});
