import type { Composer } from 'grammy';
import {
  type BotContext,
  clearPendingCalendarOps,
  getPendingCalendarOps,
} from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';

const getCalendarService = async () => {
  const { googleCalendarService } = await import(
    '../clients/google-calendar.js'
  );
  return googleCalendarService;
};

import logger from '../core/logger.js';
import type { Task } from '../core/types.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { findTaskIdxByName } from '../utils/index.js';

export const registerCalendarAction = (composer: Composer<BotContext>) => {
  composer.callbackQuery(['cal_yes', 'cal_no'], async (ctx) => {
    const action = ctx.match;
    const isYes = action === 'cal_yes';
    const userId = ctx.from!.id;
    const ops = getPendingCalendarOps(userId);

    await ctx.answerCallbackQuery();

    if (!ops || ops.length === 0) {
      await panelReply(ctx, 'Операция календаря больше недоступна.');
      return;
    }
    if (!isYes) {
      clearPendingCalendarOps(userId);
      await panelReply(ctx, 'Изменение календаря отменено.');
      return;
    }

    try {
      const calendarService = await getCalendarService();
      const { metadata, taskData } = await queryTasks();

      if (!metadata.timezone) {
        await panelReply(
          ctx,
          '❌ Timezone not set. Please use /settimezone then click Yes again.',
        );
        return;
      }

      // Process operations
      let successCount = 0;
      let failCount = 0;

      for (const op of ops) {
        try {
          if (op.type === 'add') {
            const taskIdx = findTaskIdxByName(
              taskData.uncompleted,
              op.taskName,
            );
            if (taskIdx === -1) {
              failCount++;
              continue;
            }
            const task = taskData.uncompleted[taskIdx];

            if (!task.date || !task.time) {
              failCount++;
              continue;
            }

            const eventId = await calendarService.createEvent(
              task,
              metadata.timezone,
            );
            if (eventId) {
              task.calendarEventId = eventId;
              successCount++;
            } else {
              failCount++;
            }
          } else if (op.type === 'remove') {
            if (op.calendarEventId) {
              const success = await calendarService.deleteEvent(
                op.calendarEventId,
              );
              if (success) successCount++;
              else failCount++;
            }
          } else if (op.type === 'update') {
            let taskIdx = findTaskIdxByName(taskData.uncompleted, op.taskName);
            let task: Task | undefined;

            if (taskIdx !== -1) {
              task = taskData.uncompleted[taskIdx];
            } else {
              taskIdx = findTaskIdxByName(taskData.completed, op.taskName);
              if (taskIdx !== -1) {
                task = taskData.completed[taskIdx];
              }
            }

            if (!task) {
              failCount++;
              continue;
            }

            if (op.calendarEventId) {
              const eventId = await calendarService.updateEvent(
                op.calendarEventId,
                task,
                metadata.timezone,
              );
              if (eventId) {
                if (eventId !== task.calendarEventId) {
                  task.calendarEventId = eventId;
                }
                successCount++;
              } else {
                failCount++;
              }
            }
          }
        } catch (e) {
          logger.errorWithContext({
            userId,
            op: 'CALENDAR_BATCH_ITEM',
            error: e,
          });
          failCount++;
        }
      }

      // Save once after all ops
      if (successCount > 0) {
        await saveTasks(taskData, metadata);
      }

      await panelReply(
        ctx,
        `✅ Processed ${successCount} calendar operations.` +
          (failCount > 0 ? ` (Failed: ${failCount})` : ''),
      );
    } catch (error) {
      logger.errorWithContext({ userId, op: 'CALENDAR_ACTION', error });
      await panelReply(ctx, '❌ An error occurred.');
    }

    clearPendingCalendarOps(userId);
  });
};
