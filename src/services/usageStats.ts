import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MiddlewareFn } from 'grammy';
import { z } from 'zod';
import type { BotContext } from '../middlewares/session.js';
import { MENU } from '../views/menuView.js';
import { getKeyboardAction } from './contextKeyboard.js';
import { profileOwner, profileUsers } from './userScope.js';

const rowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().max(160),
  username: z.string().max(80).optional(),
  language: z.string().max(20).optional(),
  first: z.number(),
  last: z.number(),
  actions: z.number(),
  menu: z.number(),
  voice: z.number(),
  saves: z.number(),
  errors: z.number(),
  notified: z.boolean(),
});
type Usage = z.infer<typeof rowSchema>;
const retention = 30 * 24 * 60 * 60_000;

export class UsageStore {
  constructor(private readonly path = 'runtime/usage-stats.json') {}
  read(): Usage[] {
    try {
      const all = z
        .array(rowSchema)
        .parse(JSON.parse(readFileSync(this.path, 'utf8')));
      const current = all.filter((row) => row.last > Date.now() - retention);
      if (current.length !== all.length) this.write(current);
      return current;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return [];
      throw new Error('Usage statistics unavailable');
    }
  }
  update(id: number, change: (row: Usage) => void, initial?: Usage) {
    const rows = this.read();
    let row = rows.find((item) => item.id === id);
    if (!row && initial) {
      row = initial;
      rows.push(row);
    }
    if (!row) return;
    change(row);
    this.write(rows);
  }
  private write(rows: Usage[]) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(rows), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}

const interaction = new AsyncLocalStorage<{
  id: number;
  failed: boolean;
  store: UsageStore;
}>();
export const recordUsageError = () => {
  const state = interaction.getStore();
  if (!state || state.failed) return;
  state.failed = true;
  try {
    state.store.update(state.id, (row) => {
      row.errors++;
    });
  } catch {
    /* Stats must not break the bot. */
  }
};
export const recordUsageSave = () => {
  const state = interaction.getStore();
  if (!state) return;
  try {
    state.store.update(state.id, (row) => {
      row.saves++;
    });
  } catch {
    /* Best effort. */
  }
};

const localTime = (time: number) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Berlin',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(time);

export const usageStatsMiddleware = (
  store = new UsageStore(),
): MiddlewareFn<BotContext> => {
  const initializing = new Map<number, Promise<void>>();
  return async (ctx, next) => {
    const id = ctx.from?.id;
    const owner = profileOwner();
    if (
      !process.env.BOT_OWNER_ID ||
      !id ||
      id === owner ||
      ctx.chat?.type !== 'private' ||
      !profileUsers().includes(id) ||
      (!ctx.message && !ctx.callbackQuery)
    )
      return next();
    try {
      if (!initializing.has(id)) {
        const initialize = async () => {
          let row = store.read().find((item) => item.id === id);
          if (!row) {
            await ctx.reply(
              '🧪 Тестовый режим: владелец получает уведомление о первом использовании. Для проверки бота сохраняются имя, Telegram ID, username и язык приложения (если доступны), время действий, счётчики функций и ошибок. Содержимое задач, сообщений и ГС в статистику не попадает. Статистика хранится на сервере и удаляется после 30 дней без активности.',
            );
            const now = Date.now();
            row = {
              id,
              name: ctx.from!.first_name.slice(0, 160),
              username: ctx.from?.username?.slice(0, 80),
              language: ctx.from?.language_code?.slice(0, 20),
              first: now,
              last: now,
              actions: 0,
              menu: 0,
              voice: 0,
              saves: 0,
              errors: 0,
              notified: false,
            };
            store.update(id, () => {}, row);
          }
          if (!row.notified && owner) {
            await ctx.api.sendMessage(
              owner,
              `🧪 ${row.username ? `@${row.username}` : row.name} начал тестирование\nTelegram ID: ${id}\n${localTime(row.first)} · Europe/Berlin`,
            );
            store.update(id, (item) => {
              item.notified = true;
            });
          }
        };
        const promise = initialize();
        initializing.set(id, promise);
      }
      await initializing.get(id);
    } catch {
      /* The next interaction retries a failed notice without blocking tasks. */
    } finally {
      initializing.delete(id);
    }
    try {
      store.update(id, (row) => {
        row.last = Date.now();
        row.actions++;
        row.name = ctx.from!.first_name.slice(0, 160);
        row.username = ctx.from?.username?.slice(0, 80);
        row.language = ctx.from?.language_code?.slice(0, 20);
        if (ctx.message?.voice) row.voice++;
        const text = ctx.message?.text?.trim();
        if (
          ctx.callbackQuery ||
          (text && getKeyboardAction(ctx.chat!.id, text)) ||
          (text &&
            (Object.values(MENU).some((label) => label === text) ||
              /^\/(?:menu|start)(?:@\w+)?(?:\s|$)/.test(text)))
        )
          row.menu++;
      });
    } catch {
      /* Best effort, never save raw update payloads. */
    }
    return interaction.run({ id, failed: false, store }, async () => {
      try {
        await next();
      } catch (error) {
        recordUsageError();
        throw error;
      }
    });
  };
};

export const usageStatsCommand = async (
  ctx: BotContext,
  store = new UsageStore(),
) => {
  if (ctx.chat?.type !== 'private' || ctx.from?.id !== profileOwner()) {
    await ctx.reply('Статистика доступна только владельцу бота.');
    return;
  }
  const rows = store
    .read()
    .filter(
      (row) => profileUsers().includes(row.id) && row.id !== profileOwner(),
    );
  if (!rows.length) {
    await ctx.reply('🧪 Тестеры пока не пользовались ботом.');
    return;
  }
  for (const row of rows)
    await ctx.reply(
      [
        `🧪 ${row.name}${row.username ? ` · @${row.username}` : ''}`,
        `ID: ${row.id} · язык: ${row.language || 'не указан'}`,
        `Первое действие: ${localTime(row.first)}`,
        `Последнее: ${localTime(row.last)} · Europe/Berlin`,
        `Всего действий: ${row.actions}`,
        `Меню/кнопки: ${row.menu} · ГС: ${row.voice}`,
        `Сохранений списка/настроек: ${row.saves} · взаимодействий с ошибкой: ${row.errors}`,
      ].join('\n'),
    );
};

export const pruneUsageStats = () => {
  if (!process.env.BOT_OWNER_ID) return;
  try {
    new UsageStore().read();
  } catch {
    /* Best effort cleanup. */
  }
};
