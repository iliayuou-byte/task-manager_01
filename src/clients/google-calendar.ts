import * as fs from 'node:fs';
import * as path from 'node:path';
import { calendar, type calendar_v3 } from '@googleapis/calendar';
import { fromZonedTime } from 'date-fns-tz';
import { GoogleAuth } from 'google-auth-library';
import { IS_PROD } from '../core/config.js';
import logger from '../core/logger.js';
import type { Task } from '../core/types.js';
import { canUseOwnerCalendar } from '../services/userScope.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

const calendarId = process.env.GOOGLE_CALENDAR_ID;
class GoogleCalendarService {
  private calendar: calendar_v3.Calendar | null = null;

  constructor() {
    this.initializeCalendar();
  }

  private initializeCalendar() {
    try {
      if (!calendarId) {
        logger.warnWithContext({
          message:
            'Google Calendar ID not configured, calendar integration disabled',
        });
        return;
      }

      let credentials: Record<string, unknown>;

      if (IS_PROD) {
        const clientEmail = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
        const projectId = process.env.GOOGLE_CALENDAR_PROJECT_ID;
        const privateKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY;

        if (!privateKey || !clientEmail) {
          logger.errorWithContext({
            message: 'Google Calendar credentials are required',
          });
          return;
        }

        credentials = {
          type: 'service_account',
          project_id: projectId,
          private_key: privateKey,
          client_email: clientEmail,
        };
      } else {
        const credentialsPath = process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH;

        if (!credentialsPath) {
          logger.warnWithContext({
            message:
              'GOOGLE_CALENDAR_CREDENTIALS_PATH not configured, calendar integration disabled',
          });
          return;
        }

        const absolutePath = path.resolve(credentialsPath);
        if (!fs.existsSync(absolutePath)) {
          logger.errorWithContext({
            message: `Google Calendar credentials file not found at: ${absolutePath}`,
          });
          return;
        }

        const credentialsContent = fs.readFileSync(absolutePath, 'utf8');
        credentials = JSON.parse(credentialsContent);
      }

      const auth = new GoogleAuth({
        credentials,
        scopes: SCOPES,
      });

      this.calendar = calendar({ version: 'v3', auth });
      logger.infoWithContext({
        op: 'GOOGLE_CALENDAR',
        message: 'Service initialized successfully',
      });
    } catch (error) {
      logger.errorWithContext({
        op: 'GOOGLE_CALENDAR',
        error,
        message: 'Failed to initialize service',
      });
    }
  }

  async createEvent(task: Task, timezone: string): Promise<string | undefined> {
    if (!canUseOwnerCalendar())
      throw new Error('Calendar is only configured for the bot owner');
    if (!this.calendar) {
      logger.warnWithContext({
        message: 'Google Calendar not configured, skipping event creation',
      });
      return;
    }

    if (!task.date || !task.time) {
      logger.debugWithContext({
        message: 'Task missing date/time, skipping calendar event creation',
      });
      return;
    }

    try {
      if (!calendarId) {
        throw new Error('GOOGLE_CALENDAR_ID not configured');
      }

      const event = getCalendarEventObj(task, timezone);

      const { data } = await this.calendar.events.insert({
        calendarId,
        requestBody: event,
      });

      const eventId = data.id;
      if (eventId) {
        logger.infoWithContext({
          op: 'GOOGLE_CALENDAR',
          message: `Event created: ${eventId} for task: ${task.name}`,
        });
        return eventId;
      }
    } catch (error) {
      logger.errorWithContext({
        op: 'GOOGLE_CALENDAR',
        error,
        message: 'Failed to create calendar event',
      });
    }
  }

  async updateEvent(
    eventId: string,
    task: Task,
    timezone: string,
  ): Promise<string | undefined> {
    if (!canUseOwnerCalendar())
      throw new Error('Calendar is only configured for the bot owner');
    if (!this.calendar) {
      return;
    }

    try {
      if (!calendarId) {
        throw new Error('GOOGLE_CALENDAR_ID not configured');
      }

      const event = getCalendarEventObj(task, timezone);

      const { data } = await this.calendar.events.update({
        calendarId,
        eventId,
        requestBody: event,
      });

      const updatedEventId = data.id;
      if (updatedEventId) {
        logger.infoWithContext({
          op: 'GOOGLE_CALENDAR',
          message: `Event updated: ${updatedEventId} for task: ${task.name}`,
        });
        return updatedEventId;
      }
    } catch (error) {
      logger.errorWithContext({
        op: 'GOOGLE_CALENDAR',
        error,
        message: 'Failed to update calendar event',
      });
    }
  }

  async deleteEvent(eventId: string): Promise<boolean> {
    if (!canUseOwnerCalendar())
      throw new Error('Calendar is only configured for the bot owner');
    if (!this.calendar) {
      return false;
    }

    try {
      if (!calendarId) {
        throw new Error('GOOGLE_CALENDAR_ID not configured');
      }
      await this.calendar.events.delete({
        calendarId,
        eventId,
      });

      logger.infoWithContext({
        op: 'GOOGLE_CALENDAR',
        message: `Event deleted: ${eventId}`,
      });
      return true;
    } catch (error) {
      logger.errorWithContext({
        op: 'GOOGLE_CALENDAR',
        error,
        message: 'Failed to delete calendar event',
      });
      return false;
    }
  }
}

const getCalendarEventObj = (task: Task, timezone: string) => {
  const startDateTimeStr = `${task.date}T${task.time}:00`;
  const startUtc = fromZonedTime(startDateTimeStr, timezone);
  const endUtc = new Date(startUtc);
  // Set default duration if not specified
  if (task.duration) {
    const durationMatch = task.duration.match(/(\d+):(\d+)/);
    if (durationMatch) {
      const [, durationHours, durationMinutes] = durationMatch;
      endUtc.setHours(endUtc.getHours() + parseInt(durationHours, 10));
      endUtc.setMinutes(endUtc.getMinutes() + parseInt(durationMinutes, 10));
    } else {
      // Default 1 hour duration
      endUtc.setHours(endUtc.getHours() + 1);
    }
  } else {
    // Default 1 hour duration
    endUtc.setHours(endUtc.getHours() + 1);
  }

  let description = task.description || '';
  if (task.link) {
    description += `${description ? '\n\n' : ''}Link: ${task.link}`;
  }

  return {
    summary: task.name,
    description,
    start: {
      dateTime: startUtc.toISOString(),
      timeZone: timezone,
    },
    end: {
      dateTime: endUtc.toISOString(),
      timeZone: timezone,
    },
  };
};

// Export singleton instance
export const googleCalendarService = new GoogleCalendarService();
