# Personal Telegram Copilot

First version: `/now` recommends one available task and two alternatives.
`/now 30` supplies available minutes. It does not create calendar blocks.
Ranking uses priority, planned date and duration. Dates are not deadlines.
Future scheduled tasks are excluded; long tasks can be suggested as partial work.
AI is used by the existing `/add` parser, not by `/now`.

## First local run

1. Install Bun and clone this repository, then check out `feature/daily-copilot-now`.
2. Run `bun install` and copy `.env.example` to `.env`.
3. Set `TELEGRAM_BOT_TOKEN` from BotFather and `TELEGRAM_BOT_ALLOWLIST` to your numeric Telegram **user ID**.
4. Create a separate **private** GitHub repository for personal tasks. The code repository is public. Set `FILE_PATH` to `https://github.com/OWNER/PRIVATE-REPO/blob/main/task-table.md`. The bot initializes the file if missing.
5. Set `PROVIDER_API_KEY` to a fine-grained GitHub token limited to that private repository with Contents read/write. The ChatGPT connector credentials do not carry over to the bot.
6. Select an AI provider/model and set its key for `/add`. For Gemini, the correct name is `GOOGLE_GENERATIVE_AI_API_KEY`. For OpenAI, use `OPENAI_API_KEY` with `AI_PROVIDER=openai` and a model available on your API account.
7. Run `bun run start:polling`. No hosting, public URL or Google Calendar is required for this trial. Run only one polling process. The process refuses to start when a webhook is active.
8. In Telegram: `/settimezone Europe/Berlin`, `/add Изучить одну тему сопромата #study`, `/list`, `/now`, `/now 30`, then `/complete` with the task name.

Keep keys in `.env` or a hosting service's secret settings; never commit them or send them in chat. API billing is separate from a ChatGPT subscription. Local polling works while the computer and process are running. For continuous use, deploy the existing webhook app to a hosting provider later.

## Verification

`bun run typecheck`, `bun run lint`, `bun test src/services/priorityEngine.test.ts`.

## Brain dump

Send `/brain study 40 minutes, buy groceries, check 1C tomorrow`. Review the proposed tasks, then press Save or Cancel. Drafts expire after 15 minutes or a bot restart; sending a new brain dump replaces the previous draft. Matching pending task names are skipped. Dates, durations and priorities are extracted only when stated. Calendar events are not created by this command. Use the command in a private chat.

## Voice task entry

Send a Telegram voice message directly in the private bot chat. With `AI_PROVIDER=gemini`, the existing model/key transcribes the audio, displays the transcript, and opens the same task draft with Save/Cancel. No tasks are saved until confirmation. Limit: 3 minutes and 8 MiB. Audio is downloaded into memory and sent to the configured Gemini API; no audio file is written locally. The transcript appears in the Telegram chat. Check names and dates before saving. Other providers currently require text `/brain`.

## Eisenhower matrix and reminders

`/list`, `/today`, and `/brain` previews group numbered one-line tasks into four sections: important/urgent, important/not urgent, not important/urgent, neither. `/now` follows the same quadrant order. AI proposes importance and urgency separately; a planned date alone does not mean urgent. For older tasks, urgent priority maps to quadrant 1, low to quadrant 4, others to quadrant 2. Override with `/quadrant 3 exact task name` (numbers 1–4 are quadrant IDs, not displayed task numbers).

With GitHub storage, Important and Urgent columns are appended on the next save. Existing twelve-column files remain readable. No manual migration is needed. Matrix fields/reminder metadata are implemented for the GitHub storage used by this personal bot; Notion storage is not extended here.

Enable Telegram list reminders with `/reminders 09:00 19:00` in your stored timezone. `/reminders` shows settings, `/reminders off` disables them. Up to four daily times. Reminders include undated tasks and tasks planned for today or earlier, excluding completed tasks. They are daily digests, not individual deadline alarms. They go to the first allowlisted user (single-owner bot).

Polling checks each minute while the process is running. A saved slot prevents ordinary duplicates across restarts; a ten-minute grace window handles short outages. Sleep/offline periods beyond that window are not replayed. Telegram delivery followed by a storage failure may result in a repeat message. For webhook hosting, the cron endpoint needs an external scheduler running every minute; the original daily cron alone is insufficient. Reminder times and last-sent state are stored in task-file frontmatter.

## Delete by numbers or voice

After `/list` or `/today`, use `/remove 1 3` or plain `удали 1, 3`. Numbers refer to the last displayed saved-task list, including reminder digests, and follow quadrant order. They are display numbers, not persistent IDs. After a restart, open `/list` again. Brain previews are not saved-task lists.

Voice examples: “удали первое и третье дело” or “удали дело про продукты”. Explicit deletion phrases route to selection instead of addition. The AI matches references against the task list; ambiguous or mixed add/delete requests ask for clarification. Every numeric or voice deletion shows selected names with Delete/Cancel buttons before writing storage. Confirmation expires in 15 minutes. A changed/completed/missing task invalidates the selection instead of deleting a different task. Calendar events require their own follow-up confirmation.

## Управление кнопками

Отправь `/menu` или `/start`, чтобы открыть постоянную клавиатуру: сегодня, все дела, добавить, что сейчас, выполнено, удалить и настройки. Добавление принимает текст или ГС и показывает подтверждение. В списке выбери дело: доступны выполнение, редактирование, четыре раздела Эйзенхауэра и удаление с подтверждением. Старые команды продолжают работать.

В «Настройки → Напоминания» включай и выключай отправку, меняй время, добавляй до четырёх времён, удаляй отдельное время или отправляй пробное напоминание. Час выбирается кнопкой, минуты — 00/15/30/45; для другого времени есть ввод HH:MM. Расписание сохраняется при выключении. Часовой пояс выбирается в настройках; другие зоны доступны через `/settimezone`. Напоминания требуют запущенного бота и бодрствующего Mac с интернетом.

Кнопки выбора дел и расписания действуют 30 минут и привязаны к текущему экрану. После перезапуска открой меню заново. Номера дел соответствуют последнему показанному списку.

## Личные правила ИИ

В «Настройки → Приоритеты ИИ» можно включить/выключить автораспределение новых дел, изменить «Мои правила», вернуть стандартные правила или разобрать существующие дела (до 30 за раз). Правила — текст до 2000 символов, сохраняются в Markdown и используются для добавления через /add, /brain и ГС. Выключение автораспределения оставляет только явно указанные пользователем важность и срочность.

Пример правил: «Учёба, работа и здоровье важны при конкретных целях или последствиях. Срочно — настоящий дедлайн в ближайшие два дня или серьёзные последствия задержки. Покупки и бытовые мелочи обычно менее важные, кроме необходимых лекарств и еды. Не придумывай сроки; дата плана не равна дедлайну». Указывай цели, критерии срочности и исключения. В сообщении с делом давай контекст: «Сдать отчёт до среды, иначе задержат оплату».

Разбор текущих дел показывает предлагаемые разделы и краткие причины, затем ждёт подтверждения. При недостатке информации раздел сохраняется, а бот указывает недостающие детали. Ручная смена раздела закрепляет его; в карточке доступны «Закрепить раздел» и «Разрешить ИИ менять раздел». Изменившиеся после предпросмотра задачи не перезаписываются — нужно разобрать список заново. Это настройка инструкций модели, а не обучение модели на твоих данных.

## Чистый чат

В личном чате меню, карточки и настройки редактируются на месте. При смене экрана предыдущие части больших списков и предпросмотров удаляются; кнопки выбора дела находятся под самим списком. Использованные текстовые команды и ответы в диалогах убираются после появления ответа бота. Промежуточная расшифровка ГС заменяется предпросмотром; оригинальная запись удаляется только после успешного разбора и показа подтверждения. Ошибки и автоматические напоминания остаются в истории.

Бот отслеживает только свои новые экраны после запуска; прежняя история и сообщения до перезапуска автоматически не очищаются. Если Telegram запрещает редактирование или удаление, бот отправляет новый экран, а сама операция с делами продолжается. Очистка не удаляет дела из хранилища.

## Назад и главное меню

На каждом экране есть «⬅️ Назад» и «🏠 Меню». Назад возвращает к предыдущему шагу: минуты → часы → напоминания; выбор важности → карточка → список; ввод поля → выбор поля. В подтверждениях добавления и удаления Назад отменяет черновик и возвращает к вводу или карточке. Меню завершает текущий ввод и отменяет ожидающие подтверждения без изменения дел. Эти кнопки доступны также на экранах ошибок.

## Клавиатура текущего раздела

В главном меню остаются пять кнопок: Сегодня, Все дела, Добавить, Что сейчас и Настройки. Назад/Меню и общие Удалить/Выполнено из главного меню убраны. Нижняя клавиатура меняется под текущий экран: в настройках — напоминания/ИИ/часовой пояс, в списке — выбор дел, в карточке — действия с выбранным делом, в подтверждении — сохранить/удалить и отменить. В разделах остаются Назад и Меню.

Telegram обновляет нижнюю клавиатуру только при отправке сообщения, поэтому новый экран отправляется с новой клавиатурой, а предыдущий убирается после успешной отправки. При перезапуске открой /menu: привязки кнопок к текущим действиям хранятся только в памяти.
