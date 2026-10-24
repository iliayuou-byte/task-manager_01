import { describe, expect, it } from 'bun:test';
import { Octokit } from '@octokit/rest';
import { createPersonalState } from './personal.js';
import { GitHubPersonalBackend, PersonalStore } from './personalStore.js';

const info = {
  owner: 'owner',
  repo: 'repo',
  branch: 'main',
  filePath: 'personal-system.json',
};

describe('Private GitHub personal data contract', () => {
  it('rejects an unknown version even when ownership is correct', async () => {
    let wrote = false;
    const store = new PersonalStore(1, {
      read: async () => ({ state: { ...createPersonalState(1), version: 2 } }),
      write: async () => {
        wrote = true;
      },
    });
    await expect(
      store.update((state) => {
        state.reminders.enabled = true;
      }),
    ).rejects.toThrow();
    expect(wrote).toBe(false);
  });

  it('rejects a direct public repository write without sending file contents', async () => {
    const requests: string[] = [];
    const client = new Octokit({
      request: {
        fetch: async (url: string | URL | Request, init?: RequestInit) => {
          requests.push(`${init?.method ?? 'GET'} ${String(url)}`);
          return Response.json({ private: false });
        },
      },
    });
    const backend = new GitHubPersonalBackend(client, info, 1);
    await expect(backend.write(createPersonalState(1))).rejects.toThrow(
      'приватным',
    );
    expect(requests).toEqual(['GET https://api.github.com/repos/owner/repo']);
  });

  it('creates a private missing file after a 404 with disabled sharing/reminders', async () => {
    let body: Record<string, unknown> | undefined;
    const client = new Octokit({
      request: {
        fetch: async (url: string | URL | Request, init?: RequestInit) => {
          if (init?.method === 'PUT') {
            body = JSON.parse(String(init.body)) as Record<string, unknown>;
            return Response.json({ content: { sha: 'new' } }, { status: 201 });
          }
          if (String(url).includes('/contents/'))
            return Response.json({ message: 'Not Found' }, { status: 404 });
          return Response.json({ private: true });
        },
      },
    });
    const store = new PersonalStore(
      1,
      new GitHubPersonalBackend(client, info, 1),
    );
    await store.update((state) => {
      state.reminders.morning = '10:00';
    });
    expect(body?.sha).toBeUndefined();
    const stored = JSON.parse(
      Buffer.from(String(body?.content), 'base64').toString(),
    );
    expect(stored.ownerId).toBe(1);
    expect(stored.reminders.morning).toBe('10:00');
    expect(stored.reminders.enabled).toBe(false);
    expect(stored.coaching.enabled).toBe(false);
  });
});
