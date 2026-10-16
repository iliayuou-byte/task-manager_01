import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantHistory } from './assistantHistory.js';

test('assistant history survives restart, isolates chats, bounds turns and clears only its owner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-history-'));
  try {
    const path = join(dir, 'history.json');
    const store = new AssistantHistory(path);
    for (let n = 0; n < 8; n++) store.append(1, 1, `input ${n}`, `reply ${n}`);
    store.append(2, 2, 'other', 'other reply');
    expect(new AssistantHistory(path).get(1, 1)).toHaveLength(12);
    expect(store.get(1, 1)[0].content).toBe('input 2');
    expect(store.get(1, 2)).toEqual([]);
    store.clear(1, 1);
    expect(store.get(1, 1)).toEqual([]);
    expect(store.get(2, 2)).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
