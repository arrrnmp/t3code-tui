# Claude Code Docs: Simplified Chinese

> Official documentation for Claude Code, Anthropic's agentic coding tool available in the terminal, IDE, desktop app, and browser. Covers installation, configuration, skills, subagents, hooks, MCP, the Agent SDK, and reference material.

## Simplified Chinese

### 快速开始

#### 快速开始

- [概述](https://code.claude.com/docs/zh-CN/overview.md): Claude Code 是一个代理编码工具，可以读取你的代码库、编辑文件、运行命令，并与你的开发工具集成。可在终端、IDE、桌面应用和浏览器中使用。
- [快速开始](https://code.claude.com/docs/zh-CN/quickstart.md): 欢迎使用 Claude Code！
- [更新日志](https://code.claude.com/docs/zh-CN/changelog.md)

#### 核心概念

- [Claude Code 如何工作](https://code.claude.com/docs/zh-CN/how-claude-code-works.md): 了解代理循环、内置工具以及 Claude Code 如何与您的项目交互。
- [扩展 Claude Code](https://code.claude.com/docs/zh-CN/features-overview.md): 了解何时使用 CLAUDE.md、Skills、subagents、hooks、MCP 和 plugins。
- [探索 .claude 目录](https://code.claude.com/docs/zh-CN/claude-directory.md): Claude Code 读取 CLAUDE.md、settings.json、hooks、skills、commands、subagents、workflows、rules 和自动内存的位置。探索项目中的 .claude 目录和主目录中的 ~/.claude。
- [探索上下文窗口](https://code.claude.com/docs/zh-CN/context-window.md): Claude Code 上下文窗口在会话期间如何填充的交互式模拟。查看自动加载的内容、每个文件读取的成本以及规则和 hooks 何时触发。
- [Claude Code 如何使用 prompt caching](https://code.claude.com/docs/zh-CN/prompt-caching.md): Claude Code 自动管理 prompt caching。了解为什么模型切换会触发缓慢的未缓存回合、`/compact` 的成本、为什么 CLAUDE.md 编辑在会话中期不适用，以及如何检查缓存命中率。

#### 使用 Claude Code

- [Claude 如何记住您的项目](https://code.claude.com/docs/zh-CN/memory.md): 使用 CLAUDE.md 或 AGENTS.md 文件为 Claude 提供持久指令，并让 Claude 通过自动记忆自动积累学习。
- [管理会话](https://code.claude.com/docs/zh-CN/sessions.md): 命名、恢复、分支和在 Claude Code 对话之间切换。涵盖 `--continue`、`--resume`、`--from-pr`、`/resume` 选择器、会话命名、导出文本记录和文本记录存储位置。
- [常见工作流程](https://code.claude.com/docs/zh-CN/common-workflows.md): 使用 Claude Code 探索代码库、修复错误、重构、测试和其他日常任务的分步指南。
- [提示词库](https://code.claude.com/docs/zh-CN/prompt-library.md): 复制粘贴提示词到 Claude Code，按任务和角色标记。
- [Claude Code 最佳实践](https://code.claude.com/docs/zh-CN/best-practices.md): 从配置环境到跨并行会话扩展，充分利用 Claude Code 的提示和模式。

#### 平台和集成

- [平台和集成](https://code.claude.com/docs/zh-CN/platforms.md): 选择在哪里运行 Claude Code 以及连接什么工具。比较 CLI、Desktop、VS Code、JetBrains、Web 以及 Chrome、Slack 和 CI/CD 等集成。
- [使用 Remote Control 从任何设备继续本地会话](https://code.claude.com/docs/zh-CN/remote-control.md): 使用 Remote Control 从您的手机、平板电脑或任何浏览器继续本地 Claude Code 会话。适用于 claude.ai/code 和 Claude 移动应用。
- [让 Claude 通过 Projects 协调持续进行的工作](https://code.claude.com/docs/zh-CN/claude-projects.md): 在一个对话中为 Claude 提供一组相关工作，让它协调共享存储库、说明和内存的并行云会话。
- [Claude Code 移动版](https://code.claude.com/docs/zh-CN/mobile.md): 从您的手机使用 Claude 应用程序启动、监控和指导 Claude Code 任务，支持 iOS 和 Android。
- [在 Chrome 中使用 Claude Code](https://code.claude.com/docs/zh-CN/chrome.md): 将 Claude Code 连接到 Chrome 浏览器，以测试网络应用、使用控制台日志进行调试、自动填充表单以及从网页中提取数据。
- [让 Claude 从 CLI 使用您的计算机](https://code.claude.com/docs/zh-CN/computer-use.md): 在 Claude Code CLI 中启用 computer use，使 Claude 能够在 macOS 上打开应用、点击、输入和查看您的屏幕。测试原生应用、调试视觉问题，以及自动化仅限 GUI 的工具，无需离开您的终端。
- [在 VS Code 中使用 Claude Code](https://code.claude.com/docs/zh-CN/vs-code.md): 安装和配置 VS Code 的 Claude Code 扩展。获得 AI 编码协助，包括内联差异、@-提及、计划审查和快捷键。
- [JetBrains IDEs](https://code.claude.com/docs/zh-CN/jetbrains.md): 在 JetBrains IDE（包括 IntelliJ、PyCharm、WebStorm 等）中使用 Claude Code
- [Slack 中的 Claude Code](https://code.claude.com/docs/zh-CN/slack.md): 直接从 Slack 工作区委派编码任务。Anthropic 正在为 Team 和 Enterprise 工作区停用此早期版本，转而使用 Claude Tag；它仍然是 Pro 和 Max 计划上的设置路径。
- [Claude Tag](https://code.claude.com/docs/zh-CN/claude-tag.md): 通过 Claude Tag 将 Claude 引入您团队的 Slack 频道，并在 claude.com 上查找其设置和使用文档。

##### Claude Code 云端版

- [在云中开始使用 Claude Code](https://code.claude.com/docs/zh-CN/web-quickstart.md): 从浏览器或手机在云中运行 Claude Code。连接 GitHub 仓库、提交任务，并在无需本地设置的情况下审查 PR。
- [在云端使用 Claude Code](https://code.claude.com/docs/zh-CN/claude-code-on-the-web.md): 从浏览器、手机、桌面应用或终端在云端运行 Claude Code 会话，使用 --cloud 和 --teleport 移动会话，以及自动修复拉取请求。
- [使用例程自动化工作](https://code.claude.com/docs/zh-CN/routines.md): 让 Claude Code 自动运行。定义在计划上运行、通过 API 调用触发或对来自云基础设施的 GitHub 事件做出反应的例程。
- [使用 Ultrareview 查找错误](https://code.claude.com/docs/zh-CN/ultrareview.md): 使用 /code-review ultra 在云中运行深度多代理代码审查，在合并前查找和验证错误。

##### Claude Code 桌面版

- [开始使用桌面应用](https://code.claude.com/docs/zh-CN/desktop-quickstart.md): 在桌面上安装 Claude Code 并开始您的第一个编码会话
- [Desktop application](https://code.claude.com/docs/zh-CN/desktop.md): 充分利用 Claude Code Desktop：使用 Git 隔离的并行会话、拖放窗格布局、集成终端和文件编辑器、侧边聊天、计算机使用、从手机 Dispatch 会话、可视化 diff 审查、应用预览、PR 监控、连接器和企业配置。
- [Linux 上的 Claude Desktop（测试版）](https://code.claude.com/docs/zh-CN/desktop-linux.md): 在 Ubuntu 和 Debian 上安装和更新 Claude 桌面应用
- [Claude Code Desktop 在 WSL 中](https://code.claude.com/docs/zh-CN/desktop-wsl.md): 在 Windows 上的 WSL 2 发行版内运行 Code 会话
- [在 Claude Code Desktop 中安排定期任务](https://code.claude.com/docs/zh-CN/desktop-scheduled-tasks.md): 在 Claude Code Desktop 中设置定期任务，以定期自动运行 Claude 进行日常代码审查、依赖项审计或早晨简报。
- [在模拟器中测试 iOS 应用](https://code.claude.com/docs/zh-CN/desktop-ios-simulator.md): Claude Code Desktop 在 Claude 构建、运行或检查应用时，会在 iOS Simulator 窗格中打开你的应用，每个会话都有一个单独的模拟器。

##### 代码审查与 CI/CD

- [在 Claude 编写代码时捕获安全问题](https://code.claude.com/docs/zh-CN/security-guidance.md): 安装 security-guidance 插件，让 Claude 在编写代码时自动审查其代码更改中的漏洞，并在同一会话中修复这些问题。
- [扫描代码库中的漏洞](https://code.claude.com/docs/zh-CN/claude-security.md): 安装 Claude Security 插件以在 Claude Code 会话中扫描代码库中的漏洞，并将发现的问题转化为您可以审查和应用的补丁。
- [Code Review](https://code.claude.com/docs/zh-CN/code-review.md): 设置自动化 PR 审查，通过对完整代码库的多代理分析来捕获逻辑错误、安全漏洞和回归问题
- [Claude Code GitHub Actions](https://code.claude.com/docs/zh-CN/github-actions.md): 在 GitHub Actions 工作流中运行 Claude Code，响应 @claude 提及、自动化任务并将 issue 转换为拉取请求
- [通过云提供商使用 Claude Code GitHub Actions](https://code.claude.com/docs/zh-CN/github-actions-cloud-providers.md): 通过 Amazon Bedrock、Google Cloud 的 Agent Platform 或 Microsoft Foundry 而不是 Claude API 运行 Claude Code GitHub Actions
- [Claude Code 与 GitHub Enterprise Server](https://code.claude.com/docs/zh-CN/github-enterprise-server.md): 将 Claude Code 连接到自托管的 GitHub Enterprise Server 实例，用于云会话、代码审查和插件市场。
- [Claude Code GitLab CI/CD](https://code.claude.com/docs/zh-CN/gitlab-ci-cd.md): 了解如何将 Claude Code 集成到您的 GitLab CI/CD 开发工作流中

### 使用 Claude Code 构建

#### 代理和并行工作

- [并行运行代理](https://code.claude.com/docs/zh-CN/agents.md): 比较 Claude Code 同时处理多个任务的方式：子代理、代理视图、代理团队、动态工作流和项目。
- [创建自定义 subagents](https://code.claude.com/docs/zh-CN/sub-agents.md): 在 Claude Code 中创建和使用专门的 AI subagents，用于特定任务的工作流和改进的上下文管理。
- [使用 agent view 管理多个代理](https://code.claude.com/docs/zh-CN/agent-view.md): 从一个屏幕调度和管理多个 Claude Code 会话。Agent view 显示每个会话正在做什么以及哪些会话需要你的输入。
- [协调 Claude Code 会话团队](https://code.claude.com/docs/zh-CN/agent-teams.md): 协调多个 Claude Code 实例作为一个团队一起工作，具有共享任务、代理间消息传递和集中管理。
- [消息传递到您的其他 Claude Code 会话](https://code.claude.com/docs/zh-CN/cross-session-messaging.md): 让 Claude 列出并消息传递到您在此机器上的其他 Claude Code 会话，并到达您在其他机器或网络上的会话。
- [使用动态工作流大规模编排子代理](https://code.claude.com/docs/zh-CN/workflows.md): 动态工作流从 Claude 编写的脚本中编排许多子代理，您可以重新运行。用于代码库审计、大型迁移和交叉检查研究。
- [使用 worktrees 运行并行会话](https://code.claude.com/docs/zh-CN/worktrees.md): 在单独的 git worktrees 中隔离并行 Claude Code 会话，以便更改不会相互冲突。涵盖 `--worktree` 标志、子代理隔离、`.worktreeinclude`、清理和非 git VCS hooks。

#### MCP

- [连接到 MCP 服务器](https://code.claude.com/docs/zh-CN/mcp-quickstart.md): 将 MCP 服务器添加到 Claude Code，验证连接，并在磁盘上找到配置。
- [通过 MCP 将 Claude Code 连接到工具](https://code.claude.com/docs/zh-CN/mcp.md): 了解如何使用 Model Context Protocol 将 Claude Code 连接到您的工具。

#### 技能

- [使用 skills 扩展 Claude](https://code.claude.com/docs/zh-CN/skills.md): 创建、管理和共享 skills 以在 Claude Code 中扩展 Claude 的功能。包括自定义命令和捆绑的 skills。

#### 制品库

- [将会话输出作为 artifacts 共享](https://code.claude.com/docs/zh-CN/artifacts.md): Artifacts 将 Claude Code 的工作转化为 claude.ai 上的实时交互式页面，您可以将其保持私密、与您的组织共享或发布到公开链接。

#### 自动化

- [使用 hooks 自动化操作](https://code.claude.com/docs/zh-CN/hooks-guide.md): 当 Claude Code 编辑文件、完成任务或需要输入时自动运行 shell 命令。格式化代码、发送通知、验证命令并强制执行项目规则。
- [使用 channels 将事件推送到运行中的会话](https://code.claude.com/docs/zh-CN/channels.md): 使用 channels 从 MCP 服务器将消息、警报和 webhooks 推送到您的 Claude Code 会话中。转发 CI 结果、聊天消息和监控事件，以便 Claude 在您离开时做出反应。
- [按计划运行提示词](https://code.claude.com/docs/zh-CN/scheduled-tasks.md): 使用 /loop 和 cron 调度工具在 Claude Code 会话中重复运行提示词、轮询状态或设置一次性提醒。
- [让 Claude 朝着目标工作](https://code.claude.com/docs/zh-CN/goal.md): 使用 /goal 设置完成条件，Claude 会持续工作直到条件满足、模型判断其不可能实现或需要修复的错误清除目标。
- [以编程方式运行 Claude Code](https://code.claude.com/docs/zh-CN/headless.md): 使用 Agent SDK 从 CLI、Python 或 TypeScript 以编程方式运行 Claude Code。
- [从链接启动会话](https://code.claude.com/docs/zh-CN/deep-links.md): 从 URL 打开 Claude Code 终端会话。在运行手册、警报和仪表板中嵌入 `claude-cli://` 链接，这样点击即可在正确的仓库中打开 Claude Code，并使用正确的提示。

#### 指南

- [在 monorepo 或大型代码库中设置 Claude Code](https://code.claude.com/docs/zh-CN/large-codebases.md): 为 monorepo 和大型单树代码库配置 Claude Code，使用嵌套的 CLAUDE.md 文件、稀疏 worktrees、代码智能和按包技能，使 Claude 专注于你正在处理的代码。

#### 故障排除

- [排查安装和登录问题](https://code.claude.com/docs/zh-CN/troubleshoot-install.md): 修复安装或登录 Claude Code 时出现的命令未找到、PATH、权限、网络和身份验证错误。
- [故障排除](https://code.claude.com/docs/zh-CN/troubleshooting.md): 修复 Claude Code 中的高 CPU 或内存使用、挂起、自动压缩抖动和搜索问题，并找到其他问题的正确页面。
- [调试你的配置](https://code.claude.com/docs/zh-CN/debug-your-config.md): 诊断为什么 CLAUDE.md、settings、hooks、MCP 服务器或 skills 没有生效。使用 /context、/doctor、/hooks 和 /mcp 来查看实际加载了什么。
- [错误参考](https://code.claude.com/docs/zh-CN/errors.md): 查找 Claude Code 运行时错误消息，了解每个错误的含义以及如何修复。

### 插件

#### 插件

- [插件概览](https://code.claude.com/docs/zh-CN/plugins/overview.md): 了解什么是 Claude Code 插件，何时需要使用插件而不是独立的 skill 或 MCP 服务器，以及应该阅读哪个页面来安装或创建插件。

#### 使用插件

- [安装和管理插件](https://code.claude.com/docs/zh-CN/plugins/install.md): 从任何使用的界面上的市场安装 Claude Code 插件，选择安装范围，以及稍后更新或删除它们。
- [Anthropic 的插件市场](https://code.claude.com/docs/zh-CN/plugins/anthropic-marketplaces.md): Anthropic 官方、社区和演示插件市场的 Claude Code：它们的名称、存储库、如何添加每个市场，以及在哪里浏览它们的插件。
- [代码智能插件](https://code.claude.com/docs/zh-CN/plugins/code-intelligence.md): 安装语言服务器插件，使 Claude 在编辑后能看到类型错误并通过符号导航代码，并回答 LSP 插件推荐对话框。
- [插件安全和信任](https://code.claude.com/docs/zh-CN/plugins/security.md): 在安装插件之前决定是否信任它，从插件在您的机器上可以做什么，到如何审查和删除它。

#### 创建插件

- [创建 Claude Code 插件](https://code.claude.com/docs/zh-CN/plugins/create.md): 从空目录构建您的第一个 Claude Code 插件，在没有市场的情况下测试它，并转换现有的 .claude/ 设置。
- [向插件添加组件](https://code.claude.com/docs/zh-CN/plugins/components.md): 向 Claude Code 插件添加 skills、hooks、MCP 服务器和其他所有组件类型，并提供针对每种类型的验证示例。
- [插件依赖](https://code.claude.com/docs/zh-CN/plugins/dependencies.md): 声明你的插件所依赖的其他插件，使用版本范围如 ^1.2，并了解 Claude Code 如何安装、解析和修剪它们。
- [使用 evals 测试插件](https://code.claude.com/docs/zh-CN/plugin-evals.md): 为您的 Claude Code 插件编写 eval 用例，使用 claude plugin eval 运行它们，对结果进行评分，与无插件基线进行比较，并在 CI 中基于分数进行门控。
- [发布和分发插件](https://code.claude.com/docs/zh-CN/plugins/publish.md): 通过您自己的市场或 Anthropic 的社区市场发布 Claude Code 插件，包括发布前检查清单以及用户如何获取更新。
- [测量插件成本和使用情况](https://code.claude.com/docs/zh-CN/plugins/measure.md): 测量 Claude Code 插件的令牌成本，了解人们是否仍在使用它，并为组织范围的插件问题选择遥测事件。
- [从您的 CLI 推荐您的插件](https://code.claude.com/docs/zh-CN/plugins/cli-hints.md): 通过从您的 CLI 或 SDK 发出 claude-code-hint 标签，提示 Claude Code 用户安装您的官方市场插件。

#### 运行 marketplace

- [创建一个 marketplace](https://code.claude.com/docs/zh-CN/plugins/create-marketplace.md): 从 marketplace.json 文件构建一个 plugin marketplace，并在托管之前在本地测试它。
- [托管和维护一个 marketplace](https://code.claude.com/docs/zh-CN/plugins/host-marketplace.md): 发布一个插件 marketplace，让用户可以通过它来访问，授予对私有 marketplace 的访问权限，并在推送更新和重命名后不会破坏安装。
- [为您的组织推荐插件](https://code.claude.com/docs/zh-CN/plugins/relevance.md): 向 marketplace 插件条目添加相关性块，以便当用户的工作匹配时 Claude Code 会建议安装这些插件，并在托管设置中将 marketplace 列入允许列表。

#### 管理组织的插件

- [为您的组织管理 Claude Code plugins](https://code.claude.com/docs/zh-CN/plugins/org.md): 通过托管设置控制 Claude Code 在组织中每台机器上安装和允许的 plugins。

#### 故障排除

- [排查插件问题](https://code.claude.com/docs/zh-CN/plugins/troubleshooting.md): 修复 Claude Code 中的插件错误。找到您看到的确切消息，按照 /plugin 运行、安装和组织策略的阶段分组。
- [插件加载参考](https://code.claude.com/docs/zh-CN/plugins/loading.md): 追踪 Claude Code 从何处加载每个插件，哪个设置文件决定是否加载，以及为什么更新没有产生任何变化。

#### 参考

- [Plugin manifest 参考](https://code.claude.com/docs/zh-CN/plugins/manifest-reference.md): plugin.json 的完整参考：每个字段的类型和默认值、接受的路径形式，以及 userConfig 和环境变量模式。
- [Marketplace 参考](https://code.claude.com/docs/zh-CN/plugins/marketplace-reference.md): marketplace.json 字段、插件条目和插件及 marketplace 源对象的完整参考，包括每个字段的有效位置。
- [Plugin 命令参考](https://code.claude.com/docs/zh-CN/plugins/cli-reference.md): claude plugin shell 命令、会话中的 /plugin 和 /reload-plugins 的完整参考，以及在一个会话中加载 plugin 的标志。

### 管理

#### 设置和访问

- [为您的组织设置 Claude Code](https://code.claude.com/docs/zh-CN/admin-setup.md): 针对部署 Claude Code 的管理员的决策地图，涵盖 API 提供商、托管设置、策略执行、使用情况监控和数据处理。
- [高级设置](https://code.claude.com/docs/zh-CN/setup.md): Claude Code 的系统要求、特定平台安装、版本管理和卸载。
- [身份验证](https://code.claude.com/docs/zh-CN/authentication.md): 登录 Claude Code 并为个人、团队和组织配置身份验证。
- [部署托管设置](https://code.claude.com/docs/zh-CN/managed-settings.md): 将托管设置部署到每个开发者的机器上：按操作系统的交付机制、Claude Code 如何组合托管源，以及如何验证强制执行。
- [配置服务器管理的设置](https://code.claude.com/docs/zh-CN/server-managed-settings.md): 通过服务器交付的设置为您的组织集中配置 Claude Code，无需设备管理基础设施。
- [控制组织的 MCP 服务器访问权限](https://code.claude.com/docs/zh-CN/managed-mcp.md): 使用托管配置文件、托管设置、允许列表和拒绝列表，限制用户可以添加或连接的 MCP 服务器，或为每个用户提供服务器。
- [配置自动模式](https://code.claude.com/docs/zh-CN/auto-mode-config.md): 告诉自动模式分类器您的组织信任哪些代码库、存储桶和域。设置环境上下文，覆盖默认的阻止和允许规则，并使用自动模式 CLI 子命令检查您的有效配置。

#### 部署

- [企业部署概览](https://code.claude.com/docs/zh-CN/third-party-integrations.md): 了解 Claude Code 如何与各种第三方服务和基础设施集成，以满足企业部署需求。
- [功能可用性](https://code.claude.com/docs/zh-CN/feature-availability.md): 比较 Claude Code 功能在 Anthropic 订阅计划、Anthropic Console、Amazon Bedrock、AWS 上的 Claude Platform、Google Cloud 的 Agent Platform 和 Microsoft Foundry 中的可用性。
- [Amazon Bedrock 上的 Claude Code](https://code.claude.com/docs/zh-CN/amazon-bedrock.md): 了解如何通过 Amazon Bedrock 配置 Claude Code，包括设置、IAM 配置和故障排除。
- [AWS 上的 Claude Platform 中的 Claude Code](https://code.claude.com/docs/zh-CN/claude-platform-on-aws.md): 配置 Claude Code 以使用 Anthropic 运营的 Claude API，支持 AWS 身份验证、IAM 访问控制和 AWS Marketplace 计费。
- [Google Cloud 的 Agent Platform 上的 Claude Code](https://code.claude.com/docs/zh-CN/google-vertex-ai.md): 了解如何通过 Google Cloud 的 Agent Platform（原 Vertex AI）配置 Claude Code，包括设置、IAM 配置和故障排除。
- [Microsoft Foundry 上的 Claude Code](https://code.claude.com/docs/zh-CN/microsoft-foundry.md): 了解如何通过 Microsoft Foundry 配置 Claude Code，包括设置、配置和故障排除。
- [企业网络配置](https://code.claude.com/docs/zh-CN/network-config.md): 为企业环境配置 Claude Code，支持代理服务器、自定义证书颁发机构 (CA) 和相互传输层安全 (mTLS) 身份验证。
- [在企业启动器后面运行 Claude Code](https://code.claude.com/docs/zh-CN/corporate-launcher.md): 通过 CLAUDE_CODE_PROCESS_WRAPPER 或 processWrapper 设置，使用必需的启动器路由 Claude Code 从其自身二进制文件启动的进程，包括后台服务和每个代理视图会话。
- [开发容器](https://code.claude.com/docs/zh-CN/devcontainer.md): 在开发容器中运行 Claude Code，为您的团队提供一致、隔离的环境。

#### 网关

- [通过网关运行 Claude Code](https://code.claude.com/docs/zh-CN/gateways.md): 通过自托管网关路由 Claude Code，实现集中式凭证管理、使用情况跟踪和成本控制。涵盖架构、Anthropic 的 Claude 应用网关以及使用其他网关产品。

##### Claude 应用网关

- [Amazon Bedrock、Claude Platform on AWS、Google Cloud 和 Microsoft Foundry 的 Claude 应用网关](https://code.claude.com/docs/zh-CN/claude-apps-gateway.md): 通过自托管网关在 Amazon Bedrock、Claude Platform on AWS、Google Cloud 或 Microsoft Foundry 上运行 Claude Code，支持 SSO 登录、按组模型访问和 OTLP 遥测。
- [Claude 应用网关配置](https://code.claude.com/docs/zh-CN/claude-apps-gateway-config.md): 每个 gateway.yaml 选项的参考：监听器和 TLS、OIDC、会话、Postgres 存储、Amazon Bedrock、Claude Platform on AWS、Google Cloud 的 Agent Platform 和 Microsoft Foundry 上游、模型路由、托管策略和遥测。
- [Claude 应用网关支出限制](https://code.claude.com/docs/zh-CN/claude-apps-gateway-spend-limits.md): 通过 Claude 应用网关为每个开发者按天、周或月设置支出上限。使用 Admin API 设置限制，网关在每个请求上实时执行这些限制。
- [Claude 应用网关部署和运维](https://code.claude.com/docs/zh-CN/claude-apps-gateway-deploy.md): 向身份提供商注册网关，构建容器，在 Kubernetes 或 Cloud Run 上部署，并运维它：健康检查、密钥轮换、升级和安全。
- [在 AWS 上部署 Claude apps gateway](https://code.claude.com/docs/zh-CN/claude-apps-gateway-on-aws.md): 在 AWS 上运行 Claude apps gateway 的完整示例：ECS Fargate 或 EKS、Amazon RDS for PostgreSQL、AWS Secrets Manager 和 IAM 角色身份验证到 Amazon Bedrock。
- [在 Google Cloud 上部署 Claude apps gateway](https://code.claude.com/docs/zh-CN/claude-apps-gateway-on-gcp.md): 在 Google Cloud 上运行 Claude apps gateway 的实际示例：Cloud Run 或 GKE、Cloud SQL for PostgreSQL、Secret Manager 和 Google Cloud 的 Agent Platform 的服务账户身份验证。

##### 其他网关

- [其他 LLM 网关](https://code.claude.com/docs/zh-CN/llm-gateway.md): 通过您的组织已运行的 LLM 网关路由 Claude Code。涵盖将 Claude Code 连接到网关、为您的组织部署网关以及 Claude Code 发送到网关的内容。
- [将 Claude Code 连接到 LLM 网关](https://code.claude.com/docs/zh-CN/llm-gateway-connect.md): 将 Claude Code 指向您组织的 LLM 网关。检查您的管理员是否已配置它，或自行设置基础 URL 和凭证，然后验证连接并修复网关错误。
- [为您的组织推出 LLM 网关](https://code.claude.com/docs/zh-CN/llm-gateway-rollout.md): 为 Claude Code 部署网关产品：配置它以转发 Claude Code 发送的内容，颁发开发者凭证，通过托管设置分发配置，并验证推出。
- [Claude Code 网关兼容性指南](https://code.claude.com/docs/zh-CN/llm-gateway-protocol.md): 保持 LLM 网关与 Claude Code 兼容：它调用的端点、必须转发的标头和正文字段，以及删除它们时会破坏的功能。

#### 使用情况和成本

- [监控](https://code.claude.com/docs/zh-CN/monitoring-usage.md): 了解如何为 Claude Code 启用和配置 OpenTelemetry。
- [有效管理成本](https://code.claude.com/docs/zh-CN/costs.md): 跟踪令牌使用情况，设置团队支出限制，并通过上下文管理、模型选择、扩展思考设置和预处理 hooks 来降低 Claude Code 成本。
- [使用分析跟踪团队使用情况](https://code.claude.com/docs/zh-CN/analytics.md): 在分析仪表板中查看 Claude Code 使用指标、跟踪采用情况并衡量工程速度。

#### 安全和数据

- [安全性](https://code.claude.com/docs/zh-CN/security.md): 了解 Claude Code 的安全防护措施和安全使用的最佳实践。
- [数据使用](https://code.claude.com/docs/zh-CN/data-usage.md): 了解 Anthropic 对 Claude 数据使用的政策
- [零数据保留](https://code.claude.com/docs/zh-CN/zero-data-retention.md): 了解 Claude for Enterprise 上 Claude Code 的零数据保留 (ZDR)，包括范围、禁用功能以及如何请求启用。

#### 采用

- [通信工具包](https://code.claude.com/docs/zh-CN/communications-kit.md): 推出公告、滴灌式营销信息和常见问题解答，用于在您的工程组织中推出 Claude Code。
- [Champion kit](https://code.claude.com/docs/zh-CN/champion-kit.md): 工程师在内部倡导 Claude Code 的行动手册：分享什么、如何回答问题以及如何在团队中推动采用。

### 配置

#### 设置

- [设置文件和优先级](https://code.claude.com/docs/zh-CN/settings.md): 更改 Claude Code 设置，选择键所属的作用域，验证更改，并了解当键在多个位置设置时 Claude Code 使用哪个值。
- [所有设置](https://code.claude.com/docs/zh-CN/settings-reference.md): Claude Code settings.json 的完整参考：每个键的位置、类型和默认值，以及可直接粘贴的示例，包含每个键的索引。
- [示例设置文件](https://code.claude.com/docs/zh-CN/settings-example.md): 为开发者、团队和组织提供的现实 settings.json 文件：复制一个，保留你想要的键，并更改值。

#### 权限和沙箱隔离

- [配置权限](https://code.claude.com/docs/zh-CN/permissions.md): 通过细粒度权限规则、模式和托管策略来控制 Claude Code 可以访问和执行的操作。
- [选择权限模式](https://code.claude.com/docs/zh-CN/permission-modes.md): 控制 Claude 在采取行动前是否需要征求您的同意。在 CLI 中使用 Shift+Tab 切换权限模式，在 VS Code 中使用模式指示器，或在 Desktop 中使用模式选择器。
- [配置沙箱化 Bash 工具](https://code.claude.com/docs/zh-CN/sandboxing.md): 了解 Claude Code 的沙箱化 Bash 工具如何提供文件系统和网络隔离，以实现更安全、更自主的代理执行。
- [选择沙箱环境](https://code.claude.com/docs/zh-CN/sandbox-environments.md): 比较 Claude Code 沙箱选项：内置沙箱化 Bash 工具、沙箱运行时、开发容器、Docker 和虚拟机。为您的威胁模型选择合适的隔离方案。

#### 环境

- [配置云环境](https://code.claude.com/docs/zh-CN/cloud-environments.md): 为 Claude Code 云会话配置云环境：网络访问级别、环境变量、设置脚本和环境缓存。

##### 自托管环境

- [自托管环境](https://code.claude.com/docs/zh-CN/self-hosted-environments.md): 在您控制的基础设施上运行 Claude Code 云会话：设置自托管环境、部署运行器，并将会话路由到您自己的计算资源。
- [自托管环境快速入门](https://code.claude.com/docs/zh-CN/self-hosted-environments-quickstart.md): 设置您的第一个自托管环境：安装 Claude Code、创建环境、启动运行器，并将会话路由到该环境。
- [将自托管环境部署到生产环境](https://code.claude.com/docs/zh-CN/self-hosted-environments-deploy.md): 在生产环境中运行自托管运行器：安全加固、网络出站流量控制、git 凭证、Kubernetes 和 Compose 配方以及故障排除。
- [在自托管环境中自定义会话](https://code.claude.com/docs/zh-CN/self-hosted-environments-configuration.md): 使用包装脚本在自托管环境会话中自定义每个会话的凭证、生命周期钩子和按需运行程序生成。
- [端到端测试自托管环境](https://code.claude.com/docs/zh-CN/self-hosted-environments-testing.md): 从 CI 验证自托管运行器镜像：使用 CLI 分派会话，通过 Stop hook 读取 Claude 的回复，并编写完整循环脚本。
- [自托管环境参考](https://code.claude.com/docs/zh-CN/self-hosted-environments-reference.md): 自托管运行器和编排器的完整参考：CLI 标志、环境变量和 Prometheus 指标。
- [在自托管环境中验证会话身份](https://code.claude.com/docs/zh-CN/self-hosted-environments-identity.md): 验证 CLAUDE_CODE_SESSION_ACCESS_TOKEN JWT，以便网络上的服务可以信任来自自托管环境中会话的请求。

#### 模型和响应

- [模型配置](https://code.claude.com/docs/zh-CN/model-config.md): 配置 Claude Code 使用的模型、工作量级别、扩展上下文和自动压缩窗口
- [使用快速模式加快响应速度](https://code.claude.com/docs/zh-CN/fast-mode.md): 通过切换快速模式在 Claude Code 中获得更快的 Opus 响应。
- [使用顾问工具升级困难决策](https://code.claude.com/docs/zh-CN/advisor.md): 将您的主模型与更强大的顾问模型配对，Claude 在任务期间的关键时刻咨询该模型。
- [输出样式](https://code.claude.com/docs/zh-CN/output-styles.md): 通过内置输出样式（如简洁或解释性）或自定义样式来改变 Claude Code 的角色、语气和响应格式。

#### 界面

- [为 Claude Code 配置您的终端](https://code.claude.com/docs/zh-CN/terminal-config.md): 修复 Shift+Enter 以插入新行、在 Claude 完成时获得终端铃声、配置 tmux、匹配颜色主题，以及在 Claude Code CLI 中启用 Vim 模式。
- [全屏渲染](https://code.claude.com/docs/zh-CN/fullscreen.md): 启用更流畅、无闪烁的渲染模式，支持鼠标操作，在长对话中保持稳定的内存使用。
- [使用 Claude Code 与屏幕阅读器](https://code.claude.com/docs/zh-CN/accessibility.md): 为 VoiceOver 和 NVDA 等屏幕阅读器设置 Claude Code，以及屏幕放大镜、减少动画和色盲友好主题的设置。
- [语音听写](https://code.claude.com/docs/zh-CN/voice-dictation.md): 在 Claude Code CLI 中使用按住录音或点击录音的语音听写功能来说出你的提示词。
- [自定义你的状态行](https://code.claude.com/docs/zh-CN/statusline.md): 配置自定义状态栏以监控 Claude Code 中的上下文窗口使用情况、成本和 git 状态
- [自定义快捷键](https://code.claude.com/docs/zh-CN/keybindings.md): 使用快捷键配置文件在 Claude Code 中自定义快捷键。

### 参考

#### 参考

- [CLI 参考](https://code.claude.com/docs/zh-CN/cli-reference.md): Claude Code 命令行界面的完整参考，包括命令和标志。
- [Commands](https://code.claude.com/docs/zh-CN/commands.md): Claude Code 中可用命令的完整参考，包括内置命令和捆绑的 skills。
- [环境变量](https://code.claude.com/docs/zh-CN/env-vars.md): 控制 Claude Code 行为的环境变量参考。
- [工具参考](https://code.claude.com/docs/zh-CN/tools-reference.md): Claude Code 可以使用的工具的完整参考，包括权限要求和每个工具的行为。
- [交互模式](https://code.claude.com/docs/zh-CN/interactive-mode.md): Claude Code 会话中键盘快捷键、输入模式和交互功能的完整参考。
- [Checkpointing](https://code.claude.com/docs/zh-CN/checkpointing.md): 跟踪、回溯和总结 Claude 的编辑和对话以管理会话状态。
- [Hooks 参考](https://code.claude.com/docs/zh-CN/hooks.md): Claude Code hook 事件、配置架构、JSON 输入/输出格式、退出代码、异步 hooks、HTTP hooks、提示 hooks 和 MCP 工具 hooks 的参考。
- [Channels 参考](https://code.claude.com/docs/zh-CN/channels-reference.md): 构建一个 MCP 服务器，将 webhooks、警报和聊天消息推送到 Claude Code 会话中。频道合约的参考：能力声明、通知事件、回复工具、发送者门控和权限中继。

#### 术语表

- [术语表](https://code.claude.com/docs/zh-CN/glossary.md): Claude Code 术语定义。了解 agentic loop、compaction、CLAUDE.md、hooks、subagents、MCP 和其他核心概念的含义。

### Agent SDK

#### Agent SDK

- [Agent SDK 概览](https://code.claude.com/docs/zh-CN/agent-sdk/overview.md): 使用 Claude Code 作为库构建生产级 AI 代理
- [快速开始](https://code.claude.com/docs/zh-CN/agent-sdk/quickstart.md): 使用 Python 或 TypeScript Agent SDK 开始构建能够自主工作的 AI 代理
- [迁移到 Claude Agent SDK](https://code.claude.com/docs/zh-CN/agent-sdk/migration-guide.md): 将 Claude Code TypeScript 和 Python SDK 迁移到 Claude Agent SDK 的指南
- [Agent SDK 故障排除](https://code.claude.com/docs/zh-CN/agent-sdk/troubleshooting.md): 当 Claude Code CLI 无法启动、CLI 进程退出或成功结果到达但没有结构化输出时，修复 Agent SDK 错误。

#### 构建代理

- [配置你的代理](https://code.claude.com/docs/zh-CN/agent-sdk/configuration.md): 配置 Agent SDK 会话：组合选项对象、设置模型、环境和限制，并找到每个功能选项的页面。
- [示例](https://code.claude.com/docs/zh-CN/agent-sdk/examples.md): 查找完整的、可运行的 Agent SDK 项目或 Claude Cookbook 中的指导食谱，以匹配您想要构建的内容。

#### 核心概念

- [代理循环如何工作](https://code.claude.com/docs/zh-CN/agent-sdk/agent-loop.md): 了解消息生命周期、工具执行、上下文窗口和支持 SDK 代理的架构。
- [在 SDK 中使用 Claude Code 功能](https://code.claude.com/docs/zh-CN/agent-sdk/claude-code-features.md): 将项目说明、skills、hooks 和其他 Claude Code 功能加载到您的 SDK 代理中。
- [使用会话](https://code.claude.com/docs/zh-CN/agent-sdk/sessions.md): 会话如何保持代理对话历史记录，以及何时使用 continue、resume 和 fork 返回到之前的运行。
- [将会话持久化到外部存储](https://code.claude.com/docs/zh-CN/agent-sdk/session-storage.md): 将 Agent SDK 会话记录镜像到您自己的对象存储、键值存储或数据库，以便其他主机可以恢复您的会话。

#### 输入和输出

- [流式输入](https://code.claude.com/docs/zh-CN/agent-sdk/streaming-vs-single-mode.md): 理解 Claude Agent SDK 的两种输入模式及何时使用每种模式
- [处理批准和用户输入](https://code.claude.com/docs/zh-CN/agent-sdk/user-input.md): 向用户显示 Claude 的批准请求和澄清问题，然后将他们的决定返回给 SDK。
- [实时流式传输响应](https://code.claude.com/docs/zh-CN/agent-sdk/streaming-output.md): 当文本和工具调用流入时，从 Agent SDK 获取实时响应
- [从代理获取结构化输出](https://code.claude.com/docs/zh-CN/agent-sdk/structured-outputs.md): 使用 JSON Schema、Zod 或 Pydantic 从代理工作流返回验证的 JSON。在多轮工具使用后获取类型安全的结构化数据。

#### 使用工具扩展

- [为 Claude 提供自定义工具](https://code.claude.com/docs/zh-CN/agent-sdk/custom-tools.md): 使用 Claude Agent SDK 的进程内 MCP 服务器定义自定义工具，以便 Claude 可以调用您的函数、访问您的 API 并执行特定领域的操作。
- [使用 MCP 连接外部工具](https://code.claude.com/docs/zh-CN/agent-sdk/mcp.md): 配置 MCP 服务器以扩展您的代理的外部工具。涵盖传输类型、大型工具集的工具搜索、身份验证和错误处理。
- [使用工具搜索扩展到多个工具](https://code.claude.com/docs/zh-CN/agent-sdk/tool-search.md): 通过动态发现和按需加载，将您的代理扩展到数千个工具。
- [SDK 中的子代理](https://code.claude.com/docs/zh-CN/agent-sdk/subagents.md): 定义和调用子代理以隔离上下文、并行运行任务，以及在 Claude Agent SDK 应用程序中应用专门的指令。

#### 自定义行为

- [修改系统提示词](https://code.claude.com/docs/zh-CN/agent-sdk/modifying-system-prompts.md): 在 `claude_code` 预设和自定义系统提示词之间进行选择，并通过 CLAUDE.md、输出样式、追加或完全自定义提示词来自定义行为。
- [使用 skills 扩展 agents](https://code.claude.com/docs/zh-CN/agent-sdk/skills.md): 控制 Claude 在 Claude Agent SDK 会话中可以调用哪些 skills，按名称分派命令，以及编写会话发现的 skills
- [SDK 中的 Plugins](https://code.claude.com/docs/zh-CN/agent-sdk/plugins.md): 通过 Agent SDK 加载自定义 plugins，以向 agent 会话添加 skills、agents、hooks 和 MCP servers

#### 控制和可观测性

- [配置权限](https://code.claude.com/docs/zh-CN/agent-sdk/permissions.md): 使用权限模式、hooks 和声明式允许/拒绝规则来控制您的代理如何使用工具。
- [使用 hooks 拦截和控制代理行为](https://code.claude.com/docs/zh-CN/agent-sdk/hooks.md): 在代理执行的关键点使用 hooks 拦截和自定义代理行为
- [使用checkpointing回滚文件更改](https://code.claude.com/docs/zh-CN/agent-sdk/file-checkpointing.md): 在agent会话期间跟踪文件更改，并将文件恢复到任何之前的状态
- [追踪成本和使用情况](https://code.claude.com/docs/zh-CN/agent-sdk/cost-tracking.md): 了解如何追踪令牌使用情况、估算成本，以及使用 Claude Agent SDK 配置 prompt caching。
- [使用 OpenTelemetry 进行可观测性](https://code.claude.com/docs/zh-CN/agent-sdk/observability.md): 使用 OpenTelemetry 将来自 Agent SDK 的跟踪、指标和事件导出到您的可观测性后端。
- [跟踪待办事项](https://code.claude.com/docs/zh-CN/agent-sdk/todo-tracking.md): 在 Agent SDK 会话中跟踪待办事项，并从结构化工具调用中呈现 Claude 的进度

#### 部署

- [托管 Agent SDK](https://code.claude.com/docs/zh-CN/agent-sdk/hosting.md): 在生产环境中部署 Agent SDK：子进程架构、会话持久化、扩展、可观测性以及针对 Docker、Kubernetes 和沙箱提供商的多租户隔离。
- [安全部署 AI 代理](https://code.claude.com/docs/zh-CN/agent-sdk/secure-deployment.md): 关于使用隔离、凭证管理和网络控制来保护 Claude Code 和 Agent SDK 部署的指南

#### SDK 参考

- [Agent SDK 参考 - TypeScript](https://code.claude.com/docs/zh-CN/agent-sdk/typescript.md): TypeScript Agent SDK 的完整 API 参考，包括所有函数、类型和接口。
- [TypeScript SDK V2 session API（已移除）](https://code.claude.com/docs/zh-CN/agent-sdk/typescript-v2-preview.md): 已移除的 V2 TypeScript Agent SDK session API 参考，具有用于多轮对话的基于会话的 send/stream 模式。
- [Agent SDK 参考 - Python](https://code.claude.com/docs/zh-CN/agent-sdk/python.md): Python Agent SDK 的完整 API 参考，包括所有函数、类型和类。

### 最新动态

#### 最新动态

- [最新动态](https://code.claude.com/docs/zh-CN/whats-new/index.md): Claude Code 功能的每周摘要，包含代码片段、演示和背景信息，说明为什么这些功能很重要。
- [第37周 · 2026年9月7日–11日](https://code.claude.com/docs/zh-CN/whats-new/2026-w37.md): 使用 claude plugin eval 测试您的插件，并将 Claude Code Desktop 窗格弹出到各自的窗口中。
- [第 36 周 · 8 月 31 日 – 9 月 4 日，2026 年](https://code.claude.com/docs/zh-CN/whats-new/2026-w36.md): 切换到 Claude Fable 5.1，让计算机使用在 Desktop 上后台运行，并在实时 /diff 面板中观看 Claude 的编辑。
- [第 35 周 · 2026 年 8 月 24–28 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w35.md): 在 Claude Code Desktop 应用中恢复终端会话，查看 Claude 为您起草的反馈报告，并在受限模式下启动会话。
- [第 34 周 · 2026 年 8 月 17–21 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w34.md): 使用 /design skill 草拟可编辑的 UI 画板，设置 Concise 输出样式，并从手机在您的机器上启动 Claude Code 会话。
- [第 33 周 · 2026 年 8 月 10–14 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w33.md): Claude Code Desktop 在使用限制重置后自动继续，fork 模式默认启用，GitLab 合并请求和市场加入 GitHub。
- [第 32 周 · 2026 年 8 月 3–7 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w32.md): Claude Code 会话可以相互发送消息，自托管环境在您的基础设施上运行云会话，自动模式成为默认权限模式。
- [第 30 周 · 7 月 20–24 日，2026 年](https://code.claude.com/docs/zh-CN/whats-new/2026-w30.md): Opus 5 成为默认的 Opus 模型，Claude Code Desktop 添加了 iOS 模拟器窗格，Claude Security 插件扫描您的代码以查找漏洞。
- [第29周 · 2026年7月13–17日](https://code.claude.com/docs/zh-CN/whats-new/2026-w29.md): 通过MCP连接器将实时数据拉入已发布的工件中，并在新的屏幕阅读器模式下使用Claude Code。
- [第 28 周 · 2026 年 7 月 6–10 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w28.md): 从 Desktop 应用的内置浏览器浏览外部网站，使用 /doctor 运行完整的设置检查，并获取自动模式的文本记录保护和代理视图升级。
- [第 27 周 · 6 月 29 日 – 7 月 3 日，2026 年](https://code.claude.com/docs/zh-CN/whats-new/2026-w27.md): Claude Sonnet 5 成为默认模型，Claude in Chrome 正式推出，子代理默认在后台运行，Claude Desktop 在 Linux 上推出测试版，/radio 调入 Claude FM。
- [第 26 周 · 2026 年 6 月 22–26 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w26.md): 使用 claude mcp login 从 shell 中对 MCP 服务器进行身份验证，使用 ! 前缀获取对 shell 模式命令输出的响应，以及使用 /rewind 从 /clear 之前恢复对话。
- [第 25 周 · 2026 年 6 月 15–19 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w25.md): 从您的会话中使用 Artifacts 发布实时可共享页面，在拒绝和询问规则中匹配工具参数，以及使用 /config 从提示中设置任何设置。
- [第24周 · 2026年6月8日–12日](https://code.claude.com/docs/zh-CN/whats-new/2026-w24.md): 使用 /cd 将会话移动到新目录，让子代理生成自己的子代理，并使用安全模式排查损坏的配置。
- [第 23 周 · 2026 年 6 月 1–5 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w23.md): 在 Amazon Bedrock、Google Cloud 的 Agent Platform 和 Microsoft Foundry 上运行自动模式，在 acceptEdits 模式下提示写入可运行代码的文件，使用 /plugin list 列出已安装的插件，以及为托管部署要求批准的版本范围。
- [第 22 周 · 2026 年 5 月 25–29 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w22.md): 在 Claude Opus 4.8 上运行 Claude Code，使用动态工作流编排大型任务，使用 security-guidance 插件捕获安全问题，并以更低的价格在 Opus 4.8 上使用快速模式。
- [第 21 周 · 2026 年 5 月 18–22 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w21.md): 在 Pro 计划上使用自动模式并支持 Sonnet 4.6，在 /usage 中查看哪些 skills、subagents 和 MCP servers 驱动您的计划限制，并使用新的 /code-review 命令查看差异。
- [第 20 周 · 2026 年 5 月 11–15 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w20.md): 从一个屏幕管理每个 Claude Code 会话，使用 agent view，让 Claude 持续朝着目标工作直到条件满足，并在 Opus 4.7 上默认运行快速模式。
- [第19周 · 2026年5月4–8日](https://code.claude.com/docs/zh-CN/whats-new/2026-w19.md): 从.zip存档和URL加载插件，使用Ctrl+R跨每个项目搜索命令历史，从本地HEAD或远程默认分支创建新worktrees，以及使用自动模式硬拒绝规则无条件阻止操作。
- [第 18 周 · 2026 年 4 月 27 日 – 5 月 1 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w18.md): Claude Code 在 Windows 上无需 Git Bash 即可运行，claude auth login 在浏览器回调无法到达 localhost 时接受粘贴的 OAuth 代码，claude project purge 清理每个项目的本地状态，将 PR URL 粘贴到 /resume 中可找到创建该会话的会话。
- [第17周 · 2026年4月20–24日](https://code.claude.com/docs/zh-CN/whats-new/2026-w17.md): /ultrareview 作为研究预览版开放，返回终端时自动生成会话摘要，可以在插件中构建和发布自定义颜色主题，以及重新设计的网页版 Claude Code。
- [第 16 周 · 2026 年 4 月 13–17 日](https://code.claude.com/docs/zh-CN/whats-new/2026-w16.md): Claude Opus 4.7 配备新的 xhigh 努力级别、Claude Code 网页版上的 Routines、移动推送通知在 Claude 需要您时 ping 您的手机、显示限制驱动因素的 /usage 分解，以及替代捆绑 JavaScript 的原生二进制文件。
- [第15周 · 2026年4月6–10日](https://code.claude.com/docs/zh-CN/whats-new/2026-w15.md): Ultraplan 云规划、具有自适应 /loop 的 Monitor 工具、用于打包设置的 /team-onboarding 以及从终端运行的 /autofix-pr。
- [第 14 周 · 3 月 30 日 – 4 月 3 日，2026 年](https://code.claude.com/docs/zh-CN/whats-new/2026-w14.md): CLI 中的计算机使用、交互式产品内课程、无闪烁渲染、按工具 MCP 结果大小覆盖以及 PATH 上的插件可执行文件。
- [第13周 · 2026年3月23–27日](https://code.claude.com/docs/zh-CN/whats-new/2026-w13.md): 自动模式用于免提权限、内置计算机使用、云端PR自动修复、转录搜索和Windows PowerShell工具。

### 资源

#### 资源

- [法律和合规](https://code.claude.com/docs/zh-CN/legal-and-compliance.md): Claude Code 的法律协议、合规认证和安全信息。
