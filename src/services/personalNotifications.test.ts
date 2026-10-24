import { describe, expect, it } from 'bun:test';
import { createPersonalState } from './personal.js';
import { dispatchPersonalReminders } from './personalNotifications.js';
import { PersonalStore } from './personalStore.js';

describe('Reminder delivery', () => {
  it('rechecks time after a delayed first read', async () => {
    const state = createPersonalState(1);
    state.reminders.enabled = true;
    let now = new Date('2026-10-24T07:00:00Z');
    const store = new PersonalStore(1, {
      read: async () => {
        now = new Date('2026-10-24T07:10:00Z');
        return { state };
      },
      write: async () => {
        throw new Error('must not write');
      },
    });
    let sent = 0;
    await dispatchPersonalReminders(
      store,
      [],
      'Europe/Berlin',
      async () => {
        sent++;
      },
      () => now,
    );
    expect(sent).toBe(0);
  });
  it('rechecks quiet hours after claiming and before delivery', async () => {
    let state = createPersonalState(1);
    state.reminders.enabled = true;
    state.reminders.quietStart = '09:01';
    state.reminders.quietEnd = '10:00';
    let now = new Date('2026-10-24T07:00:00Z');
    let reads = 0;
    const store = new PersonalStore(1, {
      read: async () => {
        if (++reads === 3) now = new Date('2026-10-24T07:02:00Z');
        return { state: structuredClone(state), revision: '1' };
      },
      write: async (next) => {
        state = structuredClone(next);
      },
    });
    let sent = 0;
    await dispatchPersonalReminders(
      store,
      [],
      'Europe/Berlin',
      async () => {
        sent++;
      },
      () => now,
    );
    expect(reads).toBe(3);
    expect(sent).toBe(0);
  });
  it('sends once across repeated and concurrent scheduler calls', async () => {
    let state = createPersonalState(1);
    state.reminders.enabled = true;
    let revision = 0;
    const store = new PersonalStore(1, {
      read: async () => ({
        state: structuredClone(state),
        revision: String(revision),
      }),
      write: async (next, expected) => {
        if (expected !== String(revision))
          throw Object.assign(new Error('Conflict'), { status: 409 });
        state = structuredClone(next);
        revision++;
      },
    });
    const sent: string[] = [];
    const send = async (id: number, text: string) => {
      expect(id).toBe(1);
      sent.push(text);
    };
    const now = new Date('2026-10-24T07:00:00Z');
    await Promise.all([
      dispatchPersonalReminders(store, [], 'Europe/Berlin', send, now),
      dispatchPersonalReminders(store, [], 'Europe/Berlin', send, now),
    ]);
    await dispatchPersonalReminders(store, [], 'Europe/Berlin', send, now);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('/morning');
  });

  it('retries a failed send within the window after its lease expires', async () => {
    let state = createPersonalState(1);
    state.reminders.enabled = true;
    const store = new PersonalStore(1, {
      read: async () => ({ state: structuredClone(state), revision: '1' }),
      write: async (next) => {
        state = structuredClone(next);
      },
    });
    await expect(
      dispatchPersonalReminders(
        store,
        [],
        'Europe/Berlin',
        async () => {
          throw new Error('offline');
        },
        new Date('2026-10-24T07:00:00Z'),
      ),
    ).rejects.toThrow('offline');
    let sent = 0;
    await dispatchPersonalReminders(
      store,
      [],
      'Europe/Berlin',
      async () => {
        sent++;
      },
      new Date('2026-10-24T07:01:00Z'),
    );
    expect(sent).toBe(1);
  });
});
