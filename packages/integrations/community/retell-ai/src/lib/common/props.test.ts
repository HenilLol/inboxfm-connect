import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { agentIdDropdown } from './props';
import * as clientModule from './client';

describe('agentIdDropdown (Issue #477)', () => {
  const mockAuth = {
    props: {
      apiKey: 'retell_api_key',
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /v2/list-agents with query param limit=100 and body channel=voice, parsing envelope response', async () => {
    const apiSpy = vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({
      has_more: false,
      items: [
        {
          agent_id: 'agent_123',
          agent_name: 'Customer Support Bot',
          version: 1,
          is_published: true,
          voice_id: 'voice_1',
        },
      ],
    });

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: mockAuth as never }, {} as never);

    expect(apiSpy).toHaveBeenCalledWith({
      auth: mockAuth,
      method: HttpMethod.POST,
      url: '/v2/list-agents',
      queryParams: { limit: '100' },
      body: {
        filter_criteria: {
          channel: 'voice',
        },
      },
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

  it('falls back gracefully to array response if returned by API', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue([
      {
        agent_id: 'agent_456',
        agent_name: 'Sales Rep',
        version: 2,
        is_published: true,
        voice_id: 'voice_2',
      },
    ] as never);

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: mockAuth as never }, {} as never);

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
    vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({ items: [], has_more: false } as never);

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: mockAuth as never }, {} as never);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'No agents found in your workspace.',
    });
  });

  it('handles API errors gracefully with descriptive placeholder', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockRejectedValue(new Error('Network error'));

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: mockAuth as never }, {} as never);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'Error loading agents: Network error',
    });
  });
});
