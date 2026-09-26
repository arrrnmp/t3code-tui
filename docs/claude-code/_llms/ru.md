# Claude Code Docs: Russian

> Official documentation for Claude Code, Anthropic's agentic coding tool available in the terminal, IDE, desktop app, and browser. Covers installation, configuration, skills, subagents, hooks, MCP, the Agent SDK, and reference material.

## Russian

### Начало работы

#### Начало работы

- [Обзор](https://code.claude.com/docs/ru/overview.md): Claude Code — это агентский инструмент кодирования, который читает вашу кодовую базу, редактирует файлы, выполняет команды и интегрируется с вашими инструментами разработки. Доступен в вашем терминале, IDE, приложении для рабочего стола и браузере.
- [Быстрый старт](https://code.claude.com/docs/ru/quickstart.md): Добро пожаловать в Claude Code!
- [Журнал изменений](https://code.claude.com/docs/ru/changelog.md)

#### Основные концепции

- [Как работает Claude Code](https://code.claude.com/docs/ru/how-claude-code-works.md): Поймите агентивный цикл, встроенные инструменты и то, как Claude Code взаимодействует с вашим проектом.
- [Расширение Claude Code](https://code.claude.com/docs/ru/features-overview.md): Узнайте, когда использовать CLAUDE.md, Skills, subagents, hooks, MCP и plugins.
- [Изучите директорию .claude](https://code.claude.com/docs/ru/claude-directory.md): Где Claude Code читает CLAUDE.md, settings.json, hooks, skills, commands, subagents, workflows, rules и auto memory. Изучите директорию .claude в вашем проекте и ~/.claude в вашей домашней директории.
- [Изучите контекстное окно](https://code.claude.com/docs/ru/context-window.md): Интерактивная симуляция того, как контекстное окно Claude Code заполняется во время сеанса. Посмотрите, что загружается автоматически, какую стоимость имеет каждое чтение файла и когда срабатывают правила и hooks.
- [Как Claude Code использует prompt caching](https://code.claude.com/docs/ru/prompt-caching.md): Claude Code управляет prompt caching автоматически. Узнайте, почему переключение модели вызывает медленный ход без кэша, что стоит `/compact`, почему изменения CLAUDE.md не применяются во время сеанса и как проверить коэффициент попадания в кэш.

#### Использовать Claude Code

- [Как Claude запоминает ваш проект](https://code.claude.com/docs/ru/memory.md): Дайте Claude постоянные инструкции с помощью файлов CLAUDE.md или AGENTS.md и позвольте Claude автоматически накапливать знания с помощью auto memory.
- [Управление сеансами](https://code.claude.com/docs/ru/sessions.md): Назовите, возобновите, создавайте ветви и переключайтесь между диалогами Claude Code. Охватывает `--continue`, `--resume`, `--from-pr`, средство выбора `/resume`, именование сеансов, экспорт стенограмм и место хранения стенограмм.
- [Распространённые рабочие процессы](https://code.claude.com/docs/ru/common-workflows.md): Пошаговые руководства по изучению кодовых баз, исправлению ошибок, рефакторингу, тестированию и другим повседневным задачам с Claude Code.
- [Библиотека промптов](https://code.claude.com/docs/ru/prompt-library.md): Копируйте и вставляйте промпты для Claude Code, отсортированные по задачам и ролям.
- [Лучшие практики для Claude Code](https://code.claude.com/docs/ru/best-practices.md): Советы и паттерны для максимального использования Claude Code, от настройки окружения до масштабирования на параллельные сеансы.

#### Платформы и интеграции

- [Платформы и интеграции](https://code.claude.com/docs/ru/platforms.md): Выберите, где запустить Claude Code и что к нему подключить. Сравните CLI, Desktop, VS Code, JetBrains, веб, мобильные приложения и интеграции, такие как Chrome, Slack и CI/CD.
- [Продолжайте локальные сеансы с любого устройства с помощью Remote Control](https://code.claude.com/docs/ru/remote-control.md): Продолжайте локальный сеанс Claude Code со своего телефона, планшета или любого браузера, используя Remote Control. Работает с claude.ai/code и мобильным приложением Claude.
- [Позвольте Claude координировать текущую работу с помощью Projects](https://code.claude.com/docs/ru/claude-projects.md): Предоставьте Claude набор связанной работы в одном разговоре и позвольте ему координировать параллельные облачные сеансы, которые совместно используют репозитории, инструкции и память.
- [Claude Code на мобильном устройстве](https://code.claude.com/docs/ru/mobile.md): Запускайте, отслеживайте и управляйте задачами Claude Code со своего телефона с помощью приложения Claude для iOS и Android.
- [Использование Claude Code с Chrome](https://code.claude.com/docs/ru/chrome.md): Подключите Claude Code к браузеру Chrome для тестирования веб-приложений, отладки с помощью логов консоли, автоматизации заполнения форм и извлечения данных со страниц.
- [Позвольте Claude использовать ваш компьютер из CLI](https://code.claude.com/docs/ru/computer-use.md): Включите computer use в Claude Code CLI, чтобы Claude мог открывать приложения, кликать, печатать и видеть ваш экран на macOS. Тестируйте нативные приложения, отлаживайте визуальные проблемы и автоматизируйте инструменты только с GUI без необходимости покидать терминал.
- [Использование Claude Code в VS Code](https://code.claude.com/docs/ru/vs-code.md): Установите и настройте расширение Claude Code для VS Code. Получите помощь AI при кодировании с встроенными diff, @-упоминаниями, проверкой плана и сочетаниями клавиш.
- [JetBrains IDEs](https://code.claude.com/docs/ru/jetbrains.md): Используйте Claude Code с JetBrains IDEs, включая IntelliJ, PyCharm, WebStorm и другие
- [Claude Code в Slack](https://code.claude.com/docs/ru/slack.md): Делегируйте задачи кодирования прямо из вашего рабочего пространства Slack. Anthropic снимает с производства эту более раннюю версию для рабочих пространств Team и Enterprise в пользу Claude Tag; она остается путем настройки для планов Pro и Max.
- [Claude Tag](https://code.claude.com/docs/ru/claude-tag.md): Интегрируйте Claude в каналы Slack вашей команды с помощью Claude Tag и найдите документацию по его настройке и использованию на claude.com.

##### Claude Code в облаке

- [Начало работы с Claude Code в облаке](https://code.claude.com/docs/ru/web-quickstart.md): Запустите Claude Code в облаке из браузера или мобильного приложения. Подключите репозиторий GitHub, отправьте задачу и просмотрите PR без локальной настройки.
- [Использование Claude Code в облаке](https://code.claude.com/docs/ru/claude-code-on-the-web.md): Запускайте сессии Claude Code в облаке из браузера, телефона, настольного приложения или терминала, перемещайте их с помощью --cloud и --teleport, а также автоматически исправляйте pull requests.
- [Автоматизация работы с помощью рутин](https://code.claude.com/docs/ru/routines.md): Переведите Claude Code на автопилот. Определите рутины, которые запускаются по расписанию, срабатывают при вызовах API или реагируют на события GitHub из облачной инфраструктуры.
- [Поиск ошибок с помощью ultrareview](https://code.claude.com/docs/ru/ultrareview.md): Запустите глубокий многоагентный анализ кода в облаке с помощью /code-review ultra, чтобы найти и проверить ошибки перед слиянием.

##### Claude Code на рабочем столе

- [Начало работы с настольным приложением](https://code.claude.com/docs/ru/desktop-quickstart.md): Установите Claude Code на рабочий стол и начните свой первый сеанс кодирования
- [Настольное приложение](https://code.claude.com/docs/ru/desktop.md): Получите больше возможностей от Claude Code Desktop: параллельные сеансы с изоляцией Git, макет панелей с перетаскиванием, интегрированный терминал и редактор файлов, боковые чаты, использование компьютера, отправка сеансов со своего телефона, визуальный просмотр различий, предпросмотр приложений, м…
- [Claude Desktop на Linux (бета)](https://code.claude.com/docs/ru/desktop-linux.md): Установка и обновление приложения Claude Desktop на Ubuntu и Debian
- [Claude Code Desktop в WSL](https://code.claude.com/docs/ru/desktop-wsl.md): Запуск сеансов Code внутри дистрибутива WSL 2 на Windows
- [Планирование повторяющихся задач в Claude Code Desktop](https://code.claude.com/docs/ru/desktop-scheduled-tasks.md): Настройте запланированные задачи в Claude Code Desktop для автоматического запуска Claude на регулярной основе для ежедневных проверок кода, аудитов зависимостей или утренних брифингов.
- [Тестирование iOS приложений в симуляторе](https://code.claude.com/docs/ru/desktop-ios-simulator.md): Claude Code Desktop открывает ваше приложение в панели iOS Simulator при сборке, запуске или проверке, с отдельным симулятором для каждой сессии.

##### Проверка кода и CI/CD

- [Выявляйте проблемы безопасности по мере написания кода Claude](https://code.claude.com/docs/ru/security-guidance.md): Установите плагин security-guidance, чтобы Claude проверял собственные изменения кода на уязвимости и исправлял их в одном сеансе.
- [Сканируйте вашу кодовую базу на уязвимости](https://code.claude.com/docs/ru/claude-security.md): Установите Claude Security plugin для сканирования вашей кодовой базы на уязвимости в сеансе Claude Code и преобразуйте результаты в патчи, которые вы проверяете и применяете.
- [Code Review](https://code.claude.com/docs/ru/code-review.md): Настройте автоматизированные проверки PR, которые выявляют логические ошибки, уязвимости безопасности и регрессии с помощью многоагентного анализа всей вашей кодовой базы
- [Claude Code GitHub Actions](https://code.claude.com/docs/ru/github-actions.md): Запускайте Claude Code в рабочих процессах GitHub Actions для ответа на упоминания @claude, автоматизации задач и преобразования issues в pull requests
- [Использование Claude Code GitHub Actions с облачными провайдерами](https://code.claude.com/docs/ru/github-actions-cloud-providers.md): Запускайте Claude Code GitHub Actions через Amazon Bedrock, Google Cloud's Agent Platform или Microsoft Foundry вместо Claude API
- [Claude Code с GitHub Enterprise Server](https://code.claude.com/docs/ru/github-enterprise-server.md): Подключите Claude Code к вашему самостоятельно размещённому экземпляру GitHub Enterprise Server для облачных сессий, проверки кода и маркетплейсов плагинов.
- [Claude Code GitLab CI/CD](https://code.claude.com/docs/ru/gitlab-ci-cd.md): Узнайте об интеграции Claude Code в ваш рабочий процесс разработки с GitLab CI/CD

### Разработка с Claude Code

#### Агенты и параллельная работа

- [Запуск агентов параллельно](https://code.claude.com/docs/ru/agents.md): Сравните способы, которыми Claude Code может выполнять несколько задач одновременно: подагенты, представление агентов, команды агентов, динамические рабочие процессы и проекты.
- [Создание пользовательских subagents](https://code.claude.com/docs/ru/sub-agents.md): Создавайте и используйте специализированные AI subagents в Claude Code для рабочих процессов, ориентированных на конкретные задачи, и улучшенного управления контекстом.
- [Управление несколькими агентами с помощью agent view](https://code.claude.com/docs/ru/agent-view.md): Отправляйте и управляйте множеством сеансов Claude Code с одного экрана. Agent view показывает, что делает каждый сеанс и какие из них требуют вашего ввода.
- [Координируйте команды сеансов Claude Code](https://code.claude.com/docs/ru/agent-teams.md): Координируйте несколько экземпляров Claude Code, работающих вместе как команда, с общими задачами, обменом сообщениями между агентами и централизованным управлением.
- [Отправляйте сообщения другим сеансам Claude Code](https://code.claude.com/docs/ru/cross-session-messaging.md): Позвольте Claude перечислить и отправить сообщения другим вашим сеансам Claude Code на этом компьютере, а также достичь ваши сеансы на других компьютерах или в веб-версии.
- [Оркестрируйте множество подагентов с помощью динамических workflows](https://code.claude.com/docs/ru/workflows.md): Dynamic workflows оркестрируют множество подагентов из скрипта, который пишет Claude, и вы можете его переиспользовать. Используйте их для аудитов кодовой базы, крупных миграций и перекрёстной проверки исследований.
- [Запуск параллельных сеансов с worktrees](https://code.claude.com/docs/ru/worktrees.md): Изолируйте параллельные сеансы Claude Code в отдельных git worktrees, чтобы изменения не конфликтовали. Охватывает флаг `--worktree`, изоляцию subagent, `.worktreeinclude`, очистку и hooks для не-git VCS.

#### MCP

- [Подключение к серверам MCP](https://code.claude.com/docs/ru/mcp-quickstart.md): Добавьте сервер MCP в Claude Code, проверьте соединение и найдите конфигурацию на диске.
- [Подключите Claude Code к инструментам через MCP](https://code.claude.com/docs/ru/mcp.md): Узнайте, как подключить Claude Code к вашим инструментам с помощью Model Context Protocol.

#### Навыки

- [Расширение Claude с помощью skills](https://code.claude.com/docs/ru/skills.md): Создавайте, управляйте и делитесь skills для расширения возможностей Claude в Claude Code. Включает пользовательские команды и встроенные skills.

#### Артефакты

- [Поделитесь выходом сеанса как артефактами](https://code.claude.com/docs/ru/artifacts.md): Артефакты превращают работу Claude Code в живые интерактивные страницы на claude.ai, которые вы можете хранить в приватном режиме, делиться с вашей организацией или публиковать по общедоступной ссылке.

#### Автоматизация

- [Автоматизация действий с помощью hooks](https://code.claude.com/docs/ru/hooks-guide.md): Запускайте команды оболочки автоматически, когда Claude Code редактирует файлы, завершает задачи или требует ввода. Форматируйте код, отправляйте уведомления, проверяйте команды и применяйте правила проекта.
- [Отправка событий в активный сеанс через каналы](https://code.claude.com/docs/ru/channels.md): Используйте каналы для отправки сообщений, оповещений и вебхуков в ваш сеанс Claude Code из MCP-сервера. Перенаправляйте результаты CI, сообщения чата и события мониторинга, чтобы Claude мог реагировать, пока вас нет.
- [Запуск подсказок по расписанию](https://code.claude.com/docs/ru/scheduled-tasks.md): Используйте /loop и инструменты планирования cron для повторного запуска подсказок, опроса статуса или установки одноразовых напоминаний в сеансе Claude Code.
- [Держите Claude в работе над целью](https://code.claude.com/docs/ru/goal.md): Установите условие завершения с помощью /goal, и Claude будет работать над его достижением, пока условие не будет выполнено, модель не сочтет его невозможным или ошибка, которую вам нужно исправить, не очистит цель.
- [Запуск Claude Code программно](https://code.claude.com/docs/ru/headless.md): Используйте Agent SDK для программного запуска Claude Code из CLI, Python или TypeScript.
- [Запуск сеансов по ссылкам](https://code.claude.com/docs/ru/deep-links.md): Откройте сеанс терминала Claude Code по URL. Встраивайте ссылки `claude-cli://` в runbook'и, оповещения и панели мониторинга, чтобы при клике открывался Claude Code в нужном репозитории с нужным приглашением.

#### Руководства

- [Настройка Claude Code в монорепозитории или большой кодовой базе](https://code.claude.com/docs/ru/large-codebases.md): Настройте Claude Code для монорепозиториев и больших однодеревных кодовых баз с вложенными файлами CLAUDE.md, разреженными worktrees, интеллектом кода и навыками для каждого пакета, чтобы Claude оставался сосредоточенным на коде, над которым вы работаете.

#### Устранение неполадок

- [Устранение неполадок при установке и входе](https://code.claude.com/docs/ru/troubleshoot-install.md): Исправьте ошибки command not found, PATH, разрешений, сети и аутентификации при установке или входе в Claude Code.
- [Troubleshooting](https://code.claude.com/docs/ru/troubleshooting.md): Исправьте высокое использование CPU или памяти, зависания, auto-compact thrashing и проблемы поиска в Claude Code, и найдите нужную страницу для других проблем.
- [Отладка конфигурации](https://code.claude.com/docs/ru/debug-your-config.md): Диагностируйте, почему CLAUDE.md, параметры, hooks, MCP серверы или skills не вступают в силу. Используйте /context, /doctor, /hooks и /mcp, чтобы увидеть, что действительно загрузилось.
- [Справочник по ошибкам](https://code.claude.com/docs/ru/errors.md): Найдите сообщения об ошибках Claude Code с объяснением их значения и способов исправления.

### Плагины

#### Плагины

- [Обзор plugins](https://code.claude.com/docs/ru/plugins/overview.md): Узнайте, что такое Claude Code plugin, когда вам нужен plugin вместо отдельного skill или MCP server, и какую страницу прочитать для установки или создания plugin.

#### Использовать plugins

- [Установка и управление плагинами](https://code.claude.com/docs/ru/plugins/install.md): Установите плагины Claude Code из маркетплейса на любой поверхности, которую вы используете, выберите область установки и обновляйте или удаляйте их позже.
- [Code intelligence plugins](https://code.claude.com/docs/ru/plugins/code-intelligence.md): Установите плагин языкового сервера, чтобы Claude видел ошибки типов после редактирования и навигировал по коду по символам, и ответьте на диалог рекомендации плагина LSP.
- [Безопасность и доверие к плагинам](https://code.claude.com/docs/ru/plugins/security.md): Решите, доверять ли плагину перед его установкой: от того, что плагин может делать на вашем компьютере, до того, как его проверить и удалить.

#### Создание плагинов

- [Создание плагина Claude Code](https://code.claude.com/docs/ru/plugins/create.md): Создайте свой первый плагин Claude Code с нуля, протестируйте его без marketplace и преобразуйте существующую конфигурацию .claude/.
- [Добавление компонентов в плагин](https://code.claude.com/docs/ru/plugins/components.md): Добавляйте skills, hooks, MCP серверы и все остальные типы компонентов в плагин Claude Code с примерами, которые проходят валидацию для каждого.
- [Зависимости плагинов](https://code.claude.com/docs/ru/plugins/dependencies.md): Объявляйте плагины, от которых зависит ваш плагин, с диапазонами версий, такими как ^1.2, и узнайте, как Claude Code устанавливает, разрешает и удаляет их.
- [Тестирование plugins с помощью evals](https://code.claude.com/docs/ru/plugin-evals.md): Напишите eval-кейсы для вашего Claude Code plugin, запустите их с помощью claude plugin eval, оцените результаты, сравните с базовым вариантом без plugin и установите ограничение CI на основе оценки.
- [Публикация и распространение плагина](https://code.claude.com/docs/ru/plugins/publish.md): Опубликуйте плагин Claude Code через собственный маркетплейс или маркетплейс сообщества Anthropic с предварительным контрольным списком и информацией о том, как пользователи получают обновления.
- [Измерение стоимости и использования плагина](https://code.claude.com/docs/ru/plugins/measure.md): Измерьте стоимость токенов плагина Claude Code, узнайте, используют ли его люди, и выберите события телеметрии для вопросов плагинов на уровне организации.
- [Рекомендуйте ваш plugin из вашего CLI](https://code.claude.com/docs/ru/plugins/cli-hints.md): Предложите пользователям Claude Code установить ваш plugin из официального marketplace, отправив тег claude-code-hint из вашего CLI или SDK.

#### Запустить marketplace

- [Создание marketplace](https://code.claude.com/docs/ru/plugins/create-marketplace.md): Создайте plugin marketplace из файла marketplace.json и протестируйте его локально перед размещением.
- [Размещение и поддержка маркетплейса](https://code.claude.com/docs/ru/plugins/host-marketplace.md): Опубликуйте маркетплейс плагинов, где пользователи смогут его найти, предоставьте доступ к приватному маркетплейсу и выпускайте обновления и переименования без нарушения установок.
- [Рекомендуйте plugins для вашей организации](https://code.claude.com/docs/ru/plugins/relevance.md): Добавьте блок relevance к записям marketplace plugins, чтобы Claude Code предлагал их, когда работа пользователя совпадает, и разрешите marketplace в управляемых параметрах.

#### Управление плагинами вашей организации

- [Управление плагинами Claude Code для вашей организации](https://code.claude.com/docs/ru/plugins/org.md): Контролируйте, какие плагины Claude Code устанавливает и разрешает на каждой машине в вашей организации через управляемые параметры.

#### Устранение неполадок

- [Устранение неполадок плагинов](https://code.claude.com/docs/ru/plugins/troubleshooting.md): Исправьте ошибки плагинов в Claude Code. Найдите точное сообщение об ошибке, сгруппированное по этапам от запуска /plugin до установки и политики организации.
- [Справочник по загрузке плагинов](https://code.claude.com/docs/ru/plugins/loading.md): Отследите, откуда Claude Code загружает каждый плагин, какой файл параметров решает, загружается ли он, и почему обновление ничего не изменило.

#### Справочник

- [Справочник манифеста плагина](https://code.claude.com/docs/ru/plugins/manifest-reference.md): Полный справочник по plugin.json: каждое поле с его типом и значением по умолчанию, принятые формы путей и схемы userConfig и переменных окружения.
- [Справочник Marketplace](https://code.claude.com/docs/ru/plugins/marketplace-reference.md): Полный справочник по полям marketplace.json, записям плагинов и объектам источников плагинов и marketplace, с указанием того, где каждый из них действителен.
- [Справочник команд плагинов](https://code.claude.com/docs/ru/plugins/cli-reference.md): Полный справочник по командам оболочки claude plugin, /plugin и /reload-plugins в сеансе, а также флагам, которые загружают плагин на один сеанс.

### Администрирование

#### Настройка и доступ

- [Настройка Claude Code для вашей организации](https://code.claude.com/docs/ru/admin-setup.md): Карта решений для администраторов, развертывающих Claude Code, охватывающая поставщиков API, управляемые параметры, принудительное применение политики, мониторинг использования и обработку данных.
- [Расширенная настройка](https://code.claude.com/docs/ru/setup.md): Системные требования, установка для конкретной платформы, управление версиями и удаление Claude Code.
- [Аутентификация](https://code.claude.com/docs/ru/authentication.md): Войдите в Claude Code и настройте аутентификацию для отдельных пользователей, команд и организаций.
- [Развертывание управляемых параметров](https://code.claude.com/docs/ru/managed-settings.md): Развертывайте управляемые параметры на машину каждого разработчика: механизмы доставки для каждой ОС, как Claude Code объединяет управляемые источники и как проверить применение политики.
- [Настройка параметров, управляемых сервером](https://code.claude.com/docs/ru/server-managed-settings.md): Централизованно настраивайте Claude Code для вашей организации через параметры, доставляемые сервером, без необходимости инфраструктуры управления устройствами.
- [Контролируйте доступ к серверам MCP для вашей организации](https://code.claude.com/docs/ru/managed-mcp.md): Ограничьте, какие серверы MCP пользователи могут добавлять или подключать, или предоставьте серверы каждому пользователю с помощью управляемых файлов конфигурации, управляемых параметров, списков разрешений и списков запретов.
- [Настройка режима auto](https://code.claude.com/docs/ru/auto-mode-config.md): Сообщите классификатору режима auto, какие репозитории, бакеты и домены доверяет ваша организация. Установите контекст окружения, переопределите правила блокировки и разрешения по умолчанию и проверьте вашу эффективную конфигурацию с помощью подкоманд CLI auto-mode.

#### Развертывание

- [Обзор корпоративного развертывания](https://code.claude.com/docs/ru/third-party-integrations.md): Узнайте, как Claude Code может интегрироваться с различными сторонними сервисами и инфраструктурой для удовлетворения требований корпоративного развертывания.
- [Доступность функций](https://code.claude.com/docs/ru/feature-availability.md): Сравните, какие функции Claude Code доступны в планах подписки Anthropic, Anthropic Console, Amazon Bedrock, Claude Platform на AWS, Google Cloud's Agent Platform и Microsoft Foundry.
- [Claude Code на Amazon Bedrock](https://code.claude.com/docs/ru/amazon-bedrock.md): Узнайте о настройке Claude Code через Amazon Bedrock, включая установку, конфигурацию IAM и устранение неполадок.
- [Claude Code на Claude Platform on AWS](https://code.claude.com/docs/ru/claude-platform-on-aws.md): Настройте Claude Code для использования API Claude, управляемого Anthropic, с аутентификацией AWS, контролем доступа IAM и выставлением счетов через AWS Marketplace.
- [Claude Code на Google Cloud's Agent Platform](https://code.claude.com/docs/ru/google-vertex-ai.md): Узнайте о настройке Claude Code через Google Cloud's Agent Platform, ранее известную как Vertex AI, включая установку, конфигурацию IAM и устранение неполадок.
- [Claude Code на Microsoft Foundry](https://code.claude.com/docs/ru/microsoft-foundry.md): Узнайте о настройке Claude Code через Microsoft Foundry, включая установку, конфигурацию и устранение неполадок.
- [Конфигурация сети для предприятия](https://code.claude.com/docs/ru/network-config.md): Настройте Claude Code для корпоративных сред с прокси-серверами, пользовательскими центрами сертификации (CA) и взаимной аутентификацией Transport Layer Security (mTLS).
- [Запуск Claude Code через корпоративный launcher](https://code.claude.com/docs/ru/corporate-launcher.md): Маршрутизируйте процессы, которые Claude Code запускает из собственного бинарного файла, включая фоновый сервис и каждый сеанс agent view, через требуемый launcher с помощью CLAUDE_CODE_PROCESS_WRAPPER или параметра processWrapper.
- [Контейнеры разработки](https://code.claude.com/docs/ru/devcontainer.md): Запустите Claude Code внутри контейнера разработки для согласованных, изолированных сред во всей вашей команде.

#### Шлюзы

- [Запуск Claude Code через шлюз](https://code.claude.com/docs/ru/gateways.md): Маршрутизируйте Claude Code через самостоятельно размещаемый шлюз для централизованного управления учетными данными, отслеживания использования и контроля затрат. Охватывает архитектуру, шлюз Claude apps от Anthropic и использование других продуктов шлюзов.

##### Шлюз приложений Claude

- [Шлюз Claude apps для Amazon Bedrock, Claude Platform на AWS, Google Cloud и Microsoft Foundry](https://code.claude.com/docs/ru/claude-apps-gateway.md): Запускайте Claude Code через Amazon Bedrock, Claude Platform на AWS, Google Cloud или Microsoft Foundry за самостоятельно размещаемым шлюзом с входом SSO, доступом к моделям по группам и телеметрией OTLP.
- [Конфигурация Claude apps gateway](https://code.claude.com/docs/ru/claude-apps-gateway-config.md): Справочник по каждому параметру gateway.yaml: listener и TLS, OIDC, session, хранилище Postgres, upstreams Amazon Bedrock, Claude Platform на AWS, Agent Platform Google Cloud и Microsoft Foundry, маршрутизация моделей, управляемые политики и телеметрия.
- [Лимиты расходов Claude apps gateway](https://code.claude.com/docs/ru/claude-apps-gateway-spend-limits.md): Ограничьте расходы каждого разработчика через Claude apps gateway по дням, неделям или месяцам. Установите лимиты с помощью Admin API, и шлюз будет их соблюдать в реальном времени при каждом запросе.
- [Развертывание и эксплуатация шлюза Claude apps](https://code.claude.com/docs/ru/claude-apps-gateway-deploy.md): Зарегистрируйте шлюз в вашем поставщике идентификации, создайте контейнер, разверните на Kubernetes или Cloud Run и управляйте им: проверки здоровья, ротация секретов, обновления и безопасность.
- [Развёртывание Claude apps gateway на AWS](https://code.claude.com/docs/ru/claude-apps-gateway-on-aws.md): Практический пример запуска Claude apps gateway на AWS: ECS Fargate или EKS, Amazon RDS для PostgreSQL, AWS Secrets Manager и аутентификация на основе IAM-роли к Amazon Bedrock.
- [Развертывание Claude apps gateway на Google Cloud](https://code.claude.com/docs/ru/claude-apps-gateway-on-gcp.md): Практический пример запуска Claude apps gateway на Google Cloud: Cloud Run или GKE, Cloud SQL для PostgreSQL, Secret Manager и аутентификация через сервисный аккаунт для Agent Platform Google Cloud.

##### Другие шлюзы

- [Другие LLM gateways](https://code.claude.com/docs/ru/llm-gateway.md): Маршрутизируйте Claude Code через LLM gateway, который уже запускает ваша организация. Охватывает подключение Claude Code к шлюзу, развертывание шлюза для вашей организации и то, что Claude Code отправляет на шлюз.
- [Подключение Claude Code к шлюзу LLM](https://code.claude.com/docs/ru/llm-gateway-connect.md): Направьте Claude Code на шлюз LLM вашей организации. Проверьте, уже ли администратор его настроил, или установите базовый URL и учетные данные самостоятельно, затем проверьте соединение и исправьте ошибки шлюза.
- [Развертывание LLM-шлюза для вашей организации](https://code.claude.com/docs/ru/llm-gateway-rollout.md): Разверните продукт шлюза для Claude Code: настройте его для перенаправления того, что отправляет Claude Code, выдайте учетные данные разработчика, распределите конфигурацию через управляемые параметры и проверьте развертывание.
- [Руководство совместимости Claude Code gateway](https://code.claude.com/docs/ru/llm-gateway-protocol.md): Поддерживайте совместимость LLM gateway с Claude Code: конечные точки, которые он вызывает, заголовки и поля тела, которые необходимо передавать, и что перестает работать при их удалении.

#### Использование и затраты

- [Мониторинг](https://code.claude.com/docs/ru/monitoring-usage.md): Узнайте, как включить и настроить OpenTelemetry для Claude Code.
- [Эффективное управление затратами](https://code.claude.com/docs/ru/costs.md): Отслеживайте использование токенов, устанавливайте лимиты расходов команды и снижайте затраты Claude Code с помощью управления контекстом, выбора модели, настроек расширенного мышления и предварительной обработки hooks.
- [Отслеживание использования команды с помощью аналитики](https://code.claude.com/docs/ru/analytics.md): Просмотрите метрики использования Claude Code, отслеживайте внедрение и измеряйте скорость разработки на панели аналитики.

#### Безопасность и данные

- [Безопасность](https://code.claude.com/docs/ru/security.md): Узнайте о защитных механизмах Claude Code и лучших практиках безопасного использования.
- [Использование данных](https://code.claude.com/docs/ru/data-usage.md): Узнайте о политике использования данных Anthropic для Claude
- [Нулевое хранение данных](https://code.claude.com/docs/ru/zero-data-retention.md): Узнайте о нулевом хранении данных (ZDR) для Claude Code, доступном для квалифицированных учетных записей на Claude for Enterprise, включая область применения, отключенные функции и способы запроса активации.

#### Внедрение

- [Коммуникационный набор](https://code.claude.com/docs/ru/communications-kit.md): Объявления о запуске, сообщения для капельной кампании и ответы на часто задаваемые вопросы для развертывания Claude Code в вашей инженерной организации.
- [Набор инструментов чемпиона](https://code.claude.com/docs/ru/champion-kit.md): Руководство для инженеров, продвигающих Claude Code внутри организации: что делиться, как отвечать на вопросы и как увеличить внедрение в вашей команде.

### Конфигурация

#### Параметры

- [Файлы параметров и приоритет](https://code.claude.com/docs/ru/settings.md): Измените параметры Claude Code, выберите область, к которой принадлежит ключ, проверьте изменение и узнайте, какое значение Claude Code использует, когда ключ установлен в нескольких местах.
- [Все параметры](https://code.claude.com/docs/ru/settings-reference.md): Полный справочник по каждому ключу settings.json в Claude Code: где находится каждый ключ, его тип и значение по умолчанию, а также готовый к использованию пример и индекс всех ключей.
- [Примеры файлов settings](https://code.claude.com/docs/ru/settings-example.md): Реалистичные файлы settings.json для разработчика, команды и организации: скопируйте один, оставьте нужные вам ключи и измените значения.

#### Разрешения и sandboxing

- [Настройка разрешений](https://code.claude.com/docs/ru/permissions.md): Контролируйте, что Claude Code может использовать и делать, с помощью детальных правил разрешений, режимов и управляемых политик.
- [Выберите режим разрешений](https://code.claude.com/docs/ru/permission-modes.md): Контролируйте, будет ли Claude просить разрешение перед редактированием файлов или выполнением команд. Переключайте режимы с помощью Shift+Tab в CLI, индикатора режима в VS Code или селектора режима в Desktop.
- [Настройка изолированного инструмента Bash](https://code.claude.com/docs/ru/sandboxing.md): Узнайте, как изолированный инструмент Bash в Claude Code обеспечивает изоляцию файловой системы и сети для более безопасного и автономного выполнения агента.
- [Выберите среду sandbox](https://code.claude.com/docs/ru/sandbox-environments.md): Сравните варианты sandbox для Claude Code: встроенный инструмент Bash в песочнице, среда выполнения sandbox, контейнеры разработки, Docker и виртуальные машины. Выберите правильную изоляцию для вашей модели угроз.

#### Окружения

- [Настройка облачных сред](https://code.claude.com/docs/ru/cloud-environments.md): Настройте облачные среды для облачных сеансов Claude Code: уровни доступа в сети, переменные окружения, скрипты настройки и кэширование среды.

##### Самостоятельно размещаемые окружения

- [Самостоятельно размещаемые окружения](https://code.claude.com/docs/ru/self-hosted-environments.md): Запускайте сеансы Claude Code в облаке на инфраструктуре, которой вы управляете: настройте самостоятельно размещаемое окружение, разверните runners и маршрутизируйте сеансы на собственные вычислительные ресурсы.
- [Быстрый старт для самостоятельно размещаемых окружений](https://code.claude.com/docs/ru/self-hosted-environments-quickstart.md): Настройте своё первое самостоятельно размещаемое окружение: установите Claude Code, создайте окружение, запустите runner и маршрутизируйте сеанс на него.
- [Развертывание самостоятельно размещаемых окружений в production](https://code.claude.com/docs/ru/self-hosted-environments-deploy.md): Запуск самостоятельно размещаемых runners в production: усиление безопасности, контроль сетевого исходящего трафика, учетные данные git, рецепты Kubernetes и Compose, а также устранение неполадок.
- [Настройка сеансов в самостоятельно размещаемых окружениях](https://code.claude.com/docs/ru/self-hosted-environments-configuration.md): Настройте сеансы самостоятельно размещаемого окружения с помощью скриптов-оболочек для учетных данных для каждого сеанса, хуков жизненного цикла и порождения средств выполнения по требованию.
- [Тестирование самостоятельно размещённых сред от начала до конца](https://code.claude.com/docs/ru/self-hosted-environments-testing.md): Проверьте образ самостоятельно размещённого runner из CI: отправьте сеанс через CLI, прочитайте ответы Claude через hook Stop и напишите скрипт для полного цикла.
- [Справочник самостоятельно размещаемых окружений](https://code.claude.com/docs/ru/self-hosted-environments-reference.md): Полный справочник по самостоятельно размещаемому runner и orchestrator: флаги CLI, переменные окружения и метрики Prometheus.
- [Проверка идентификации сеанса в самостоятельно размещаемых окружениях](https://code.claude.com/docs/ru/self-hosted-environments-identity.md): Проверьте JWT CLAUDE_CODE_SESSION_ACCESS_TOKEN, чтобы сервисы в вашей сети могли доверять запросам от сеансов в вашем самостоятельно размещаемом окружении.

#### Модель и ответы

- [Конфигурация модели](https://code.claude.com/docs/ru/model-config.md): Настройте, какую модель использует Claude Code, уровни усилий, расширенный контекст и окно auto-compact
- [Ускорьте ответы с помощью быстрого режима](https://code.claude.com/docs/ru/fast-mode.md): Получайте более быстрые ответы Opus в Claude Code, включив быстрый режим.
- [Эскалация сложных решений с помощью инструмента advisor](https://code.claude.com/docs/ru/advisor.md): Объедините вашу основную модель с более мощной моделью-советником, которую Claude консультирует в ключевые моменты выполнения задачи.
- [Output styles](https://code.claude.com/docs/ru/output-styles.md): Измените роль, тон и формат ответов Claude Code с помощью встроенного стиля вывода, такого как Concise или Explanatory, или напишите собственный стиль.

#### Интерфейс

- [Настройте ваш терминал для Claude Code](https://code.claude.com/docs/ru/terminal-config.md): Исправьте Shift+Enter для новых строк, получайте звуковой сигнал терминала при завершении Claude, настройте tmux, сопоставьте цветовую схему и включите режим Vim в CLI Claude Code.
- [Полноэкранный рендеринг](https://code.claude.com/docs/ru/fullscreen.md): Включите более плавный режим рендеринга без мерцания с поддержкой мыши и стабильным использованием памяти в длительных разговорах.
- [Использование Claude Code с программой чтения с экрана](https://code.claude.com/docs/ru/accessibility.md): Настройте Claude Code для программ чтения с экрана, таких как VoiceOver и NVDA, а также параметры для увеличения экрана, уменьшения движения и тем, удобных для дальтоников.
- [Голосовой ввод](https://code.claude.com/docs/ru/voice-dictation.md): Произносите свои запросы в Claude Code CLI с помощью удержания или нажатия для записи голоса.
- [Настройка строки состояния](https://code.claude.com/docs/ru/statusline.md): Настройте пользовательскую строку состояния для мониторинга использования контекстного окна, затрат и статуса git в Claude Code
- [Настройка сочетаний клавиш](https://code.claude.com/docs/ru/keybindings.md): Настройте сочетания клавиш в Claude Code с помощью файла конфигурации keybindings.

### Справочник

#### Справочник

- [Справочник CLI](https://code.claude.com/docs/ru/cli-reference.md): Полный справочник по интерфейсу командной строки Claude Code, включая команды и флаги.
- [Команды](https://code.claude.com/docs/ru/commands.md): Полный справочник команд, доступных в Claude Code, включая встроенные команды и встроенные skills.
- [Переменные окружения](https://code.claude.com/docs/ru/env-vars.md): Справочник по переменным окружения, которые управляют поведением Claude Code.
- [Справочник инструментов](https://code.claude.com/docs/ru/tools-reference.md): Полный справочник по инструментам, которые может использовать Claude Code, включая требования к разрешениям и поведение каждого инструмента.
- [Интерактивный режим](https://code.claude.com/docs/ru/interactive-mode.md): Полный справочник по сочетаниям клавиш, режимам ввода и интерактивным функциям в сеансах Claude Code.
- [Checkpointing](https://code.claude.com/docs/ru/checkpointing.md): Отслеживайте, перематывайте и суммируйте правки и беседу Claude для управления состоянием сеанса.
- [Справочник по hooks](https://code.claude.com/docs/ru/hooks.md): Справочник по событиям hook Claude Code, схеме конфигурации, форматам JSON входа/выхода, кодам выхода, асинхронным hooks, HTTP hooks, prompt hooks и MCP tool hooks.
- [Справочник по каналам](https://code.claude.com/docs/ru/channels-reference.md): Создайте MCP-сервер, который отправляет вебхуки, оповещения и сообщения чата в сеанс Claude Code. Справочник по контракту канала: объявление возможностей, события уведомлений, инструменты ответа, проверка отправителя и трансляция разрешений.

#### Глоссарий

- [Глоссарий](https://code.claude.com/docs/ru/glossary.md): Определения терминологии Claude Code. Узнайте, что означают agentic loop, compaction, CLAUDE.md, hooks, subagents, MCP и другие основные концепции.

### Agent SDK

#### Agent SDK

- [Обзор Agent SDK](https://code.claude.com/docs/ru/agent-sdk/overview.md): Создавайте производственные AI-агентов с Claude Code как библиотеку
- [Быстрый старт](https://code.claude.com/docs/ru/agent-sdk/quickstart.md): Начните работу с Python или TypeScript Agent SDK для создания AI-агентов, которые работают автономно
- [Миграция на Claude Agent SDK](https://code.claude.com/docs/ru/agent-sdk/migration-guide.md): Руководство по миграции Claude Code TypeScript и Python SDK на Claude Agent SDK
- [Устранение неполадок Agent SDK](https://code.claude.com/docs/ru/agent-sdk/troubleshooting.md): Исправьте ошибки Agent SDK при сбое запуска Claude Code CLI, выходе процесса CLI или получении успешного результата без структурированного вывода.

#### Создание агентов

- [Настройка вашего агента](https://code.claude.com/docs/ru/agent-sdk/configuration.md): Настройте сеансы Agent SDK: составьте объект параметров, установите модель, окружение и ограничения, и найдите страницу каждого параметра функции.
- [Примеры](https://code.claude.com/docs/ru/agent-sdk/examples.md): Найдите полный, готовый к запуску проект Agent SDK или пошаговый рецепт из Claude Cookbook, который соответствует тому, что вы хотите создать.

#### Основные концепции

- [Как работает цикл агента](https://code.claude.com/docs/ru/agent-sdk/agent-loop.md): Поймите жизненный цикл сообщений, выполнение инструментов, контекстное окно и архитектуру, которые питают ваших агентов SDK.
- [Использование функций Claude Code в SDK](https://code.claude.com/docs/ru/agent-sdk/claude-code-features.md): Загружайте инструкции проекта, skills, hooks и другие функции Claude Code в ваши SDK-агентов.
- [Работа с сеансами](https://code.claude.com/docs/ru/agent-sdk/sessions.md): Как сеансы сохраняют историю разговора агента, и когда использовать continue, resume и fork для возврата к предыдущему запуску.
- [Сохранение сеансов во внешнее хранилище](https://code.claude.com/docs/ru/agent-sdk/session-storage.md): Зеркалируйте стенограммы сеансов Agent SDK в собственное хранилище объектов, хранилище ключ-значение или базу данных, чтобы другие хосты могли возобновить ваши сеансы.

#### Ввод и вывод

- [Streaming Input](https://code.claude.com/docs/ru/agent-sdk/streaming-vs-single-mode.md): Понимание двух режимов ввода для Claude Agent SDK и когда использовать каждый
- [Обработка одобрений и пользовательского ввода](https://code.claude.com/docs/ru/agent-sdk/user-input.md): Выводите запросы на одобрение Claude и уточняющие вопросы пользователям, а затем возвращайте их решения в SDK.
- [Потоковая передача ответов в реальном времени](https://code.claude.com/docs/ru/agent-sdk/streaming-output.md): Получайте ответы в реальном времени от Agent SDK по мере поступления текста и вызовов инструментов
- [Получение структурированного вывода от агентов](https://code.claude.com/docs/ru/agent-sdk/structured-outputs.md): Возвращайте валидированный JSON из рабочих процессов агентов, используя JSON Schema, Zod или Pydantic. Получайте типобезопасные структурированные данные после многоходового использования инструментов.

#### Расширить с помощью инструментов

- [Предоставьте Claude пользовательские инструменты](https://code.claude.com/docs/ru/agent-sdk/custom-tools.md): Определите пользовательские инструменты с помощью встроенного MCP-сервера Agent SDK, чтобы Claude мог вызывать ваши функции, обращаться к вашим API и выполнять операции, специфичные для вашей области.
- [Подключение к внешним инструментам с помощью MCP](https://code.claude.com/docs/ru/agent-sdk/mcp.md): Настройте MCP серверы для расширения вашего агента внешними инструментами. Охватывает типы транспорта, поиск инструментов для больших наборов инструментов, аутентификацию и обработку ошибок.
- [Масштабирование на множество инструментов с помощью поиска инструментов](https://code.claude.com/docs/ru/agent-sdk/tool-search.md): Масштабируйте вашего агента на тысячи инструментов, обнаруживая и загружая только необходимое по требованию.
- [Subagents в SDK](https://code.claude.com/docs/ru/agent-sdk/subagents.md): Определяйте и вызывайте subagents для изоляции контекста, параллельного выполнения задач и применения специализированных инструкций в приложениях Claude Agent SDK.

#### Настройка поведения

- [Изменение системных подсказок](https://code.claude.com/docs/ru/agent-sdk/modifying-system-prompts.md): Выберите между предустановкой `claude_code` и пользовательской системной подсказкой, и настройте поведение с помощью CLAUDE.md, стилей вывода, append или полностью пользовательской подсказки.
- [Расширьте агентов с помощью skills](https://code.claude.com/docs/ru/agent-sdk/skills.md): Управляйте тем, какие skills может вызывать Claude в сеансах Claude Agent SDK, отправляйте команды по имени и создавайте skills, которые обнаруживают ваши сеансы
- [Plugins в SDK](https://code.claude.com/docs/ru/agent-sdk/plugins.md): Загружайте пользовательские plugins для расширения Claude Code с помощью skills, agents, hooks и MCP серверов через Agent SDK

#### Управление и наблюдаемость

- [Настройка разрешений](https://code.claude.com/docs/ru/agent-sdk/permissions.md): Контролируйте, как ваш агент использует инструменты, с помощью режимов разрешений, hooks и декларативных правил разрешения/запрета.
- [Перехватывайте и контролируйте поведение агента с помощью hooks](https://code.claude.com/docs/ru/agent-sdk/hooks.md): Перехватывайте и настраивайте поведение агента в ключевых точках выполнения с помощью hooks
- [Отмотка изменений файлов с помощью checkpointing](https://code.claude.com/docs/ru/agent-sdk/file-checkpointing.md): Отслеживайте изменения файлов во время сеансов агента и восстанавливайте файлы в любое предыдущее состояние
- [Отслеживание затрат и использования](https://code.claude.com/docs/ru/agent-sdk/cost-tracking.md): Узнайте, как отслеживать использование токенов, оценивать затраты и настраивать кэширование подсказок с помощью Claude Agent SDK.
- [Наблюдаемость с OpenTelemetry](https://code.claude.com/docs/ru/agent-sdk/observability.md): Экспортируйте трассировки, метрики и события из Agent SDK в ваш бэкенд наблюдаемости с помощью OpenTelemetry.
- [Отслеживание задач](https://code.claude.com/docs/ru/agent-sdk/todo-tracking.md): Отслеживайте задачи в сеансах Agent SDK и отображайте прогресс Claude в вашем приложении с помощью структурированных вызовов инструментов

#### Развертывание

- [Размещение Agent SDK](https://code.claude.com/docs/ru/agent-sdk/hosting.md): Развертывание Agent SDK в production: архитектура подпроцессов, сохранение сеансов, масштабирование, наблюдаемость и изоляция нескольких арендаторов для Docker, Kubernetes и поставщиков песочниц.
- [Безопасное развертывание AI-агентов](https://code.claude.com/docs/ru/agent-sdk/secure-deployment.md): Руководство по защите развертываний Claude Code и Agent SDK с использованием изоляции, управления учетными данными и сетевых элементов управления

#### Справочные материалы SDK

- [Справочник Agent SDK - TypeScript](https://code.claude.com/docs/ru/agent-sdk/typescript.md): Полный справочник API для TypeScript Agent SDK, включая все функции, типы и интерфейсы.
- [TypeScript SDK V2 session API (removed)](https://code.claude.com/docs/ru/agent-sdk/typescript-v2-preview.md): Справочник по удалённому V2 TypeScript Agent SDK session API с паттернами отправки/потока на основе сессий для многооборотных разговоров.
- [Справочник Agent SDK - Python](https://code.claude.com/docs/ru/agent-sdk/python.md): Полный справочник API для Python Agent SDK, включая все функции, типы и классы.

### Что нового

#### Что нового

- [Что нового](https://code.claude.com/docs/ru/whats-new/index.md): Еженедельный дайджест примечательных функций Claude Code с примерами кода, демонстрациями и контекстом о том, почему они важны.
- [Неделя 37 · 7–11 сентября 2026](https://code.claude.com/docs/ru/whats-new/2026-w37.md): Тестируйте свои плагины с помощью claude plugin eval и выводите панели Claude Code Desktop в отдельные окна.
- [Неделя 36 · 31 августа – 4 сентября 2026](https://code.claude.com/docs/ru/whats-new/2026-w36.md): Переключитесь на Claude Fable 5.1, запустите компьютерное управление в фоновом режиме на Desktop и смотрите правки Claude в живой панели /diff.
- [Неделя 35 · 24–28 августа 2026](https://code.claude.com/docs/ru/whats-new/2026-w35.md): Возобновляйте сеансы терминала в приложении Claude Code Desktop, просматривайте отчеты об обратной связи, которые Claude подготавливает для вас, и начните сеанс в режиме ограничений.
- [Неделя 34 · 17–21 августа 2026](https://code.claude.com/docs/ru/whats-new/2026-w34.md): Создавайте редактируемые UI-макеты с помощью навыка /design, установите стиль вывода Concise и запустите сеанс Claude Code на своей машине со своего телефона.
- [Неделя 33 · 10–14 августа 2026](https://code.claude.com/docs/ru/whats-new/2026-w33.md): Claude Code Desktop автоматически продолжает работу после сброса лимита использования, режим fork включается по умолчанию, а запросы на слияние GitLab и маркетплейсы присоединяются к GitHub.
- [Неделя 32 · 3–7 августа 2026](https://code.claude.com/docs/ru/whats-new/2026-w32.md): Сеансы Claude Code обмениваются сообщениями друг с другом, самостоятельно размещённые окружения запускают облачные сеансы на вашей инфраструктуре, и режим auto становится режимом разрешений по умолчанию.
- [Неделя 30 · 20–24 июля 2026](https://code.claude.com/docs/ru/whats-new/2026-w30.md): Opus 5 становится моделью Opus по умолчанию, Claude Code Desktop добавляет панель iOS Simulator, а плагин Claude Security сканирует ваш код на уязвимости.
- [Неделя 29 · 13–17 июля 2026](https://code.claude.com/docs/ru/whats-new/2026-w29.md): Подтягивайте живые данные в опубликованные артефакты через MCP коннекторы и используйте Claude Code с программой чтения с экрана в новом режиме чтения с экрана.
- [Неделя 28 · 6–10 июля 2026 г.](https://code.claude.com/docs/ru/whats-new/2026-w28.md): Просматривайте внешние сайты из встроенного браузера приложения Desktop, запустите полную проверку настройки с помощью /doctor и получите защиту транскриптов в автоматическом режиме и обновления представления агента.
- [Неделя 27 · 29 июня – 3 июля 2026](https://code.claude.com/docs/ru/whats-new/2026-w27.md): Claude Sonnet 5 становится моделью по умолчанию, Claude в Chrome достигает общей доступности, подагенты работают в фоновом режиме по умолчанию, Claude Desktop появляется на Linux в бета-версии, и /radio настраивается на Claude FM.
- [Неделя 26 · 22–26 июня 2026](https://code.claude.com/docs/ru/whats-new/2026-w26.md): Аутентифицируйте MCP серверы из вашей оболочки с помощью claude mcp login, получайте ответ на вывод команды режима shell с префиксом !, и возобновляйте беседу перед /clear с помощью /rewind.
- [Неделя 25 · 15–19 июня 2026](https://code.claude.com/docs/ru/whats-new/2026-w25.md): Опубликуйте живую, доступную для совместного использования страницу из вашей сессии с Artifacts, сопоставляйте параметры инструментов в правилах deny и ask, и устанавливайте любой параметр из приглашения с помощью /config.
- [Неделя 24 · 8–12 июня 2026](https://code.claude.com/docs/ru/whats-new/2026-w24.md): Переместите сеанс в новый каталог с помощью /cd, позвольте подагентам создавать собственных подагентов и устраняйте неисправности в конфигурации с помощью безопасного режима.
- [Неделя 23 · 1–5 июня 2026](https://code.claude.com/docs/ru/whats-new/2026-w23.md): Запуск режима auto на Amazon Bedrock, Google Cloud's Agent Platform и Microsoft Foundry, запрос перед записью файлов, которые могут выполнять код в режиме acceptEdits, список установленных плагинов с помощью /plugin list и требование утвержденного диапазона версий для управляемых развертываний.
- [Неделя 22 · 25–29 мая 2026](https://code.claude.com/docs/ru/whats-new/2026-w22.md): Запускайте Claude Code на Claude Opus 4.8, организуйте крупные задачи с помощью динамических workflows, выявляйте проблемы безопасности с помощью плагина security-guidance и используйте fast mode на Opus 4.8 по более низкой цене.
- [Неделя 21 · 18–22 мая 2026](https://code.claude.com/docs/ru/whats-new/2026-w21.md): Используйте режим auto на плане Pro и с Sonnet 4.6, посмотрите, какие skills, subagents и MCP servers влияют на ограничения вашего плана в /usage, и просмотрите различия с помощью новой команды /code-review.
- [Неделя 20 · 11–15 мая 2026](https://code.claude.com/docs/ru/whats-new/2026-w20.md): Управляйте каждой сессией Claude Code с одного экрана с помощью представления агента, держите Claude в работе до выполнения условия и запускайте быстрый режим на Opus 4.7 по умолчанию.
- [Неделя 19 · 4–8 мая 2026](https://code.claude.com/docs/ru/whats-new/2026-w19.md): Загружайте плагины из архивов .zip и URL-адресов, ищите историю команд во всех проектах с помощью Ctrl+R, создавайте новые worktrees из локального HEAD или удаленной ветки по умолчанию и блокируйте действия безусловно с помощью правил hard deny в режиме auto.
- [Неделя 18 · 27 апреля – 1 мая 2026](https://code.claude.com/docs/ru/whats-new/2026-w18.md): Claude Code на Windows работает без Git Bash, claude auth login принимает вставленный код OAuth, когда обратный вызов браузера не может достичь localhost, claude project purge очищает локальное состояние для каждого проекта, и вставка URL PR в /resume находит сеанс, который его создал.
- [Неделя 17 · 20–24 апреля 2026](https://code.claude.com/docs/ru/whats-new/2026-w17.md): /ultrareview открывается как исследовательский предпросмотр, автоматические сводки сеансов при возврате в терминал, пользовательские цветовые темы, которые вы можете создавать и распространять в плагинах, и переработанный Claude Code в веб-версии.
- [Неделя 16 · 13–17 апреля 2026](https://code.claude.com/docs/ru/whats-new/2026-w16.md): Claude Opus 4.7 с новым уровнем усилий xhigh, Routines на Claude Code в веб-версии, мобильные push-уведомления, которые уведомляют ваш телефон, когда Claude нуждается в вас, /usage с разбивкой, показывающей, что ограничивает вас, и нативные бинарные файлы вместо упакованного JavaScript.
- [Неделя 15 · 6–10 апреля 2026](https://code.claude.com/docs/ru/whats-new/2026-w15.md): Облачное планирование Ultraplan, инструмент Monitor с самостоятельным темпом /loop, /team-onboarding для упаковки вашей конфигурации и /autofix-pr из вашего терминала.
- [Неделя 14 · 30 марта – 3 апреля 2026](https://code.claude.com/docs/ru/whats-new/2026-w14.md): Computer use в CLI, интерактивные встроенные уроки, рендеринг без мерцания, переопределение размера результатов MCP для каждого инструмента и исполняемые файлы плагинов в PATH.
- [Неделя 13 · 23–27 марта 2026](https://code.claude.com/docs/ru/whats-new/2026-w13.md): Auto mode для автоматических разрешений, встроенное управление компьютером, автоматическое исправление PR в облаке, поиск по транскриптам и инструмент PowerShell для Windows.

### Ресурсы

#### Ресурсы

- [Правовые и нормативные требования](https://code.claude.com/docs/ru/legal-and-compliance.md): Правовые соглашения, сертификаты соответствия и информация о безопасности для Claude Code.
