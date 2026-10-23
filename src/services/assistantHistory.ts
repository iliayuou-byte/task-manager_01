import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(6000),
});
export type AssistantTurn = z.infer<typeof turnSchema>;
const threadSchema = z.object({
  key: z.string(),
  expires: z.number(),
  turns: z.array(turnSchema).max(12),
});
type Thread = z.infer<typeof threadSchema>;

export class AssistantHistory {
  constructor(
    private readonly path = process.env.ASSISTANT_HISTORY_PATH ||
      'runtime/assistant-history.json',
  ) {}
  private read(): Thread[] {
    try {
      return z
        .array(threadSchema)
        .parse(JSON.parse(readFileSync(this.path, 'utf8')))
        .filter((thread) => thread.expires > Date.now());
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return [];
      throw new Error('Assistant history unavailable');
    }
  }
  private write(threads: Thread[]) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(threads), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
  get(owner: number, chat: number): AssistantTurn[] {
    return (
      this.read().find((thread) => thread.key === `${owner}:${chat}`)?.turns ??
      []
    );
  }
  append(owner: number, chat: number, input: string, reply: string) {
    const key = `${owner}:${chat}`;
    const threads = this.read();
    const previous = threads.find((thread) => thread.key === key)?.turns ?? [];
    this.write([
      ...threads.filter((thread) => thread.key !== key).slice(-99),
      {
        key,
        expires: Date.now() + 7 * 24 * 60 * 60_000,
        turns: [
          ...previous,
          { role: 'user' as const, content: input },
          { role: 'assistant' as const, content: reply },
        ].slice(-12),
      },
    ]);
  }
  clear(owner: number, chat: number) {
    this.write(
      this.read().filter((thread) => thread.key !== `${owner}:${chat}`),
    );
  }
}
