import { fetchFileSnapshot, saveFileContent } from '../../clients/github.js';
import { getInitialContent } from '../../core/config.js';
import logger from '../../core/logger.js';
import type { Metadata, TaskData } from '../../core/types.js';
import { validateTask } from '../../utils/validators.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from '../markdownParser.js';
import type { IStorageProvider } from './types.js';

export class GitHubStorageProvider implements IStorageProvider {
  async queryTasks(): Promise<{ metadata: Metadata; taskData: TaskData }> {
    let content: string;
    let revision: string;
    try {
      const snapshot = await fetchFileSnapshot();
      content = snapshot.content;
      revision = snapshot.sha;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Tasks file not found')
      ) {
        await this.initTasks();
        const snapshot = await fetchFileSnapshot();
        content = snapshot.content;
        revision = snapshot.sha;
      } else {
        throw error;
      }
    }
    const parsed = deserializeTaskMarkdown(content);
    parsed.metadata.storage_revision = revision;
    return parsed;
  }

  async saveTasks(tasks: TaskData, metadata: Metadata): Promise<boolean> {
    const invalidTasks = tasks.uncompleted
      .map((task, index) => ({ index, result: validateTask(task) }))
      .filter(({ result }) => !result.valid);

    if (invalidTasks.length > 0) {
      invalidTasks.forEach(({ index, result }) => {
        logger.errorWithContext({
          message: `Task at index ${index} is invalid: ${result.errors.join(', ')}`,
        });
      });
      throw new Error(
        `Cannot save tasks: ${invalidTasks.length} tasks are invalid. Check logs for details.`,
      );
    }

    if (!metadata.timezone) {
      throw new Error('User timezone is not set in metadata.');
    }

    const activeTags = new Set<string>([]);
    for (const task of [...tasks.uncompleted, ...tasks.completed]) {
      task.id ||= crypto.randomUUID();
    }
    for (const task of tasks.uncompleted) {
      if (task.tags) {
        for (const tag of task.tags) {
          activeTags.add(tag);
        }
      }
    }
    metadata.tags = Array.from(activeTags).sort();

    const now = new Date();
    metadata.last_synced = now.toISOString();
    const content = serializeTaskMarkdown(tasks, metadata);
    const commitMessage = `[bot] update - ${now.toISOString()}`;
    return saveFileContent(
      content,
      commitMessage,
      3,
      metadata.storage_revision,
    );
  }

  async initTasks(): Promise<string> {
    const content = getInitialContent(new Date());
    try {
      await saveFileContent(content, '[bot] init');
      logger.infoWithContext({
        op: 'INIT_TASKS_FILE',
        message: 'Created initial tasks file on GitHub',
      });
    } catch (saveError) {
      logger.warnWithContext({
        op: 'INIT_TASKS_FILE',
        error: saveError,
        message: 'Failed to save initial tasks file',
      });
    }
    return content;
  }
}
