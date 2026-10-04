import { autoChatAction } from '@grammyjs/auto-chat-action';
import { Bot, Composer } from 'grammy';
import { registerCalendarAction } from './actions/calendar.js';
import { registerSortAction } from './actions/sort.js';
import { registerTaskPickerAction } from './actions/taskPicker.js';
import { aboutCommand } from './commands/about.js';
import { addCommand, addSceneComposer } from './commands/add.js';
import { clearCompletedCommand } from './commands/clearCompleted.js';
import { completeCommand } from './commands/complete.js';
import { editCommand } from './commands/edit.js';
import { listCommand } from './commands/list.js';
import { nowCommand } from './commands/now.js';
import { removeCommand } from './commands/remove.js';
import { searchCommand } from './commands/search.js';
import { sortCommand } from './commands/sort.js';
import {
  applyTimezone,
  myTimezoneCommand,
  setTimezoneCommand,
} from './commands/timezone.js';
import { todayCommand } from './commands/today.js';
import { whatsnewCommand } from './commands/whatsnew.js';
import { Command, IS_PROD } from './core/config.js';
import logger from './core/logger.js';
import { allowlist } from './middlewares/allowlist.js';
import { type BotContext, sessionMiddleware } from './middlewares/session.js';
import { editSceneComposer, enterEditScene } from './scenes/editTaskScene.js';
import { START_WORDING } from './views/generalView.js';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  logger.errorWithContext({ message: 'TELEGRAM_BOT_TOKEN is required!' });
  process.exit(1);
}

if (!IS_PROD) {
  void import('node:dns').then((dns) => dns.setDefaultResultOrder('ipv4first'));
}

const bot = new Bot<BotContext>(token);

bot.use(sessionMiddleware);
bot.use(autoChatAction());

bot.catch((err) => {
  logger.errorWithContext({
    op: 'GRAMMY',
    error: err.error instanceof Error ? err.error.message : err.error,
  });
});

const infoComposer = new Composer<BotContext>();
infoComposer.command(Command.ABOUT, aboutCommand);
infoComposer.command(Command.WHATSNEW, whatsnewCommand);

export const opComposer = new Composer<BotContext>();

// Scene composers must be mounted before commands for session isolation
opComposer.use(addSceneComposer);
opComposer.use(editSceneComposer);
opComposer.use(allowlist);

opComposer.command(Command.ADD, addCommand);
opComposer.command(Command.LIST, listCommand);
opComposer.command(Command.COMPLETE, completeCommand);
opComposer.command(Command.EDIT, (ctx) => editCommand(ctx, enterEditScene));
opComposer.command(Command.REMOVE, removeCommand);
opComposer.command(Command.CLEARCOMPLETED, clearCompletedCommand);
opComposer.command(Command.SETTIMEZONE, setTimezoneCommand);
opComposer.command(Command.MYTIMEZONE, myTimezoneCommand);
opComposer.command(Command.TODAY, todayCommand);
opComposer.command(Command.NOW, nowCommand);
opComposer.command(Command.SORT, sortCommand);
opComposer.command(Command.SEARCH, searchCommand);

// Actions registered on opComposer (behind allowlist)
registerSortAction(opComposer);
registerCalendarAction(opComposer);
registerTaskPickerAction(opComposer);

opComposer.callbackQuery(/^tz_(.+)$/, async (ctx) => {
  const value = ctx.match[1];
  await ctx.answerCallbackQuery();
  if (value === 'cancel') {
    await ctx.editMessageText('❌ Timezone selection cancelled.');
    return;
  }
  await ctx.editMessageText(`Setting timezone to ${value}...`);
  await applyTimezone(ctx, value);
});

bot.use(infoComposer, opComposer);

bot.on('message:text', (ctx) => {
  ctx.reply(START_WORDING, { parse_mode: 'MarkdownV2' }).catch((error) => {
    logger.errorWithContext({
      userId: ctx.from?.id,
      op: 'BOT_REPLY',
      error,
    });
  });
});

logger.debugWithContext({ message: START_WORDING });

export default bot;
