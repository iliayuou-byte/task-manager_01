import { randomUUID } from 'node:crypto';
import { fromZonedTime } from 'date-fns-tz';
import { Composer } from 'grammy';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import {
  type Area,
  areaOf,
  type DayPlan,
  dayFor,
  MORNING_START_ITEMS,
  type PersonalState,
  shiftDate,
} from '../services/personal.js';
import { buildPersonalDashboard } from '../services/personalDashboard.js';
import type { PersonalStore } from '../services/personalStore.js';
import { taskFingerprint } from '../services/taskNumbers.js';
import { markTaskCompleted } from '../utils/index.js';
import { MENU, navigationKeyboard } from '../views/menuView.js';
import {
  PERSONAL_BUTTON_TEXT,
  PERSONAL_TIME_LABELS,
  personalCapturePrompt,
  personalChecklistKeyboard,
  personalChecklistMessage,
  personalDayModeKeyboard,
  personalHomeKeyboard,
  personalHomeMessage,
  personalMoreKeyboard,
  personalReviewConfirmKeyboard,
  personalReviewConfirmMessage,
  personalReviewEnergyKeyboard,
  personalReviewEntryMessage,
  personalRoutineConfirmKeyboard,
  personalRoutineMessage,
  personalSettingsKeyboard,
  personalSettingsMessage,
  personalTasksKeyboard,
  personalTasksMessage,
  personalTimePickerKeyboard,
  personalTimePickerMessage,
} from '../views/personalButtonsView.js';
import { personalNavigation } from '../views/personalView.js';
import { clearMenuInput } from './menu.js';

export interface PersonalSnapshot {
  store: PersonalStore;
  state: PersonalState;
  metadata: Metadata;
  taskData: TaskData;
  timezone: string;
  date: string;
  now: Date;
}
type Handler = (ctx: BotContext) => Promise<unknown>;
interface Dependencies {
  guard(handler: Handler): Handler;
  canManage(ctx: BotContext): boolean;
  load(ids?: boolean): Promise<PersonalSnapshot>;
  save(tasks: TaskData, metadata: Metadata): Promise<void>;
  capture(
    ctx: BotContext,
    text: string,
    options?: { area?: Area; active?: () => boolean },
  ): Promise<unknown>;
  showPlan(
    ctx: BotContext,
    mode?: DayPlan['mode'],
    morning?: boolean,
  ): Promise<unknown>;
  showFocus(ctx: BotContext): Promise<unknown>;
  showWeek(ctx: BotContext): Promise<unknown>;
  openTask(
    ctx: BotContext,
    id: string,
    active?: () => boolean,
  ): Promise<unknown>;
}
type TimeField = keyof typeof PERSONAL_TIME_LABELS;
type Review = NonNullable<DayPlan['review']>;
type Draft =
  | { kind: 'capture'; area?: Area }
  | { kind: 'step'; date: string }
  | { kind: 'items' }
  | { kind: 'lead' }
  | { kind: 'preset' }
  | { kind: 'time'; field: TimeField; hour?: string; custom?: boolean }
  | {
      kind: 'review';
      date: string;
      stage: 'energy' | 'win' | 'blocker' | 'next' | 'confirm';
      review: Review;
    };
type Flow = Draft & { id: string; expires: number; busy?: boolean };

const render = (
  ctx: BotContext,
  text: string,
  keyboard = personalNavigation(),
  paged = false,
) => panelReply(ctx, text, { reply_markup: keyboard }, { navigation: paged });

const replaceMorningTemplate = (
  state: PersonalState,
  date: string,
  items: string[],
) => {
  const day = dayFor(state, date);
  if (!day.morningItems.length) day.morningItems = [...state.morningItems];
  state.morningItems = [...items];
};

const dashboard = (data: PersonalSnapshot) =>
  buildPersonalDashboard(
    data.state,
    [...data.taskData.uncompleted, ...data.taskData.completed],
    data.metadata,
    data.timezone,
    data.now,
  );

export const createPersonalButtons = (deps: Dependencies) => {
  const composer = new Composer<BotContext>();
  const flows = new Map<number, Flow>();
  const screens = new Map<number, symbol>();
  const cancel = (ctx: BotContext) => {
    if (ctx.from) screens.delete(ctx.from.id);
    if (ctx.from) flows.delete(ctx.from.id);
  };
  const screenRequest = (ctx: BotContext) => {
    const token = Symbol();
    screens.set(ctx.from!.id, token);
    return () => screens.get(ctx.from!.id) === token;
  };
  const current = (ctx: BotContext) => {
    const flow = ctx.from && flows.get(ctx.from.id);
    if (flow && flow.expires <= Date.now()) {
      cancel(ctx);
      return undefined;
    }
    return flow;
  };
  const start = (ctx: BotContext, draft: Draft): Flow => {
    for (const [id, flow] of flows)
      if (flow.expires <= Date.now()) flows.delete(id);
    const flow = {
      ...draft,
      id: randomUUID().slice(0, 8),
      expires: Date.now() + 30 * 60000,
    };
    flows.set(ctx.from!.id, flow);
    return flow;
  };
  const same = (ctx: BotContext, flow: Flow) => current(ctx) === flow;
  const draftBack = (flow: Flow) => navigationKeyboard(`pui:cancel:${flow.id}`);

  const home = async (ctx: BotContext) => {
    cancel(ctx);
    const active = screenRequest(ctx);
    const data = await deps.load();
    if (!active()) return;
    const view = dashboard(data);
    await render(ctx, personalHomeMessage(view), personalHomeKeyboard(view));
  };
  const tasks = async (ctx: BotContext, area?: 'study' | 'gym', page = 0) => {
    const data = await deps.load(true);
    const list = data.taskData.uncompleted.filter(
      (task) => !task.completed && (area ? areaOf(task) === area : !task.date),
    );
    const offset =
      Math.min(Math.max(0, page), Math.max(0, Math.ceil(list.length / 6) - 1)) *
      6;
    await render(
      ctx,
      personalTasksMessage(list, offset, area),
      personalTasksKeyboard(list, offset, area),
    );
  };
  const checklist = async (ctx: BotContext) => {
    const data = await deps.load();
    const state = await data.store.update((state) => {
      const day = dayFor(state, data.date);
      if (!day.morningItems.length) day.morningItems = [...state.morningItems];
    });
    const day = dayFor(state, data.date);
    await render(
      ctx,
      personalChecklistMessage(data.date, day),
      personalChecklistKeyboard(data.date, day),
    );
  };
  const settings = async (ctx: BotContext) => {
    const data = await deps.load();
    const s = data.state.reminders;
    await render(
      ctx,
      personalSettingsMessage(s, data.timezone),
      personalSettingsKeyboard(s),
      true,
    );
  };
  const timePicker = async (ctx: BotContext, flow: Flow & { kind: 'time' }) =>
    render(
      ctx,
      personalTimePickerMessage(flow.field, flow.hour),
      personalTimePickerKeyboard(flow.id, flow.hour),
      true,
    );
  const saveTime = async (
    ctx: BotContext,
    flow: Flow & { kind: 'time' },
    value: string,
  ) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      await ctx.reply(PERSONAL_BUTTON_TEXT.timeFormat);
      return;
    }
    const data = await deps.load();
    if (!same(ctx, flow)) return;
    await data.store.update((state) => {
      if (same(ctx, flow)) state.reminders[flow.field] = value;
    });
    if (!same(ctx, flow)) return;
    cancel(ctx);
    await settings(ctx);
  };
  const reviewPrompt = async (
    ctx: BotContext,
    flow: Flow & { kind: 'review' },
  ) => {
    if (flow.stage === 'energy')
      return render(
        ctx,
        PERSONAL_BUTTON_TEXT.reviewEnergyPrompt,
        personalReviewEnergyKeyboard(flow.id),
      );
    if (flow.stage !== 'confirm')
      return render(
        ctx,
        personalReviewEntryMessage(flow.stage),
        draftBack(flow),
      );
    return render(
      ctx,
      personalReviewConfirmMessage(flow.date, flow.review),
      personalReviewConfirmKeyboard(flow.id),
    );
  };

  composer.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || ctx.chat.id !== ctx.from?.id)
      return next();
    const flow = current(ctx);
    const text = ctx.message?.text?.trim();
    const callback = ctx.callbackQuery?.data;
    if (callback?.startsWith('pui:')) screens.delete(ctx.from!.id);
    if (
      ctx.message?.voice ||
      (text && screens.has(ctx.from!.id)) ||
      text?.startsWith('/') ||
      (text && Object.values(MENU).some((label) => label === text)) ||
      (callback &&
        !callback.startsWith('pui:') &&
        !(callback.startsWith('kbd:') && flow?.kind === 'time' && !flow.custom))
    )
      cancel(ctx);
    return next();
  });
  composer.hears(MENU.personal, deps.guard(home));
  composer
    .filter(deps.canManage)
    .callbackQuery(
      /^menu:(?:wake|wakeinput|wakeearlier|wakelater|wakereset|morning|morningadd|morningedit|morningdelete|morningreset|morningtoggle)(?::.*)?$/,
      (ctx, next) =>
        deps.guard(async (ctx) => {
          const data = await deps.load();
          if (!data.state.reminders.routine) return next();
          clearMenuInput(ctx);
          ctx.session.awaitingAdd = undefined;
          ctx.session.editScene = undefined;
          cancel(ctx);
          await ctx.answerCallbackQuery();
          return settings(ctx);
        })(ctx),
    );
  composer.callbackQuery(
    /^pui:(.+)$/,
    deps.guard(async (ctx) => {
      const [action, value, extra] = ctx.match![1].split(':');
      const navigation = ['home', 'iphone', 'next', 'done'].includes(action)
        ? screenRequest(ctx)
        : undefined;
      await ctx.answerCallbackQuery();
      if (navigation && !navigation()) return;
      const flow = current(ctx);
      if (
        [
          'cancel',
          'energy',
          'confirm',
          'hour',
          'hours',
          'minute',
          'custom',
        ].includes(action)
      ) {
        if (!flow || flow.id !== value)
          return ctx.reply(PERSONAL_BUTTON_TEXT.closedDraft);
        if (action === 'cancel') return home(ctx);
        if (flow.busy) return;
        if (
          action === 'energy' &&
          flow.kind === 'review' &&
          flow.stage === 'energy' &&
          /^[1-5]$/.test(extra ?? '')
        ) {
          flow.review.energy = Number(extra);
          flow.stage = 'win';
          return reviewPrompt(ctx, flow);
        }
        if (action === 'confirm') {
          if (
            flow.kind !== 'preset' &&
            (flow.kind !== 'review' || flow.stage !== 'confirm')
          )
            return;
          flow.busy = true;
          try {
            const data = await deps.load(flow.kind === 'preset');
            if (!same(ctx, flow)) return;
            if (flow.kind === 'review' && flow.date !== data.date) {
              cancel(ctx);
              return ctx.reply(PERSONAL_BUTTON_TEXT.reviewDayChanged);
            }
            await data.store.update((state) => {
              if (!same(ctx, flow)) return;
              if (flow.kind === 'preset') {
                Object.assign(state.reminders, {
                  enabled: true,
                  morning: '08:00',
                  wakeRepeats: true,
                  routine: true,
                  evening: '21:30',
                  bedtime: '00:45',
                  quietStart: '01:00',
                  quietEnd: '08:00',
                });
                replaceMorningTemplate(state, data.date, MORNING_START_ITEMS);
              } else if (flow.kind === 'review')
                dayFor(state, data.date).review = { ...flow.review };
            });
            if (!same(ctx, flow)) return;
            cancel(ctx);
            if (flow.kind === 'preset') return settings(ctx);
            return render(ctx, PERSONAL_BUTTON_TEXT.reviewSaved);
          } finally {
            flow.busy = false;
          }
        }
        if (flow.kind === 'time') {
          if (action === 'custom') {
            flow.custom = true;
            return render(
              ctx,
              PERSONAL_BUTTON_TEXT.customTimePrompt,
              draftBack(flow),
            );
          }
          if (action === 'hours') {
            flow.hour = undefined;
            return timePicker(ctx, flow);
          }
          if (
            action === 'hour' &&
            /^\d{1,2}$/.test(extra ?? '') &&
            Number(extra) < 24
          ) {
            flow.hour = String(Number(extra)).padStart(2, '0');
            return timePicker(ctx, flow);
          }
          if (
            action === 'minute' &&
            flow.hour !== undefined &&
            ['00', '15', '30', '45'].includes(extra)
          ) {
            flow.busy = true;
            try {
              return await saveTime(ctx, flow, `${flow.hour}:${extra}`);
            } finally {
              flow.busy = false;
            }
          }
        }
        return;
      }
      cancel(ctx);
      // Retained Telegram messages can still carry the removed shortcut button.
      if (action === 'home' || action === 'iphone') return home(ctx);
      if (action === 'more')
        return render(
          ctx,
          PERSONAL_BUTTON_TEXT.more,
          personalMoreKeyboard(),
          true,
        );
      if (action === 'next' || action === 'done') {
        const active = screenRequest(ctx);
        const data = await deps.load();
        if (!active()) return;
        const view = dashboard(data);
        const task = view.nextTask;
        if (
          value !== data.date ||
          !task?.id ||
          !/^[a-f0-9]{20}$/.test(extra ?? '') ||
          taskFingerprint(task).slice(0, 20) !== extra
        ) {
          await ctx.reply(PERSONAL_BUTTON_TEXT.changedAction);
          if (active()) return home(ctx);
          return;
        }
        if (action === 'next') return deps.openTask(ctx, task.id, active);
        markTaskCompleted(task, data.timezone);
        await deps.save(data.taskData, data.metadata);
        if (active()) return home(ctx);
        return;
      }
      if (action === 'plan') return deps.showPlan(ctx, undefined, true);
      if (action === 'focus') return deps.showFocus(ctx);
      if (action === 'settings') return settings(ctx);
      if (action === 'week') return deps.showWeek(ctx);
      if (action === 'mode')
        return render(
          ctx,
          PERSONAL_BUTTON_TEXT.dayModePrompt,
          personalDayModeKeyboard(),
        );
      if (action === 'normal' || action === 'late' || action === 'low')
        return deps.showPlan(ctx, action);
      if (action === 'study' || action === 'gym' || action === 'inbox')
        return tasks(ctx, action === 'inbox' ? undefined : action);
      if (
        action === 'list' &&
        ['study', 'gym', 'inbox'].includes(value) &&
        /^\d+$/.test(extra ?? '')
      )
        return tasks(
          ctx,
          value === 'inbox' ? undefined : (value as 'study' | 'gym'),
          Number(extra),
        );
      if (action === 'task' && /^[a-zA-Z0-9-]{1,64}$/.test(value ?? ''))
        return deps.openTask(ctx, value);
      if (action === 'add' && ['study', 'gym', 'inbox'].includes(value)) {
        const draft = start(ctx, {
          kind: 'capture',
          area: value === 'inbox' ? undefined : (value as Area),
        });
        return render(ctx, personalCapturePrompt(value), draftBack(draft));
      }
      if (action === 'step') {
        const draft = start(ctx, { kind: 'step', date: '' });
        draft.busy = true;
        try {
          const data = await deps.load();
          if (!same(ctx, draft) || draft.kind !== 'step') return;
          draft.date = data.date;
          return render(ctx, PERSONAL_BUTTON_TEXT.stepPrompt, draftBack(draft));
        } finally {
          draft.busy = false;
        }
      }
      if (action === 'items') {
        const draft = start(ctx, { kind: 'items' });
        return render(
          ctx,
          PERSONAL_BUTTON_TEXT.morningItemsPrompt,
          draftBack(draft),
        );
      }
      if (action === 'lead') {
        const draft = start(ctx, { kind: 'lead' });
        return render(ctx, PERSONAL_BUTTON_TEXT.leadPrompt, draftBack(draft));
      }
      if (
        action === 'timefield' &&
        Object.hasOwn(PERSONAL_TIME_LABELS, value)
      ) {
        const draft = start(ctx, { kind: 'time', field: value as TimeField });
        if (draft.kind === 'time') return timePicker(ctx, draft);
      }
      if (
        (action === 'enabled' || action === 'repeat') &&
        ['on', 'off'].includes(value)
      ) {
        const data = await deps.load(action === 'enabled' && value === 'on');
        await data.store.update((state) => {
          if (action === 'enabled') state.reminders.enabled = value === 'on';
          else state.reminders.wakeRepeats = value === 'on';
        });
        return settings(ctx);
      }
      if (action === 'preset') {
        const draft = start(ctx, { kind: 'preset' });
        return render(
          ctx,
          personalRoutineMessage(MORNING_START_ITEMS),
          personalRoutineConfirmKeyboard(draft.id),
        );
      }
      if (action === 'evening') {
        const draft = start(ctx, {
          kind: 'review',
          date: '',
          stage: 'energy',
          review: { energy: 0, win: '', blocker: '', next: '' },
        });
        const data = await deps.load();
        if (same(ctx, draft) && draft.kind === 'review') {
          draft.date = data.date;
          return reviewPrompt(ctx, draft);
        }
      }
      if (action === 'awake') {
        const data = await deps.load();
        const wake = fromZonedTime(
          `${value}T${data.state.reminders.morning}:00`,
          data.timezone,
        ).getTime();
        if (
          value !== data.date &&
          !(
            value === shiftDate(data.date, -1) &&
            data.now.getTime() - wake >= 0 &&
            data.now.getTime() - wake < 15 * 60000
          )
        )
          return ctx.reply(PERSONAL_BUTTON_TEXT.oldWakeSignal);
        await data.store.update((state) => {
          dayFor(state, value).awakeAt = data.now.toISOString();
        });
        return checklist(ctx);
      }
      if (action === 'checklist') return checklist(ctx);
      if (
        action === 'check' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
        /^[0-7]$/.test(extra ?? '')
      ) {
        const data = await deps.load();
        if (value !== data.date)
          return ctx.reply(PERSONAL_BUTTON_TEXT.oldChecklist);
        await data.store.update((state) => {
          const day = dayFor(state, data.date);
          const index = Number(extra);
          if (index >= day.morningItems.length) return;
          day.morningDone = day.morningDone.includes(index)
            ? day.morningDone.filter((item) => item !== index)
            : [...day.morningDone, index];
        });
        return checklist(ctx);
      }
    }),
  );

  composer.on('message:text', async (ctx, next) => {
    const flow = current(ctx);
    if (
      !flow ||
      ctx.message.text.startsWith('/') ||
      (flow.kind === 'time' && !flow.custom) ||
      flow.kind === 'preset' ||
      (flow.kind === 'review' && ['energy', 'confirm'].includes(flow.stage))
    )
      return next();
    await deps.guard(async (ctx) => {
      if (flow.busy) return;
      flow.busy = true;
      try {
        const text = ctx.message!.text!.trim();
        if (flow.kind === 'capture') {
          if (!text || text.length > 500)
            return ctx.reply(PERSONAL_BUTTON_TEXT.captureLength);
          await deps.capture(ctx, text, {
            area: flow.area,
            active: () => same(ctx, flow),
          });
          if (same(ctx, flow)) cancel(ctx);
          return;
        }
        if (flow.kind === 'time') return saveTime(ctx, flow, text);
        if (flow.kind === 'review') {
          if (!text || text.length > 400)
            return ctx.reply(PERSONAL_BUTTON_TEXT.reviewLength);
          if (
            flow.stage !== 'win' &&
            flow.stage !== 'blocker' &&
            flow.stage !== 'next'
          )
            return;
          flow.review[flow.stage] = text;
          flow.stage =
            flow.stage === 'win'
              ? 'blocker'
              : flow.stage === 'blocker'
                ? 'next'
                : 'confirm';
          return reviewPrompt(ctx, flow);
        }
        if (flow.kind === 'step' && (!text || text.length > 400))
          return ctx.reply(PERSONAL_BUTTON_TEXT.stepLength);
        const items = text
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean);
        if (
          flow.kind === 'items' &&
          (!items.length ||
            items.length > 8 ||
            items.some((item) => item.length > 60))
        )
          return ctx.reply(PERSONAL_BUTTON_TEXT.morningItemsLength);
        if (
          flow.kind === 'lead' &&
          (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 180)
        )
          return ctx.reply(PERSONAL_BUTTON_TEXT.leadRange);
        const data = await deps.load();
        if (!same(ctx, flow)) return;
        if (flow.kind === 'step' && flow.date !== data.date) {
          cancel(ctx);
          return ctx.reply(PERSONAL_BUTTON_TEXT.stepDayChanged);
        }
        await data.store.update((state) => {
          if (!same(ctx, flow)) return;
          if (flow.kind === 'step') dayFor(state, data.date).firstStep = text;
          if (flow.kind === 'items')
            replaceMorningTemplate(state, data.date, items);
          if (flow.kind === 'lead') state.reminders.leadMinutes = Number(text);
        });
        if (!same(ctx, flow)) return;
        cancel(ctx);
        if (flow.kind === 'step') return deps.showPlan(ctx);
        return settings(ctx);
      } finally {
        flow.busy = false;
      }
    })(ctx);
  });
  return composer;
};
