import { describe, it, expect, vi } from 'vitest';
import { fetchAllWorkspaceUsers } from './index';

describe('fetchAllWorkspaceUsers', () => {
  it('should fetch single page of users when has_more is false', async () => {
    const mockUsers = [
      { id: 'u1', name: 'Alice', type: 'person' },
      { id: 'u2', name: 'Bob', type: 'person' },
    ];
    const mockNotion = {
      users: {
        list: vi.fn().mockResolvedValue({
          results: mockUsers,
          has_more: false,
          next_cursor: null,
        }),
      },
    };

    const result = await fetchAllWorkspaceUsers(mockNotion as any);
    expect(result).toHaveLength(2);
    expect(result).toEqual(mockUsers);
    expect(mockNotion.users.list).toHaveBeenCalledTimes(1);
    expect(mockNotion.users.list).toHaveBeenCalledWith({
      page_size: 100,
      start_cursor: undefined,
    });
  });

  it('should paginate across multiple pages until has_more is false', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `u-${i}`,
      name: `User ${i}`,
      type: 'person',
    }));
    const page2 = Array.from({ length: 25 }, (_, i) => ({
      id: `u-${100 + i}`,
      name: `User ${100 + i}`,
      type: 'person',
    }));

    const mockNotion = {
      users: {
        list: vi
          .fn()
          .mockResolvedValueOnce({
            results: page1,
            has_more: true,
            next_cursor: 'cursor-page-2',
          })
          .mockResolvedValueOnce({
            results: page2,
            has_more: false,
            next_cursor: null,
          }),
      },
    };

    const result = await fetchAllWorkspaceUsers(mockNotion as any);
    expect(result).toHaveLength(125);
    expect(mockNotion.users.list).toHaveBeenCalledTimes(2);
    expect(mockNotion.users.list).toHaveBeenNthCalledWith(1, {
      page_size: 100,
      start_cursor: undefined,
    });
    expect(mockNotion.users.list).toHaveBeenNthCalledWith(2, {
      page_size: 100,
      start_cursor: 'cursor-page-2',
    });
  });

  it('should stop after reaching MAX_PAGES cap to prevent infinite loops', async () => {
    const mockNotion = {
      users: {
        list: vi.fn().mockResolvedValue({
          results: [{ id: 'user', name: 'Infinite User', type: 'person' }],
          has_more: true,
          next_cursor: 'endless-cursor',
        }),
      },
    };

    const result = await fetchAllWorkspaceUsers(mockNotion as any);
    expect(mockNotion.users.list).toHaveBeenCalledTimes(50);
    expect(result).toHaveLength(50);
  });
});
