import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Bot, type Composer, Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import logger from '../core/logger.js';
import type { BotContext } from '../middlewares/session.js';
import { aiFailure } from './aiFailure.js';
import { panelReply } from './chatPanel.js';

const jobSchema = z.object({
  id: z.string(),
  owner: z.number(),
  chat: z.number(),
  text: z.string().max(6000),
  mode: z.enum(['brain', 'remove']),
  expires: z.number(),
  next: z.number(),
  attempts: z.number(),
  voiceId: z.string().optional(),
  messageId: z.number().optional(),
});
type Job = z.infer<typeof jobSchema>;

export class PendingInputStore {
  constructor(private readonly path: string) {}
  read(): Job[] {
    try {
      const jobs = z
        .array(jobSchema)
        .parse(JSON.parse(readFileSync(this.path, 'utf8')));
      const current = jobs.filter((job) => job.expires > Date.now());
      if (current.length !== jobs.length) this.write(current);
      return current;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return [];
      throw new Error('Pending input store unavailable');
    }
  }
  write(jobs: Job[]) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(jobs), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
  put(job: Job) {
    const jobs = this.read().filter((candidate) => candidate.id !== job.id);
    if (jobs.length >= 100) throw new Error('Pending input store full');
    this.write([...jobs, job]);
  }
  remove(id: string) {
    this.write(this.read().filter((job) => job.id !== id));
  }
}
const getStore = () =>
  new PendingInputStore(
    process.env.PENDING_INPUTS_PATH || 'runtime/pending-inputs.json',
  );
const busy = new Set<string>();
const paused = new Set<string>();

export const pausePendingInputs = (ctx: BotContext) => {
  try {
    const jobs = getStore().read();
    for (const job of jobs)
      if (job.owner === ctx.from?.id && job.chat === ctx.chat?.id)
        paused.add(job.id);
    let changed = false;
    for (const job of jobs)
      if (job.owner === ctx.from?.id && job.chat === ctx.chat?.id && job.next) {
        job.next = 0;
        changed = true;
      }
    if (changed) getStore().write(jobs);
  } catch {
    logger.warnWithContext({
      op: 'INPUT_RETRY',
      message: 'Unable to pause pending inputs',
    });
  }
};

const showFailure = async (ctx: BotContext, job: Job, error: unknown) => {
  const failure = aiFailure(error);
  logger.warnWithContext({
    op: 'INPUT_RETRY',
    userId: ctx.from?.id,
    message: failure.diagnostic,
  });
  await panelReply(
    ctx,
    `❌ ${failure.reason}\nТекст сохранён на сервере на 24 часа. ${job.next ? 'Повторю разбор позже; повторно отправлять ГС не нужно.' : 'Автоповторы остановлены. После исправления можно повторить кнопкой или /retry.'}`,
    {
      reply_markup: new InlineKeyboard()
        .text('🔄 Повторить разбор', `input_retry:${job.id}`)
        .row()
        .text('⬅️ Назад', 'menu:home'),
    },
  );
};

export const recoverInput = async (
  ctx: BotContext,
  text: string,
  error: unknown,
  mode: Job['mode'],
) => {
  if (ctx.chat?.type !== 'private' || !ctx.from) throw error;
  const failure = aiFailure(error);
  const job: Job = {
    id: randomUUID().slice(0, 8),
    owner: ctx.from.id,
    chat: ctx.chat.id,
    text,
    mode,
    expires: Date.now() + 24 * 60 * 60_000,
    attempts: 0,
    next: failure.temporary ? Date.now() + failure.delay : 0,
    voiceId: ctx.message?.voice?.file_id,
    messageId: ctx.message?.message_id,
  };
  try {
    getStore().put(job);
  } catch {
    await panelReply(
      ctx,
      '❌ Не удалось разобрать и сохранить текст для повтора. Исходное сообщение осталось в чате. Проверь доступ к папке runtime.',
    );
    return;
  }
  await showFailure(ctx, job, error);
};

const runJob = async (ctx: BotContext, job: Job) => {
  if (busy.has(job.id)) return;
  busy.add(job.id);
  paused.delete(job.id);
  job.next = 0;
  job.attempts++;
  try {
    getStore().put(job);
    if (job.mode === 'brain') {
      const { processBrainInput } = await import('../commands/brain.js');
      await processBrainInput(ctx, job.text, true, () => !paused.has(job.id));
    } else {
      const { removeByVoice } = await import('../commands/removeSelected.js');
      await removeByVoice(ctx, job.text, true, () => !paused.has(job.id));
    }
    if (!paused.has(job.id)) getStore().remove(job.id);
  } catch (error) {
    const failure = aiFailure(error);
    job.next =
      failure.temporary && job.attempts < 2 && !paused.has(job.id)
        ? Date.now() + Math.max(failure.delay, job.attempts * 60_000)
        : 0;
    getStore().put(job);
    await showFailure(ctx, job, error);
  } finally {
    busy.delete(job.id);
  }
};

export const registerPendingInputs = (composer: Composer<BotContext>) => {
  composer.callbackQuery(/^input_retry:(.+)$/, async (ctx) => {
    const job = getStore()
      .read()
      .find(
        (candidate) =>
          candidate.id === ctx.match[1] &&
          candidate.owner === ctx.from.id &&
          candidate.chat === ctx.chat?.id,
      );
    if (!job || busy.has(job.id)) {
      await ctx.answerCallbackQuery({
        text: 'Повтор недоступен или уже идёт.',
      });
      return;
    }
    await ctx.answerCallbackQuery();
    job.attempts = 0;
    await runJob(ctx, job);
  });
  composer.command('retry', async (ctx) => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return;
    const jobs = getStore()
      .read()
      .filter((job) => job.owner === ctx.from!.id && job.chat === ctx.chat.id);
    if (!jobs.length)
      return await panelReply(ctx, 'Нет сохранённых текстов для повтора.');
    const keyboard = new InlineKeyboard();
    jobs.forEach((job, index) => {
      keyboard
        .text(`${index + 1}. ${job.text.slice(0, 30)}`, `input_retry:${job.id}`)
        .row();
    });
    await panelReply(
      ctx,
      'Выбери сохранённый текст. Повтор создаёт только черновик — дела не сохраняются и не удаляются без подтверждения.',
      { reply_markup: keyboard },
    );
  });
};

let retryTickRunning = false;
export const retryPendingInputsOnce = async (bot: Bot<BotContext>) => {
  if (retryTickRunning) return;
  retryTickRunning = true;
  try {
    const allowlist = (process.env.TELEGRAM_BOT_ALLOWLIST ?? '')
      .split(',')
      .map((id) => id.trim());
    for (const job of getStore()
      .read()
      .filter(
        (candidate) => candidate.next > 0 && candidate.next <= Date.now(),
      )) {
      if (!allowlist.includes(String(job.owner))) continue;
      const ctx = new Context(
        {
          update_id: 0,
          message: {
            message_id: job.messageId ?? 0,
            date: Math.floor(Date.now() / 1000),
            chat: { id: job.chat, type: 'private', first_name: 'User' },
            from: { id: job.owner, is_bot: false, first_name: 'User' },
            ...(job.voiceId
              ? {
                  voice: {
                    file_id: job.voiceId,
                    file_unique_id: 'retry',
                    duration: 0,
                  },
                }
              : { text: job.text }),
          },
        },
        bot.api,
        bot.botInfo,
      ) as BotContext;
      ctx.session = {};
      await runJob(ctx, job);
    }
  } catch {
    logger.warnWithContext({
      op: 'INPUT_RETRY',
      message: 'Pending input retry failed',
    });
  } finally {
    retryTickRunning = false;
  }
};
export const startInputRetryLoop = (bot: Bot<BotContext>) => {
  const timer = setInterval(() => {
    void retryPendingInputsOnce(bot);
  }, 15_000);
  return () => clearInterval(timer);
};
