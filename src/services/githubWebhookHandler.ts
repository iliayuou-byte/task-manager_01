import { type Bot, InlineKeyboard } from 'grammy';
import { getGitHubFileInfo, getOctokit } from '../clients/github.js';
import logger from '../core/logger.js';
import type {
  CalendarOpSession,
  GitHubCommit,
  GitHubPushPayload,
} from '../core/types.js';
import {
  type BotContext,
  setPendingCalendarOps,
} from '../middlewares/session.js';
import { formatGitHubSyncMessage } from '../views/syncView.js';
import { filterExternalCommits } from './commitFilter.js';
import { analyzeTaskDiff, hasChanges } from './diffAnalyzer.js';
import { parseMarkdown } from './markdownParser.js';
import { profileOwner, profileUsers, runForUser } from './userScope.js';

const handleUserWebhook = async (
  payload: GitHubPushPayload,
  bot: Bot<BotContext>,
  userId: number,
): Promise<void> => {
  // 1. Filter external commits
  const externalCommits = filterExternalCommits(payload.commits);

  if (externalCommits.length === 0) {
    logger.infoWithContext({
      op: 'GITHUB_WEBHOOK',
      message: 'No external commits found, skipping',
    });
    return;
  }

  // 2. Check if task file was modified in any of the external commits
  const { filePath, owner, repo } = getGitHubFileInfo();

  const relevantCommits: GitHubCommit[] = [];

  for (const commit of externalCommits) {
    const isModified = commit.modified.some((file) => filePath === file);
    const isAdded = commit.added.some((file) => filePath === file);

    if (isModified || isAdded) {
      relevantCommits.push(commit);
    }
  }

  if (relevantCommits.length === 0) {
    logger.infoWithContext({
      op: 'GITHUB_WEBHOOK',
      message: 'Task file not modified in external commits, skipping',
    });
    return;
  }

  // 3. Process each relevant commit
  const octokit = await getOctokit();

  for (const commit of relevantCommits) {
    try {
      // Get file content at this commit
      const { data: currentFile } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
        ref: commit.id,
      });

      if (Array.isArray(currentFile) || currentFile.type !== 'file') {
        logger.warnWithContext({
          op: 'GITHUB_WEBHOOK',
          message: `Path is not a file at commit ${commit.id}`,
        });
        continue;
      }

      const currentContent = Buffer.from(
        currentFile.content,
        'base64',
      ).toString('utf8');

      const { data: commitDetails } = await octokit.repos.getCommit({
        owner,
        repo,
        ref: commit.id,
      });

      const parentSha = commitDetails.parents[0]?.sha;

      let previousContent = '';
      if (parentSha) {
        try {
          const { data: prevFile } = await octokit.repos.getContent({
            owner,
            repo,
            path: filePath,
            ref: parentSha,
          });

          if (!Array.isArray(prevFile) && prevFile.type === 'file') {
            previousContent = Buffer.from(prevFile.content, 'base64').toString(
              'utf8',
            );
          }
        } catch (error) {
          logger.warnWithContext({
            op: 'GITHUB_WEBHOOK',
            message: `Could not fetch previous content for commit ${commit.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      }

      // 4. Analyze Diff
      const diff = analyzeTaskDiff(previousContent, currentContent);

      if (!hasChanges(diff)) {
        logger.infoWithContext({
          op: 'GITHUB_WEBHOOK',
          message: `No task changes detected in commit ${commit.id}`,
        });
        continue;
      }

      const message = formatGitHubSyncMessage(diff, {
        sha: commit.id,
        message: commit.message,
        author: commit.author.name,
        url: commit.url,
      });

      const calendarUpdates: CalendarOpSession[] = [];
      parseMarkdown(currentContent);

      if (diff.modified.length > 0) {
        for (const change of diff.modified) {
          const task = change.after;
          if (task.calendarEventId) {
            calendarUpdates.push({
              type: 'update',
              taskName: task.name,
              calendarEventId: task.calendarEventId,
            });
          }
        }
      }

      if (profileUsers().includes(userId)) {
        if (calendarUpdates.length > 0 && userId === profileOwner()) {
          setPendingCalendarOps(userId, calendarUpdates);

          await bot.api.sendMessage(userId, message, {
            parse_mode: 'MarkdownV2',
            link_preview_options: { is_disabled: true },
            reply_markup: new InlineKeyboard()
              .text(
                `Update ${calendarUpdates.length} Calendar Events?`,
                'cal_yes',
              )
              .text('No', 'cal_no'),
          });
        } else {
          await bot.api.sendMessage(userId, message, {
            parse_mode: 'MarkdownV2',
            link_preview_options: { is_disabled: true },
          });
        }

        logger.infoWithContext({
          op: 'GITHUB_WEBHOOK',
          message: `Notification sent for commit ${commit.id}`,
        });
      }
    } catch (error) {
      logger.errorWithContext({
        op: 'GITHUB_WEBHOOK',
        message: `Error processing commit ${commit.id}`,
        error,
      });
    }
  }
};

export const handleGitHubWebhook = async (
  payload: GitHubPushPayload,
  bot: Bot<BotContext>,
) => {
  for (const userId of profileUsers())
    await runForUser(userId, () => handleUserWebhook(payload, bot, userId));
};
