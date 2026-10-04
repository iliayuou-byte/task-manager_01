import { type Field, Priority, type Task } from '../core/types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface FieldConfig {
  validator: (value: unknown) => boolean;
  transform?: (value: string) => unknown;
  errorMessage: string;
  clearDependents?: Array<keyof Task>;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DURATION_REGEX = /^\d+:[0-5]\d$/;

export const validateTask = (task: Task): ValidationResult => {
  const errors: string[] = [];

  // Validate all fields using FIELD_CONFIGS
  (Object.keys(FIELD_CONFIGS) as Field[]).forEach((field) => {
    const value = task[field];
    const config = FIELD_CONFIGS[field];

    // Handle required fields (name, completed, tags)
    if (field === 'name' || field === 'completed' || field === 'tags') {
      if (!config.validator(value)) {
        const fieldValue = typeof value === 'string' ? `"${value}"` : value;
        errors.push(
          `${config.errorMessage}${typeof value === 'string' ? `: ${fieldValue}` : ''}`,
        );
      }
      return;
    }

    // Skip optional fields if not present (undefined or empty string)
    if (value === undefined || value === '') return;

    if (!config.validator(value)) {
      const fieldValue = typeof value === 'string' ? `"${value}"` : value;
      errors.push(
        `${config.errorMessage}${typeof value === 'string' ? `: ${fieldValue}` : ''}`,
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
};

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const isValidPriority = (value: string): value is Priority => {
  return Object.values(Priority).includes(value as Priority);
};
// Field validators
const validators = {
  completed: (value: unknown): value is boolean => typeof value === 'boolean',
  name: (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0,
  date: (value: unknown): value is string =>
    typeof value === 'string' && DATE_REGEX.test(value),
  time: (value: unknown): value is string =>
    typeof value === 'string' && TIME_REGEX.test(value),
  duration: (value: unknown): value is string =>
    typeof value === 'string' && DURATION_REGEX.test(value),
  priority: (value: unknown): value is Priority =>
    typeof value === 'string' && isValidPriority(value),
  tags: (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((tag) => typeof tag === 'string'),
  description: (value: unknown): value is string => typeof value === 'string',
  link: (value: unknown): value is string =>
    typeof value === 'string' ? isValidUrl(value) : false,
  calendarEventId: (value: unknown): value is string =>
    typeof value === 'string',
  recurrenceRule: (value: unknown): value is string =>
    typeof value === 'string' &&
    /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.test(value),
} as const;

// Field configurations for all task fields
export const FIELD_CONFIGS: Record<Field, FieldConfig> = {
  important: {
    validator: (value) => typeof value === 'boolean',
    errorMessage: 'Important must be boolean',
  },
  urgent: {
    validator: (value) => typeof value === 'boolean',
    errorMessage: 'Urgent must be boolean',
  },
  completed: {
    validator: validators.completed,
    errorMessage: 'Completed must be a boolean value',
  },
  name: {
    validator: validators.name,
    errorMessage: 'Task name cannot be empty',
  },
  date: {
    validator: validators.date,
    errorMessage: 'Invalid date format. Expected YYYY-MM-DD',
    clearDependents: ['time', 'duration'],
  },
  time: {
    validator: validators.time,
    errorMessage: 'Invalid time format. Expected HH:MM',
    clearDependents: ['duration'],
  },
  duration: {
    validator: validators.duration,
    errorMessage: 'Invalid duration format. Expected HH:MM',
  },
  priority: {
    validator: validators.priority,
    errorMessage: 'Invalid priority value',
  },
  tags: {
    validator: validators.tags,
    errorMessage: 'Invalid tags format',
  },
  description: {
    validator: validators.description,
    errorMessage: 'Invalid description',
  },
  link: {
    validator: validators.link,
    errorMessage: 'Invalid link format. Please provide a valid URL.',
  },
  calendarEventId: {
    validator: validators.calendarEventId,
    errorMessage: 'Calendar event ID must be a string',
  },
  log: {
    validator: validators.description,
    errorMessage: 'Invalid log format',
  },
  recurrenceRule: {
    validator: validators.recurrenceRule,
    errorMessage:
      'Invalid recurrence rule. Expected RRULE format (e.g., FREQ=WEEKLY;BYDAY=MO)',
  },
};
