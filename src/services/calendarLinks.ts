import { TaskRevisionConflictError } from '../core/error.js';
import { queryTasks } from './queryTasks.js';
import { saveTasks } from './saveTasks.js';

export interface CalendarLink {
  taskId?: string;
  taskName: string;
  eventId: string;
}

export class CalendarLinkSaveError extends Error {
  constructor(readonly links: CalendarLink[]) {
    super(
      `События обработаны, но связь с задачами не сохранена. Не создавай их повторно. Сохрани ID для восстановления:\n${links.map((link) => `${link.taskName}: ${link.eventId}`).join('\n')}`,
    );
    this.name = 'CalendarLinkSaveError';
  }
}

export const persistCalendarLinks = async (
  links: CalendarLink[],
  query = queryTasks,
  save = saveTasks,
) => {
  if (!links.length) return;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { metadata, taskData } = await query();
      let changed = false;
      for (const link of links) {
        const task = [...taskData.uncompleted, ...taskData.completed].find(
          (task) =>
            link.taskId ? task.id === link.taskId : task.name === link.taskName,
        );
        if (
          !task ||
          (task.calendarEventId && task.calendarEventId !== link.eventId)
        )
          throw new CalendarLinkSaveError(links);
        if (task.calendarEventId !== link.eventId) {
          task.calendarEventId = link.eventId;
          changed = true;
        }
      }
      if (!changed) return;
      try {
        if (!(await save(taskData, metadata)))
          throw new CalendarLinkSaveError(links);
        return;
      } catch (error) {
        if (!(error instanceof TaskRevisionConflictError) || attempt === 2)
          throw error;
      }
    }
  } catch {
    throw new CalendarLinkSaveError(links);
  }
};
