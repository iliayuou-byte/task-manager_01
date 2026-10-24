import type { Metadata, TaskData } from '../core/types.js';
import { getStorageProvider } from './storage/factory.js';
import { recordUsageSave } from './usageStats.js';

export const saveTasks = async (
  tasks: TaskData,
  metadata: Metadata,
): Promise<boolean> => {
  const provider = getStorageProvider();
  const saved = await provider.saveTasks(tasks, metadata);
  if (saved) recordUsageSave();
  return saved;
};
