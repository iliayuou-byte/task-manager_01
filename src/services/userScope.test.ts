import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import type { Bot } from 'grammy';
import { getGitHubFileInfo } from '../clients/github.js';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { checkReminders } from './reminders.js';
import { GitHubStorageProvider } from './storage/GitHubStorageProvider.js';
import { canUseOwnerCalendar, profileOwner, runForUser } from './userScope.js';

const keys = [
  'BOT_OWNER_ID',
  'TELEGRAM_BOT_ALLOWLIST',
  'FILE_PATH',
  'STORAGE_PROVIDER',
] as const;
let original: Array<string | undefined>;
beforeEach(() => {
  original = keys.map((key) => process.env[key]);
  process.env.BOT_OWNER_ID = '111';
  process.env.TELEGRAM_BOT_ALLOWLIST = '222,111';
  process.env.STORAGE_PROVIDER = 'github';
  process.env.FILE_PATH =
    'https://github.com/example/data/blob/main/tasks/task-table.md';
});
afterEach(() => {
  keys.forEach((key, i) => {
    if (original[i] === undefined) delete process.env[key];
    else process.env[key] = original[i];
  });
});

test('concurrent users retain separate storage paths across asynchronous work', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = runForUser(111, async () => {
    const before = getGitHubFileInfo().filePath;
    await gate;
    return [before, getGitHubFileInfo().filePath, canUseOwnerCalendar()];
  });
  const guest = runForUser(222, async () => {
    await Promise.resolve();
    const path = getGitHubFileInfo().filePath;
    release();
    return [path, canUseOwnerCalendar()];
  });
  expect(await owner).toEqual([
    'tasks/task-table.md',
    'tasks/task-table.md',
    true,
  ]);
  expect(await guest).toEqual(['tasks/users/222.md', false]);
  expect(() => getGitHubFileInfo()).toThrow('scope is missing');
  expect(() => runForUser(333, getGitHubFileInfo)).toThrow('not allowed');
});

test('explicit owner survives allowlist reorder and invalid configurations fail closed', () => {
  expect(profileOwner()).toBe(111);
  delete process.env.BOT_OWNER_ID;
  expect(profileOwner).toThrow('Set BOT_OWNER_ID');
  process.env.TELEGRAM_BOT_ALLOWLIST = '111';
  expect(getGitHubFileInfo().filePath).toBe('tasks/task-table.md');
  process.env.BOT_OWNER_ID = '333';
  expect(profileOwner).toThrow('in the allowlist');
  process.env.BOT_OWNER_ID = '111';
  process.env.STORAGE_PROVIDER = 'notion';
  expect(profileOwner).toThrow('require GitHub');
});

test('reminders route each user own tasks and last-sent settings, even if another user fails', async () => {
  const data = new Map<string, { taskData: TaskData; metadata: Metadata }>([
    [
      'tasks/task-table.md',
      {
        taskData: {
          completed: [],
          uncompleted: [{ name: 'Owner only', completed: false, tags: [] }],
        },
        metadata: { timezone: 'UTC', reminder_times: '09:00' },
      },
    ],
    [
      'tasks/users/222.md',
      {
        taskData: {
          completed: [],
          uncompleted: [{ name: 'Guest only', completed: false, tags: [] }],
        },
        metadata: { timezone: 'UTC', reminder_times: '09:00' },
      },
    ],
  ]);
  const query = spyOn(
    GitHubStorageProvider.prototype,
    'queryTasks',
  ).mockImplementation(async () =>
    structuredClone(data.get(getGitHubFileInfo().filePath)!),
  );
  const save = spyOn(
    GitHubStorageProvider.prototype,
    'saveTasks',
  ).mockImplementation(async (taskData, metadata) => {
    data.set(
      getGitHubFileInfo().filePath,
      structuredClone({ taskData, metadata }),
    );
    return true;
  });
  const messages: Array<{ id: number; text: string }> = [];
  let failGuest = false;
  const bot = {
    api: {
      sendMessage: async (id: number, text: string) => {
        if (failGuest && id === 222) throw new Error('Blocked');
        messages.push({ id, text });
      },
    },
  } as unknown as Bot<BotContext>;
  try {
    await checkReminders(bot, new Date('2026-10-06T09:02:00Z'));
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.id === 111)?.text).toContain('Owner only');
    expect(messages.find((m) => m.id === 111)?.text).not.toContain(
      'Guest only',
    );
    expect(messages.find((m) => m.id === 222)?.text).toContain('Guest only');
    expect(data.get('tasks/users/222.md')?.metadata.reminder_last_sent).toBe(
      '2026-10-06T09:00',
    );
    await checkReminders(bot, new Date('2026-10-06T09:03:00Z'));
    expect(messages).toHaveLength(2);
    failGuest = true;
    await checkReminders(bot, new Date('2026-10-07T09:02:00Z'));
    expect(messages[messages.length - 1]?.id).toBe(111);
    expect(data.get('tasks/task-table.md')?.metadata.reminder_last_sent).toBe(
      '2026-10-07T09:00',
    );
    expect(data.get('tasks/users/222.md')?.metadata.reminder_last_sent).toBe(
      '2026-10-06T09:00',
    );
  } finally {
    query.mockRestore();
    save.mockRestore();
  }
});
