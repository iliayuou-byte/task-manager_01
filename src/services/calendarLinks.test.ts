import { describe, expect, it } from 'bun:test';
import { TaskRevisionConflictError } from '../core/error.js';
import type { TaskData } from '../core/types.js';
import {
  CalendarLinkSaveError,
  persistCalendarLinks,
} from './calendarLinks.js';

describe('Calendar event link reconciliation', () => {
  it('retries only the mapping against fresh task data without losing concurrent edits', async () => {
    let data: TaskData = {
      uncompleted: [
        {
          id: 'a',
          name: 'Renamed',
          date: '2026-10-25',
          completed: false,
          tags: [],
        },
      ],
      completed: [],
    };
    let revision = 2;
    let writes = 0;
    const query = async () => ({
      taskData: structuredClone(data),
      metadata: {
        timezone: 'Europe/Berlin',
        storage_revision: String(revision),
      },
    });
    await persistCalendarLinks(
      [{ taskId: 'a', taskName: 'Old name', eventId: 'created-event' }],
      query,
      async (next, metadata) => {
        writes++;
        if (writes === 1) {
          data.uncompleted.push({
            id: 'b',
            name: 'Concurrent addition',
            completed: false,
            tags: [],
          });
          revision++;
          throw new TaskRevisionConflictError();
        }
        expect(metadata.storage_revision).toBe('3');
        data = structuredClone(next);
        return true;
      },
    );
    expect(data.uncompleted[0].name).toBe('Renamed');
    expect(data.uncompleted[0].date).toBe('2026-10-25');
    expect(data.uncompleted[0].calendarEventId).toBe('created-event');
    expect(data.uncompleted[1].name).toBe('Concurrent addition');
    expect(writes).toBe(2);
  });
  it('retains recovery identifiers if a task was removed instead of silently losing the event', async () => {
    const link = {
      taskId: 'removed',
      taskName: 'Meeting',
      eventId: 'recover-this-event',
    };
    try {
      await persistCalendarLinks(
        [link],
        async () => ({
          taskData: { uncompleted: [], completed: [] },
          metadata: { timezone: 'Europe/Berlin' },
        }),
        async () => {
          throw new Error('must not write');
        },
      );
      throw new Error('must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarLinkSaveError);
      expect(error instanceof CalendarLinkSaveError && error.links).toEqual([
        link,
      ]);
      expect(error instanceof Error && error.message).toContain(
        'recover-this-event',
      );
    }
  });
});
