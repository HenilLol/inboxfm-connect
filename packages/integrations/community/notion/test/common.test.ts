import { listAllWorkspaceUsers, WorkspaceUser } from '../src/lib/common';

type Page = {
  object: 'list';
  results: WorkspaceUser[];
  has_more: boolean;
  next_cursor: string | null;
};

function buildListUsers(pages: Page[]) {
  const received: { page_size: number; start_cursor?: string }[] = [];
  const cursors = new Map<string | undefined, number>([[undefined, 0]]);
  pages.forEach((page, pageIndex) => {
    if (page.next_cursor !== null) {
      cursors.set(page.next_cursor, pageIndex + 1);
    }
  });
  return {
    received,
    listUsers: async (args: { page_size: number; start_cursor?: string }) => {
      received.push(args);
      const index = cursors.get(args.start_cursor);
      const page = index === undefined ? undefined : pages[index];
      if (page === undefined) {
        throw new Error(`unexpected start_cursor: ${args.start_cursor}`);
      }
      return page;
    },
  };
}

function buildUser(id: string): WorkspaceUser {
  return { id, type: 'person', name: `User ${id}` };
}

describe('listAllWorkspaceUsers (issue #186)', () => {
  it('returns all users across multiple pages', async () => {
    const { listUsers, received } = buildListUsers([
      {
        object: 'list',
        results: [buildUser('1'), buildUser('2')],
        has_more: true,
        next_cursor: 'cursor-1',
      },
      {
        object: 'list',
        results: [buildUser('3')],
        has_more: false,
        next_cursor: null,
      },
    ]);
    const users = await listAllWorkspaceUsers({ listUsers });
    expect(users.map((user) => user.id)).toEqual(['1', '2', '3']);
    expect(received).toHaveLength(2);
    expect(received[1]?.start_cursor).toBe('cursor-1');
  });

  it('returns a single page without further requests', async () => {
    const { listUsers, received } = buildListUsers([
      {
        object: 'list',
        results: [buildUser('1')],
        has_more: false,
        next_cursor: null,
      },
    ]);
    const users = await listAllWorkspaceUsers({ listUsers });
    expect(users.map((user) => user.id)).toEqual(['1']);
    expect(received).toHaveLength(1);
  });

  it('returns an empty list when the workspace has no users', async () => {
    const { listUsers } = buildListUsers([
      { object: 'list', results: [], has_more: false, next_cursor: null },
    ]);
    await expect(listAllWorkspaceUsers({ listUsers })).resolves.toEqual([]);
  });
});
