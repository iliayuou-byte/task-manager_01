<p align="center">
  <img src="assets/logo.png" alt="Markdown Task Manager" width="180" />
</p>

<h1 align="center">Markdown Task Manager</h1>

<p align="center">
  <a href="https://github.com/klhq/md-task-manager/actions/workflows/ci.yml"><img src="https://github.com/klhq/md-task-manager/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-BUSL--1.1-blue.svg" alt="License: BUSL-1.1" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" /></a>
  <a href="https://hono.dev"><img src="https://img.shields.io/badge/framework-Hono-E36002?logo=hono" alt="Hono" /></a>
  <a href="https://grammy.dev"><img src="https://img.shields.io/badge/bot-grammY-009dca" alt="grammY" /></a>
  <a href="https://vercel.com"><img src="https://img.shields.io/badge/deploy-Vercel-000?logo=vercel" alt="Deploy" /></a>
</p>

A Telegram bot that turns natural language into organized tasks — stored in a **GitHub Markdown file** you own. Powered by AI (Gemini, OpenAI, Anthropic) with **Google Calendar sync**.

> **Want to try it first?** The hosted multi-user version is now **publicly available** at [@LazyMdTaskBot](https://t.me/LazyMdTaskBot) — no invite required.
> This repo is the **self-hostable single-user** edition — bring your own API keys.

<p align="center">
  <img src="https://img.shields.io/badge/AI-Gemini%20%7C%20OpenAI%20%7C%20Anthropic-blueviolet" />
  <img src="https://img.shields.io/badge/Storage-GitHub%20Markdown-181717?logo=github" />
  <img src="https://img.shields.io/badge/Calendar-Google%20Calendar-4285F4?logo=google-calendar" />
</p>

## Why?

Your tasks live in a **Markdown file in your own GitHub repo** — not locked in someone else's database. Edit tasks from Telegram, VS Code, or directly on GitHub. The bot keeps everything in sync.

```markdown
| Completed | Task           | Date       | Time  | Duration | Priority | Tags    |
| :-------- | :------------- | :--------- | :---- | :------- | :------- | :------ |
|           | Team meeting   | 2026-04-02 | 10:00 | 1:00     | high     | #work   |
| x         | Buy groceries  | 2026-04-01 | 15:00 | 0:30     |          | #errand |
```

## Features

- **Just type naturally** — *"Buy milk tomorrow at 3pm #shopping"* → AI extracts title, date, time, duration, description, and links automatically
- **Your data, your choice** — Store tasks in a GitHub Markdown table or a Notion database, editable anywhere
- **Google Calendar sync** — Events created/updated/deleted automatically when tasks change
- **Multi-provider AI** — Choose Gemini, OpenAI, Anthropic, or any OpenAI-compatible provider (Groq, Together, Ollama, DeepInfra)
- **Smart task picker** — Inline keyboard for completing, editing, and removing tasks
- **Timezone-aware** — Set your timezone once, all dates/times convert automatically
- **Daily reminders** — Cron-triggered notification for today's tasks
- **GitHub webhook sync** — Edit tasks on GitHub? The bot detects changes and notifies you
- **Secure** — Allowlist-based access, webhook signature verification

## AI Model Compatibility

The AI extraction layer works with a wide range of models, including smaller or self-hosted LLMs that don't fully support structured outputs:

1. **Structured output (preferred)**: Sends the Zod schema as `json_schema` (Structured Outputs). Best accuracy on Gemini, GPT-4o, Claude, etc.
2. **JSON mode fallback (automatic)**: If the first attempt fails for any reason, automatically retries with `type: "json_object"` (standard JSON mode) — no configuration needed.
3. **Robust parsing**: Optional fields use a `robustString` preprocessor that safely coerces `null`, `undefined`, or non-string values to `""`, preventing crashes from models that omit fields.

**Tested providers via `OPENAI_BASE_URL`**: DeepInfra, Groq, Together, Ollama.

## Editions

|  | Self-hosted (this repo) | Pro ([@LazyMdTaskBot](https://t.me/LazyMdTaskBot)) |
|:--|:--|:--|
| Users | Single-user (allowlist) | Public (blocklist moderation) |
| Storage | GitHub Markdown / Notion DB (`.env`) | GitHub App + Notion OAuth + Cloud DB |
| Calendar | Service account | Per-user OAuth |
| Caching | None | Redis |
| Notifications | Vercel cron | QStash hourly cron |
| Source | Open | Private |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/klhq/md-task-manager.git
cd md-task-manager
bun install

# 2. Configure
cp .env.example .env
# Edit .env with your credentials

# 3. Run
bun run dev
```

### What You Need

| Credential | Where to get it |
|:-----------|:----------------|
| Telegram Bot Token | [@BotFather](https://t.me/BotFather) |
| GitHub Personal Access Token | [GitHub Settings](https://github.com/settings/tokens) (with `repo` scope) |
| AI API Key | [Google AI Studio](https://aistudio.google.com/apikey), [OpenAI](https://platform.openai.com/api-keys), or [Anthropic](https://console.anthropic.com/) |
| Google Calendar (optional) | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — service account |

### Configuration

| Variable | Description | Required |
|:---------|:------------|:---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather | Yes |
| `TELEGRAM_BOT_ALLOWLIST` | Comma-separated Telegram user IDs | Yes |
| `STORAGE_PROVIDER` | `github` (default) or `notion` | Optional |
| `PROVIDER_API_KEY` | GitHub Personal Access Token | If `STORAGE_PROVIDER=github` |
| `FILE_PATH` | Full URL to your task file on GitHub | If `STORAGE_PROVIDER=github` |
| `NOTION_TOKEN` | Notion internal connection token | If `STORAGE_PROVIDER=notion` |
| `NOTION_DATABASE_ID` | Notion Database ID (32 hex characters) or URL | If `STORAGE_PROVIDER=notion` |
| `AI_PROVIDER` | `gemini`, `openai`, or `anthropic` | Yes |
| `AI_MODEL` | Model name (e.g., `gemini-2.5-flash`, `gpt-4o`) | Yes |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key | If `gemini` |
| `OPENAI_API_KEY` | OpenAI API key | If `openai` |
| `OPENAI_BASE_URL` | Custom base URL (Groq, Together, Ollama) | No |
| `VOICE_TRANSCRIPTION_PROVIDER` | `local` (CPU Whisper) or `gemini` (legacy default when unset) | No |
| `WHISPER_PYTHON` | Python executable; automatically detects project `.venv` when empty | If local voice |
| `WHISPER_MODEL` | Local Whisper model, default `small` | No |
| `WHISPER_LANGUAGE` | Language code or empty for automatic detection | No |
| `ANTHROPIC_API_KEY` | Anthropic API key | If `anthropic` |
| `CRON_SECRET` | Secret for cron endpoint auth | Yes |
| `BOT_SECRET` | Telegram webhook verification | Optional |
| `GITHUB_WEBHOOK_SECRET` | GitHub push notification verification | Optional |
| `GOOGLE_CALENDAR_ID` | Calendar ID for sync | Optional |
| `GOOGLE_CALENDAR_CREDENTIALS_PATH` | Service account JSON (local dev) | Optional |

<details>
<summary><strong>Vercel deployment (Google Calendar)</strong></summary>

Instead of `GOOGLE_CALENDAR_CREDENTIALS_PATH`, set:
- `GOOGLE_CALENDAR_CLIENT_EMAIL`
- `GOOGLE_CALENDAR_PROJECT_ID`
- `GOOGLE_CALENDAR_PRIVATE_KEY`
</details>

## Commands

### Task Management
| Command | Description |
|:--------|:------------|
| `/add <text>` | Add task with natural language — *"Meeting tomorrow 3pm for 2h #work"* |
| `/list` | List pending tasks (`/list all` for all, `/list #tag` to filter) |
| `/today` | Today's tasks |
| `/complete` | Mark task as done (inline picker or `/complete Task Name`) |
| `/edit` | Edit task fields interactively (inline picker or `/edit Task Name`) |
| `/remove` | Remove a task (inline picker or `/remove Task Name`) |
| `/sort` | Sort by priority or time |
| `/clearcompleted` | Clear all completed tasks |

### Settings
| Command | Description |
|:--------|:------------|
| `/settimezone` | Set timezone (inline picker or `/settimezone Asia/Taipei`) |
| `/mytimezone` | Show current timezone |
| `/about` | Bot info and version |

## GitHub Sync

Get notified when tasks are edited on GitHub:

1. Generate a secret: `openssl rand -hex 32`
2. Add as `GITHUB_WEBHOOK_SECRET` in your `.env`
3. In your repo: **Settings** → **Webhooks** → **Add webhook**
   - URL: `https://your-domain.vercel.app/api/github-webhook`
   - Content type: `application/json`
   - Secret: your generated secret
   - Events: **Just the push event**

The bot filters its own commits automatically — no duplicate notifications.

## Deploy

Optimized for **Vercel**:

1. Import to Vercel
2. Add environment variables
3. Deploy
4. Set Telegram webhook: `https://your-domain.vercel.app/api`

Daily reminder cron configured in `vercel.json`.

## Contributing

Contributions welcome! Fork → Branch → Commit → PR.

## License

[Business Source License 1.1](LICENSE)

## Personal copilot

See [COPILOT_SETUP.md](COPILOT_SETUP.md) for `/now` and local polling setup.

### Проверка категорий перед сохранением

После ввода списка текстом или голосом бот показывает черновик по четырём разделам Эйзенхауэра. `❓` означает предложение ИИ, ещё не проверенное пользователем; это не оценка уверенности модели. Нажмите «Разобрать по одному», чтобы выбрать категорию для каждого дела, или «Изменить категорию», чтобы выбрать отдельное дело по номеру. Номера сохраняются при переносе между разделами. Ваш выбор закрепляется и защищён от автоматической переклассификации. Изменения попадут в хранилище только после «Сохранить»; проверка кнопками не расходует запросы ИИ.

### Локальная расшифровка и OpenAI

Новая `.env.example` предлагает локальный Whisper для голосовых и OpenAI для разбора текста. Для запуска нужно установить Python-зависимости и настроить API-ключ: [инструкция для Mac и Windows](docs/LOCAL_VOICE.md). Существующая `.env` автоматически не изменяется. При неудачном разборе текст сохраняется на 24 часа; `/retry` повторяет его без новой расшифровки. В polling-режиме временные сбои повторяются максимум два раза, ошибки оплаты и авторизации — только вручную. Результат всегда требует подтверждения.

### Разговор с помощником и общие дела

Кнопка «💬 Поговорить» или `/talk` открывает разговор с контекстом текущих задач и памятью последних шести обменов репликами. При просьбе изменить дела помощник предлагает подготовить подтверждаемый черновик. «Забыть разговор» очищает локальную память; выход в меню останавливает показ ожидающего ответа. `ASSISTANT_STYLE` задаёт дополнительный стиль. Через подключение GitHub в ChatGPT можно работать с тем же файлом задач: [инструкция](docs/SHARED_ASSISTANT.md).

Важность определяется влиянием на цели и серьёзностью последствий. Срочность — близким сроком и последствиями промедления. Сообщайте контекст («до выхода из дома», «до завтра»), чтобы предложение ИИ было точнее.
