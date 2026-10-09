import { autoChatAction } from '@grammyjs/auto-chat-action';
import { Bot, Composer } from 'grammy';
import { registerCalendarAction } from './actions/calendar.js';
import { registerSortAction } from './actions/sort.js';
import { registerTaskPickerAction } from './actions/taskPicker.js';
import { aboutCommand } from './commands/about.js';
import { addCommand, addSceneComposer } from './commands/add.js';
import { registerAiSettings } from './commands/aiSettings.js';
import { registerAssistant } from './commands/assistant.js';
import { brainCommand, registerBrainActions } from './commands/brain.js';
import { clearCompletedCommand } from './commands/clearCompleted.js';
import { completeCommand } from './commands/complete.js';
import { registerDayPlanner } from './commands/day.js';
import { editCommand } from './commands/edit.js';
import { listCommand } from './commands/list.js';
import { menuCommand, registerMenu } from './commands/menu.js';
import { nowCommand } from './commands/now.js';
import { quadrantCommand } from './commands/quadrant.js';
import { remindersCommand } from './commands/reminders.js';
import { removeCommand } from './commands/remove.js';
import {
  registerSelectedRemoval,
  removeByNumbers,
} from './commands/removeSelected.js';
import { searchCommand } from './commands/search.js';
import { sortCommand } from './commands/sort.js';
import {
  applyTimezone,
  myTimezoneCommand,
  setTimezoneCommand,
} from './commands/timezone.js';
import { todayCommand } from './commands/today.js';
import { voiceMessage } from './commands/voice.js';
import { whatsnewCommand } from './commands/whatsnew.js';
import { Command, IS_PROD } from './core/config.js';
import logger from './core/logger.js';
import { allowlist } from './middlewares/allowlist.js';
import { type BotContext, sessionMiddleware } from './middlewares/session.js';
import { editSceneComposer, enterEditScene } from './scenes/editTaskScene.js';
import { panelReply } from './services/chatPanel.js';
import { registerContextKeyboard } from './services/contextKeyboard.js';
import { registerPendingInputs } from './services/pendingInputs.js';
import {
  usageStatsCommand,
  usageStatsMiddleware,
} from './services/usageStats.js';
import { profileOwner, runForUser } from './services/userScope.js';
import { START_WORDING } from './views/generalView.js';
import { mainKeyboard } from './views/menuView.js';

profileOwner();
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

opComposer.use(allowlist);
opComposer.use(async (ctx, next) => {
  if (process.env.BOT_OWNER_ID && ctx.chat?.type !== 'private') {
    await ctx.reply('Профили доступны только в личном чате с ботом.');
    return;
  }
  if (!ctx.from) return;
  return runForUser(ctx.from.id, next);
});
opComposer.use(async (ctx, next) => {
  if (
    (ctx.message?.text?.startsWith('/') &&
      !/^\/talk(?:@\w+)?(?:\s|$)/.test(ctx.message.text)) ||
    (ctx.callbackQuery?.data &&
      !ctx.callbackQuery.data.startsWith('assistant:'))
  )
    ctx.session.assistant = undefined;
  return next();
});
opComposer.use(usageStatsMiddleware());
opComposer.command('stats', (ctx) => usageStatsCommand(ctx));
registerContextKeyboard(opComposer);
opComposer.command(Command.START, menuCommand);
opComposer.command(Command.MENU, menuCommand);
registerAiSettings(opComposer);
registerDayPlanner(opComposer);
registerMenu(opComposer);
opComposer.use(addSceneComposer);
opComposer.use(editSceneComposer);

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
opComposer.command(Command.BRAIN, brainCommand);
opComposer.command(Command.QUADRANT, quadrantCommand);
opComposer.command(Command.REMINDERS, remindersCommand);
registerPendingInputs(opComposer);
registerBrainActions(opComposer);
registerSelectedRemoval(opComposer);
opComposer.on('message:voice', voiceMessage);
opComposer.on('message:text', async (ctx, next) => {
  const match = ctx.message.text
    .trim()
    .match(/^(?:удали|убери|remove|delete)\s+(\d+(?:[\s,]+\d+)*)[.!]?$/i);
  if (match) {
    ctx.session.assistant = undefined;
    return await removeByNumbers(ctx, match[1]);
  }
  return next();
});
opComposer.command(Command.SORT, sortCommand);
opComposer.command(Command.SEARCH, searchCommand);

// Actions registered on opComposer (behind allowlist)
registerSortAction(opComposer);
registerCalendarAction(opComposer);
registerTaskPickerAction(opComposer);
registerAssistant(opComposer);

opComposer.callbackQuery(/^tz_(.+)$/, async (ctx) => {
  const value = ctx.match[1];
  await ctx.answerCallbackQuery();
  if (value === 'cancel') {
    await panelReply(ctx, '❌ Timezone selection cancelled.');
    return;
  }
  await panelReply(ctx, `Setting timezone to ${value}...`);
  await applyTimezone(ctx, value);
});

bot.use(infoComposer, opComposer);

bot.on('message:text', (ctx) => {
  panelReply(ctx, 'Выбери действие кнопками или отправь ГС с делами.', {
    reply_markup: mainKeyboard(),
  }).catch((error) => {
    logger.errorWithContext({
      userId: ctx.from?.id,
      op: 'BOT_REPLY',
      error,
    });
  });
});

logger.debugWithContext({ message: START_WORDING });

export default bot;
