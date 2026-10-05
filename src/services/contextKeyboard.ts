import { randomUUID } from 'node:crypto';
import { type Composer, Context, Keyboard } from 'grammy';
import type { BotContext } from '../middlewares/session.js';

interface Actions {
  callbacks: Map<string, string>;
  expires: number;
}
const screens = new Map<number, Actions>();

type Button = { text: string; callback_data?: string };
type ReplyOptions = Parameters<BotContext['reply']>[1];
interface KeyboardScreen {
  rows: Button[][];
  chat: number;
  text: string;
  options?: ReplyOptions;
  expires: number;
}
const pages = new Map<string, KeyboardScreen>();

export const buildContextKeyboard = (
  rows: Button[][],
  screen?: {
    chat: number;
    text: string;
    options?: ReplyOptions;
    page?: number;
    id?: string;
  },
) => {
  const keyboard = new Keyboard();
  const callbacks = new Map<string, string>();
  const buttons = rows.flat().filter((button) => button.callback_data);
  const footer = buttons.filter((button) =>
    /^(?:⬅️ )?Назад$|^(?:🏠 )?Меню$|^◀|^▶|^Next|^✏️ Ввести HH:MM$/.test(
      button.text,
    ),
  );
  const actions = buttons.filter((button) => !footer.includes(button));
  let visible = actions;
  if (screen && actions.length > 6) {
    for (const [id, cached] of pages)
      if (cached.expires < Date.now()) pages.delete(id);
    const id = screen.id ?? randomUUID().slice(0, 8);
    pages.set(id, {
      rows,
      chat: screen.chat,
      text: screen.text,
      options: screen.options,
      expires: Date.now() + 30 * 60_000,
    });
    const page = Math.min(
      Math.max(0, screen.page ?? 0),
      Math.ceil(actions.length / 6) - 1,
    );
    visible = actions.slice(page * 6, page * 6 + 6);
    if (page > 0)
      footer.unshift({ text: '◀️', callback_data: `kbd:${id}:${page - 1}` });
    if ((page + 1) * 6 < actions.length)
      footer.unshift({ text: '▶️', callback_data: `kbd:${id}:${page + 1}` });
  }
  const targets = new Map<string, Set<string>>();
  const occurrences = new Map<string, number>();
  const labelFor = (button: Button) =>
    button.text.length > 26 ? `${button.text.slice(0, 25)}…` : button.text;
  for (const button of [...visible, ...footer]) {
    const label = labelFor(button);
    const targetsForLabel = targets.get(label) ?? new Set<string>();
    targetsForLabel.add(button.callback_data!);
    targets.set(label, targetsForLabel);
  }
  const add = (button: Button) => {
    const base = labelFor(button);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const label =
      (targets.get(base)?.size ?? 0) > 1 ? `${base} (${occurrence})` : base;
    keyboard.text(label);
    callbacks.set(label, button.callback_data!);
  };
  visible.forEach((button, index) => {
    add(button);
    if (index % 2 === 1) keyboard.row();
  });
  if (visible.length % 2) keyboard.row();
  footer.forEach(add);
  return { keyboard: keyboard.resized().persistent(), callbacks };
};

export const rememberKeyboard = (
  chat: number,
  callbacks: Map<string, string>,
) => {
  for (const [id, screen] of screens)
    if (screen.expires < Date.now()) screens.delete(id);
  screens.set(chat, { callbacks, expires: Date.now() + 30 * 60_000 });
};
export const getKeyboardAction = (
  chat: number,
  label: string,
): string | undefined => {
  const screen = screens.get(chat);
  return screen && screen.expires > Date.now()
    ? screen.callbacks.get(label)
    : undefined;
};

// Reply keyboards send text. Route their current buttons through the same validated
// handlers as inline buttons so confirmations, ownership and stale checks stay shared.
export const registerContextKeyboard = (composer: Composer<BotContext>) => {
  composer.callbackQuery(/^kbd:([^:]+):(\d+)$/, async (ctx) => {
    const screen = pages.get(ctx.match[1]);
    if (
      !screen ||
      screen.chat !== ctx.chat?.id ||
      screen.expires < Date.now()
    ) {
      await ctx.answerCallbackQuery({
        text: 'Меню устарело. Открой раздел заново.',
      });
      return;
    }
    await ctx.answerCallbackQuery();
    const layout = buildContextKeyboard(screen.rows, {
      ...screen,
      page: Number(ctx.match[2]),
      id: ctx.match[1],
    });
    const { panelReply } = await import('./chatPanel.js');
    await panelReply(ctx, screen.text, {
      ...screen.options,
      reply_markup: layout.keyboard,
    });
    rememberKeyboard(screen.chat, layout.callbacks);
  });
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const action = getKeyboardAction(ctx.chat.id, ctx.message.text.trim());
    if (!action) return next();
    const callback = new Context(
      {
        update_id: ctx.update.update_id,
        callback_query: {
          id: `keyboard:${ctx.message.message_id}`,
          from: ctx.from,
          chat_instance: String(ctx.chat.id),
          data: action,
          message: ctx.message,
        },
      },
      ctx.api,
      ctx.me,
    ) as BotContext;
    callback.session = ctx.session;
    callback.answerCallbackQuery = async (options) => {
      const text = typeof options === 'string' ? options : options?.text;
      if (text) await ctx.reply(text);
      return true;
    };
    await composer.middleware()(callback, async () => {});
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
    } catch {
      /* Keyboard tap cleanup is best effort. */
    }
  });
};
