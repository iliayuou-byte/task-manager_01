export const MAX_ICS_BYTES = 256 * 1024;
export const MAX_ICS_EVENTS = 2000;

export interface ScheduleEvent {
  uid: string;
  date: string;
  start: string;
  end: string;
  title: string;
  location?: string;
}

export interface ImportedCalendar {
  timezone: string;
  events: ScheduleEvent[];
  firstDate: string;
  lastDate: string;
}

const unescapeText = (value: string) =>
  value
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');

const parseDateTime = (value: string, timezone: string) => {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?(Z)?$/,
  );
  if (!match) throw new Error('Неверная дата события.');
  const [, year, month, day, hh = '00', mm = '00', ss = '00', utc] = match;
  const date = `${year}-${month}-${day}`;
  const time = `${hh}:${mm}`;
  const validDate = new Date(`${date}T00:00:00Z`);
  if (
    validDate.toISOString().slice(0, 10) !== date ||
    Number(hh) > 23 ||
    Number(mm) > 59 ||
    Number(ss) > 59
  )
    throw new Error('Неверная дата события.');
  if (utc) {
    const instant = new Date(`${year}-${month}-${day}T${hh}:${mm}:${ss}Z`);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value || '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`,
    };
  }
  return { date, time };
};

const property = (line: string) => {
  const separator = line.indexOf(':');
  if (separator < 0) return undefined;
  const [name, ...params] = line.slice(0, separator).split(';');
  return { name: name.toUpperCase(), params, value: line.slice(separator + 1) };
};

export const parseIcsCalendar = (source: string): ImportedCalendar => {
  if (Buffer.byteLength(source, 'utf8') > MAX_ICS_BYTES)
    throw new Error('Файл расписания больше 256 КБ.');
  const lines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length)
      unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  if (!unfolded.some((line) => line === 'BEGIN:VCALENDAR'))
    throw new Error('Это не файл календаря .ics.');
  let timezone = 'UTC';
  let inEvent = false;
  let event: Record<string, ReturnType<typeof property>> = {};
  const records: Array<Record<string, ReturnType<typeof property>>> = [];
  for (const line of unfolded) {
    if (!inEvent) {
      const item = property(line);
      if (item?.name === 'X-WR-TIMEZONE' || item?.name === 'TZID')
        timezone = item.value;
      if (line === 'BEGIN:VEVENT') {
        inEvent = true;
        event = {};
      }
      continue;
    }
    if (line === 'END:VEVENT') {
      records.push(event);
      inEvent = false;
      continue;
    }
    const item = property(line);
    if (item) event[item.name] = item;
  }
  if (!records.length) throw new Error('В календаре не найдено занятий.');
  if (records.length > MAX_ICS_EVENTS)
    throw new Error('В календаре слишком много событий.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error('В файле указан неизвестный часовой пояс.');
  }
  const events: ScheduleEvent[] = [];
  for (const item of records) {
    if (item.STATUS?.value.toUpperCase() === 'CANCELLED') continue;
    const startItem = item.DTSTART;
    const endItem = item.DTEND;
    const title = item.SUMMARY?.value;
    if (!startItem || !endItem || !title) continue;
    const tzParam = (entry: NonNullable<typeof startItem>) =>
      entry.params
        .find((param) => /^TZID=/i.test(param))
        ?.split('=')
        .slice(1)
        .join('=') || timezone;
    const start = parseDateTime(startItem.value, tzParam(startItem));
    const end = parseDateTime(endItem.value, tzParam(endItem));
    if (start.date !== end.date || end.time <= start.time) continue;
    events.push({
      uid: item.UID?.value || `${start.date}-${start.time}-${events.length}`,
      date: start.date,
      start: start.time,
      end: end.time,
      title: unescapeText(title).trim().slice(0, 200),
      ...(item.LOCATION?.value
        ? { location: unescapeText(item.LOCATION.value).trim().slice(0, 200) }
        : {}),
    });
  }
  if (!events.length)
    throw new Error(
      'В календаре нет подходящих занятий с началом и окончанием.',
    );
  events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
  );
  return {
    timezone,
    events,
    firstDate: events[0].date,
    lastDate: events[events.length - 1].date,
  };
};

export const readScheduleEvents = (raw?: string): ScheduleEvent[] => {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is ScheduleEvent =>
        !!item &&
        typeof item === 'object' &&
        typeof item.date === 'string' &&
        typeof item.start === 'string' &&
        typeof item.end === 'string' &&
        typeof item.title === 'string',
    );
  } catch {
    return [];
  }
};

export const readIcsResponse = async (response: Response): Promise<string> => {
  if (!response.ok || !response.body)
    throw new Error('Не удалось скачать файл.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ICS_BYTES) {
        await reader.cancel();
        throw new Error('Файл расписания больше 256 КБ.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};
