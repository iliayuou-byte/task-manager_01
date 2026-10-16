import { randomUUID } from 'node:crypto';
import { type Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../middlewares/session.js';

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
  const keyboard = new InlineKeyboard();
  const buttons = rows.flat().filter((button) => button.callback_data);
  const footer = buttons.filter((button) =>
    /^(?:⬅️ )?Назад$|^(?:🏠 )?Меню$|^◀|^▶|^Next|^✏️ Ввести HH:MM$/.test(
      button.text,
    ),
  );
  const actions = buttons.filter((button) => !footer.includes(button));
  let visible = actions;
  if (screen && actions.length > 8) {
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
      Math.ceil(actions.length / 8) - 1,
    );
    visible = actions.slice(page * 8, page * 8 + 8);
    if (page > 0)
      footer.unshift({ text: '◀️', callback_data: `kbd:${id}:${page - 1}` });
    if ((page + 1) * 8 < actions.length)
      footer.unshift({ text: '▶️', callback_data: `kbd:${id}:${page + 1}` });
  }
  const occurrences = new Map<string, number>();
  const displayed = [...visible, ...footer];
  displayed.forEach((button, index) => {
    const base = button.text.length > 26 ? `${button.text.slice(0, 25)}…` : button.text;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const label =
      displayed.filter((item) => item.text.slice(0, 26) === base).length > 1
        ? `${base} (${occurrence})`
        : base;
    keyboard.text(label, button.callback_data!);
    if (index % 2 === 1) keyboard.row();
  });
  if (displayed.length % 2) keyboard.row();
  return { keyboard };
};

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
  });
};
