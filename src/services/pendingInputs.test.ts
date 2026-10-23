import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PendingInputStore } from './pendingInputs.js';

test('pending transcripts survive store restart and are removed after success', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pending-input-'));
  const path = join(directory, 'jobs.json');
  const job = {
    id: 'test',
    owner: 1,
    chat: 1,
    text: 'Купить продукты',
    mode: 'brain' as const,
    expires: Date.now() + 60000,
    next: 0,
    attempts: 0,
  };
  try {
    new PendingInputStore(path).put(job);
    const restarted = new PendingInputStore(path);
    expect(restarted.read()).toEqual([job]);
    restarted.remove(job.id);
    expect(restarted.read()).toEqual([]);
    restarted.put({ ...job, expires: 0 });
    expect(restarted.read()).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
