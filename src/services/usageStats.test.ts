import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotContext } from '../middlewares/session.js';
import { MENU } from '../views/menuView.js';
import {
  recordUsageError,
  recordUsageSave,
  UsageStore,
  usageStatsCommand,
  usageStatsMiddleware,
} from './usageStats.js';

let directory: string;
let path: string;
let previous: Array<string | undefined>;
const keys = [
  'BOT_OWNER_ID',
  'TELEGRAM_BOT_ALLOWLIST',
  'STORAGE_PROVIDER',
] as const;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'usage-stats-'));
  path = join(directory, 'stats.json');
  previous = keys.map((key) => process.env[key]);
  process.env.BOT_OWNER_ID = '111';
  process.env.TELEGRAM_BOT_ALLOWLIST = '111,222,333';
  process.env.STORAGE_PROVIDER = 'github';
});
afterEach(() => {
  keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key];
    else process.env[key] = previous[i];
  });
  rmSync(directory, { recursive: true, force: true });
});

const fixture = (id = 222) => {
  const replies: string[] = [];
  const notifications: Array<{ id: number; text: string }> = [];
  const ctx = {
    from: {
      id,
      first_name: 'Tester',
      username: 'test_user',
      language_code: 'ru',
    },
    chat: { id, type: 'private' },
    message: { text: '/start' },
    reply: async (text: string) => {
      replies.push(text);
    },
    api: {
      sendMessage: async (id: number, text: string) => {
        notifications.push({ id, text });
      },
    },
  } as unknown as BotContext;
  return { ctx, replies, notifications };
};

test('first interaction is disclosed and notified once across restarts, aggregates exclude raw content', async () => {
  const store = new UsageStore(path);
  const f = fixture();
  let middleware = usageStatsMiddleware(store);
  await middleware(f.ctx, async () => {
    expect(f.replies[0]).toContain('Тестовый режим');
    expect(f.notifications[0].id).toBe(111);
    recordUsageSave();
    recordUsageError();
    recordUsageError();
  });
  middleware = usageStatsMiddleware(new UsageStore(path));
  await middleware(f.ctx, async () => {});
  const voice = {
    ...f.ctx,
    message: {
      voice: { file_id: 'SECRET_AUDIO_ID' },
      text: 'SECRET_TASK_AND_MESSAGE',
    },
  } as unknown as BotContext;
  await middleware(voice, async () => {});
  const menu = {
    ...f.ctx,
    message: { text: MENU.settings },
  } as unknown as BotContext;
  await middleware(menu, async () => {});
  const row = store.read()[0];
  expect(row).toMatchObject({
    id: 222,
    actions: 4,
    menu: 3,
    voice: 1,
    saves: 1,
    errors: 1,
    notified: true,
  });
  expect(f.notifications).toHaveLength(1);
  expect(f.replies).toHaveLength(1);
  const raw = readFileSync(path, 'utf8');
  expect(raw).not.toContain('SECRET');
  expect(raw).not.toContain('/start');
  expect(row.last).toBeGreaterThanOrEqual(row.first);
});

test('owner-only report, allowlist checks and private-chat checks prevent unauthorized statistics', async () => {
  const store = new UsageStore(path);
  const middleware = usageStatsMiddleware(store);
  const guest = fixture();
  await middleware(guest.ctx, async () => {});
  await usageStatsCommand(guest.ctx, store);
  expect(guest.replies[guest.replies.length - 1]).toContain('только владельцу');
  const owner = fixture(111);
  await middleware(owner.ctx, async () => {});
  await usageStatsCommand(owner.ctx, store);
  expect(owner.replies.join('\n')).toContain('ID: 222');
  expect(owner.replies.join('\n')).toContain('Всего действий: 1');
  const unauthorized = fixture(444);
  await middleware(unauthorized.ctx, async () => {});
  const group = {
    ...guest.ctx,
    chat: { id: -100, type: 'group' },
  } as unknown as BotContext;
  await middleware(group, async () => {});
  await usageStatsCommand(group, store);
  expect(store.read()).toHaveLength(1);
  expect(store.read()[0].actions).toBe(1);
});

test('concurrent testers keep independent counters and escaped errors are counted once', async () => {
  const store = new UsageStore(path);
  const middleware = usageStatsMiddleware(store);
  const first = fixture(222);
  const second = fixture(333);
  const results = await Promise.allSettled([
    middleware(first.ctx, async () => {
      await Promise.resolve();
      recordUsageSave();
      recordUsageError();
      throw new Error('SECRET_ERROR');
    }),
    middleware(second.ctx, async () => {
      await Promise.resolve();
      recordUsageSave();
      recordUsageSave();
    }),
  ]);
  expect(results[0].status).toBe('rejected');
  expect(results[1].status).toBe('fulfilled');
  expect(store.read().find((row) => row.id === 222)).toMatchObject({
    saves: 1,
    errors: 1,
  });
  expect(store.read().find((row) => row.id === 333)).toMatchObject({
    saves: 2,
    errors: 0,
  });
  recordUsageSave();
  recordUsageError();
  expect(store.read().find((row) => row.id === 333)?.errors).toBe(0);
  expect(readFileSync(path, 'utf8')).not.toContain('SECRET_ERROR');
});

test('notification failure does not block tasks and is retried without repeating disclosure', async () => {
  const store = new UsageStore(path);
  const middleware = usageStatsMiddleware(store);
  const f = fixture();
  const send = f.ctx.api.sendMessage;
  f.ctx.api.sendMessage = (async () => {
    throw new Error('offline');
  }) as typeof send;
  let processed = 0;
  await middleware(f.ctx, async () => {
    processed++;
  });
  expect(store.read()[0].notified).toBe(false);
  f.ctx.api.sendMessage = send;
  await middleware(f.ctx, async () => {
    processed++;
  });
  expect(processed).toBe(2);
  expect(f.replies).toHaveLength(1);
  expect(f.notifications).toHaveLength(1);
  expect(store.read()[0].notified).toBe(true);
});

test('inactive entries are actually removed from disk after thirty days', async () => {
  const store = new UsageStore(path);
  const f = fixture();
  await usageStatsMiddleware(store)(f.ctx, async () => {});
  store.update(222, (row) => {
    row.last = Date.now() - 31 * 24 * 60 * 60_000;
  });
  expect(store.read()).toEqual([]);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([]);
});
