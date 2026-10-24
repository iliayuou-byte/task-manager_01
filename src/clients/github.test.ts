import { describe, expect, it } from 'bun:test';
import { getOctokit, saveFileContent } from './github.js';

describe('GitHub task snapshot writes', () => {
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
        saveFileContent('stale tasks', '[bot] test', 3, 'observed-sha'),
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
