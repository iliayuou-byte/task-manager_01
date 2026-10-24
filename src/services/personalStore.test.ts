import { describe, expect, it } from 'bun:test';
import { Octokit } from '@octokit/rest';
import { createPersonalState, type PersonalState } from './personal.js';
import {
  GitHubPersonalBackend,
  type PersonalBackend,
  PersonalStore,
} from './personalStore.js';

describe('Personal state persistence', () => {
  it('reapplies an update to fresh state after a concurrent write', async () => {
    let saved = createPersonalState(1);
    let revision = 0;
    let conflict = true;
    const backend: PersonalBackend = {
      read: async () => ({
        state: structuredClone(saved),
        revision: String(revision),
      }),
      write: async (state, expected) => {
        if (conflict) {
          conflict = false;
          saved.reminders.evening = '20:00';
          revision++;
          throw Object.assign(new Error('Conflict'), { status: 409 });
        }
        expect(expected).toBe(String(revision));
        saved = structuredClone(state);
        revision++;
      },
    };
    const store = new PersonalStore(1, backend);
    await store.update((state) => {
      state.reminders.morning = '08:30';
    });
    expect(saved.reminders.morning).toBe('08:30');
    expect(saved.reminders.evening).toBe('20:00');
  });

  it('rejects another owner and unknown schema versions before writing', async () => {
    let writes = 0;
    const backend: PersonalBackend = {
      read: async () => ({
        state: { ...createPersonalState(2), version: 9 },
        revision: '1',
      }),
      write: async () => {
        writes++;
      },
    };
    const store = new PersonalStore(1, backend);
    await expect(store.update(() => {})).rejects.toThrow();
    expect(writes).toBe(0);
    backend.read = async () => ({
      state: createPersonalState(2),
      revision: '1',
    });
    await expect(store.read()).rejects.toThrow('владельцу');
  });

  it('refuses a public repository before reading or writing personal data', async () => {
    const requests: string[] = [];
    const client = new Octokit({
      request: {
        fetch: async (url: string | URL | Request) => {
          requests.push(String(url));
          return new Response(JSON.stringify({ private: false }), {
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    });
    const backend = new GitHubPersonalBackend(
      client,
      {
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
        filePath: 'personal-system.json',
      },
      1,
    );
    await expect(backend.read()).rejects.toThrow('приватным');
    expect(requests).toHaveLength(1);
  });

  it('creates a missing state file with consent and reminders off', async () => {
    let stored: PersonalState | undefined;
    const backend: PersonalBackend = {
      read: async () => ({ state: stored ?? createPersonalState(1) }),
      write: async (state) => {
        stored = structuredClone(state);
      },
    };
    const store = new PersonalStore(1, backend);
    await store.update((state) => {
      state.reminders.morning = '10:00';
    });
    expect(stored?.coaching.enabled).toBe(false);
    expect(stored?.reminders.enabled).toBe(false);
  });
});
