import { describe, expect, it } from 'bun:test';
import { getOctokit, saveFileContent } from './github.js';

describe('GitHub task snapshot writes', () => {
  it('uses the returned revision for consecutive saves of the same snapshot', async () => {
    const originalKey = process.env.PROVIDER_API_KEY;
    const originalPath = process.env.FILE_PATH;
    process.env.PROVIDER_API_KEY = 'test-placeholder';
    process.env.FILE_PATH = 'https://github.com/owner/repo/blob/main/tasks.md';
    const client = await getOctokit();
    const revisions: unknown[] = [];
    const response = async (_request: unknown, options: object) => {
      revisions.push('sha' in options ? options.sha : undefined);
      return {
        status: 200,
        url: 'https://api.github.com/repos/owner/repo/contents/tasks.md',
        headers: {},
        data: { content: { sha: `saved-${revisions.length}` } },
      };
    };
    client.hook.wrap('request', response);
    try {
      const snapshot = { storage_revision: 'observed-sha' };
      await saveFileContent('first', '[bot] test', 3, snapshot);
      await saveFileContent('second', '[bot] test', 3, snapshot);
      expect(revisions).toEqual(['observed-sha', 'saved-1']);
      expect(snapshot.storage_revision).toBe('saved-2');
    } finally {
      client.hook.remove('request', response);
      if (originalKey === undefined) delete process.env.PROVIDER_API_KEY;
      else process.env.PROVIDER_API_KEY = originalKey;
      if (originalPath === undefined) delete process.env.FILE_PATH;
      else process.env.FILE_PATH = originalPath;
    }
  });
  it('uses the read revision and refuses stale content without fetching a newer SHA', async () => {
    const originalKey = process.env.PROVIDER_API_KEY;
    const originalPath = process.env.FILE_PATH;
    process.env.PROVIDER_API_KEY = 'test-placeholder';
    process.env.FILE_PATH = 'https://github.com/owner/repo/blob/main/tasks.md';
    const client = await getOctokit();
    const requests: Array<{ method: string; sha: unknown }> = [];
    const intercept = (options: { method: string; sha?: unknown }) => {
      requests.push({ method: options.method, sha: options.sha });
      throw Object.assign(new Error('conflict'), { status: 409 });
    };
    client.hook.before('request', intercept);
    try {
      await expect(
        saveFileContent('stale tasks', '[bot] test', 3, {
          storage_revision: 'observed-sha',
        }),
      ).rejects.toThrow('Tasks changed');
      expect(requests).toEqual([{ method: 'PUT', sha: 'observed-sha' }]);
    } finally {
      client.hook.remove('request', intercept);
      if (originalKey === undefined) delete process.env.PROVIDER_API_KEY;
      else process.env.PROVIDER_API_KEY = originalKey;
      if (originalPath === undefined) delete process.env.FILE_PATH;
      else process.env.FILE_PATH = originalPath;
    }
  });
});
