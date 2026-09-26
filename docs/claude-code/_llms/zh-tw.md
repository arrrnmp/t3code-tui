# Claude Code Docs: Traditional Chinese

> Official documentation for Claude Code, Anthropic's agentic coding tool available in the terminal, IDE, desktop app, and browser. Covers installation, configuration, skills, subagents, hooks, MCP, the Agent SDK, and reference material.

## Traditional Chinese

### 開始使用

#### 開始使用

- [概述](https://code.claude.com/docs/zh-TW/overview.md): Claude Code 是一個代理編碼工具，可以讀取您的程式碼庫、編輯檔案、執行命令，並與您的開發工具整合。可在您的終端機、IDE、桌面應用程式和瀏覽器中使用。
- [快速入門](https://code.claude.com/docs/zh-TW/quickstart.md): 歡迎使用 Claude Code！
- [變更日誌](https://code.claude.com/docs/zh-TW/changelog.md)

#### 核心概念

- [Claude Code 如何運作](https://code.claude.com/docs/zh-TW/how-claude-code-works.md): 了解代理迴圈、內建工具，以及 Claude Code 如何與您的專案互動。
- [擴展 Claude Code](https://code.claude.com/docs/zh-TW/features-overview.md): 了解何時使用 CLAUDE.md、Skills、subagents、hooks、MCP 和 plugins。
- [探索 .claude 目錄](https://code.claude.com/docs/zh-TW/claude-directory.md): Claude Code 讀取 CLAUDE.md、settings.json、hooks、skills、commands、subagents、workflows、rules 和自動記憶的位置。探索您專案中的 .claude 目錄和主目錄中的 ~/.claude。
- [探索上下文視窗](https://code.claude.com/docs/zh-TW/context-window.md): Claude Code 上下文視窗在會話期間如何填充的互動模擬。查看自動加載的內容、每個文件讀取的成本，以及規則和 hooks 何時觸發。
- [Claude Code 如何使用 prompt caching](https://code.claude.com/docs/zh-TW/prompt-caching.md): Claude Code 會自動管理 prompt caching。了解為什麼模型切換會觸發緩慢的未快取回應、`/compact` 的成本、為什麼 CLAUDE.md 編輯在工作階段中途不適用，以及如何檢查您的快取命中率。

#### 使用 Claude Code

- [Claude 如何記住您的專案](https://code.claude.com/docs/zh-TW/memory.md): 使用 CLAUDE.md 或 AGENTS.md 檔案為 Claude 提供持久指示，並讓 Claude 透過自動記憶自動累積學習。
- [管理 sessions](https://code.claude.com/docs/zh-TW/sessions.md): 命名、恢復、分支和在 Claude Code 對話之間切換。涵蓋 `--continue`、`--resume`、`--from-pr`、`/resume` 選擇器、session 命名、匯出文字記錄，以及文字記錄的儲存位置。
- [常見工作流程](https://code.claude.com/docs/zh-TW/common-workflows.md): 使用 Claude Code 探索程式碼庫、修復錯誤、重構、測試和其他日常任務的逐步指南。
- [提示詞庫](https://code.claude.com/docs/zh-TW/prompt-library.md): 複製貼上提示詞供 Claude Code 使用，按任務和角色標記。
- [Claude Code 最佳實踐](https://code.claude.com/docs/zh-TW/best-practices.md): 從設定環境到跨平行工作階段擴展，充分利用 Claude Code 的提示和模式。

#### 平台與整合

- [平台和整合](https://code.claude.com/docs/zh-TW/platforms.md): 選擇在何處執行 Claude Code 以及要連接什麼。比較 CLI、Desktop、VS Code、JetBrains、Web 和 Chrome、Slack 和 CI/CD 等整合。
- [使用 Remote Control 從任何裝置繼續本地會話](https://code.claude.com/docs/zh-TW/remote-control.md): 使用 Remote Control 從您的手機、平板電腦或任何瀏覽器繼續本地 Claude Code 會話。適用於 claude.ai/code 和 Claude 行動應用程式。
- [讓 Claude 使用 Projects 協調進行中的工作](https://code.claude.com/docs/zh-TW/claude-projects.md): 在一個對話中為 Claude 提供一組相關的工作，讓它協調共享儲存庫、指示和記憶的平行雲端工作階段。
- [Claude Code 行動版](https://code.claude.com/docs/zh-TW/mobile.md): 從您的手機使用 Claude iOS 和 Android 應用程式來啟動、監控和引導 Claude Code 工作。
- [在 Chrome 中使用 Claude Code](https://code.claude.com/docs/zh-TW/chrome.md): 將 Claude Code 連接到您的 Chrome 瀏覽器，以測試網頁應用程式、使用控制台日誌進行除錯、自動填充表單，以及從網頁中提取資料。
- [讓 Claude 從 CLI 使用您的電腦](https://code.claude.com/docs/zh-TW/computer-use.md): 在 Claude Code CLI 中啟用 computer use，讓 Claude 可以在 macOS 上開啟應用程式、點擊、輸入和查看您的螢幕。測試原生應用程式、除錯視覺問題，以及自動化僅限 GUI 的工具，無需離開您的終端機。
- [在 VS Code 中使用 Claude Code](https://code.claude.com/docs/zh-TW/vs-code.md): 安裝並配置 VS Code 的 Claude Code 擴充功能。透過內聯差異、@-提及、計畫審查和快捷鍵獲得 AI 編碼協助。
- [JetBrains IDEs](https://code.claude.com/docs/zh-TW/jetbrains.md): 使用 Claude Code 與 JetBrains IDEs（包括 IntelliJ、PyCharm、WebStorm 等）整合
- [Slack 中的 Claude Code](https://code.claude.com/docs/zh-TW/slack.md): 直接從您的 Slack 工作區委派編碼任務。Anthropic 正在為 Team 和 Enterprise 工作區停用此較早版本，改用 Claude Tag；它仍然是 Pro 和 Max 方案上的設定路徑。
- [Claude Tag](https://code.claude.com/docs/zh-TW/claude-tag.md): 透過 Claude Tag 將 Claude 帶入您的團隊 Slack 頻道，並在 claude.com 上找到其設定和使用文件。

##### 雲端 Claude Code

- [在雲端開始使用 Claude Code](https://code.claude.com/docs/zh-TW/web-quickstart.md): 在雲端從瀏覽器或手機執行 Claude Code。連接 GitHub 儲存庫、提交任務，並在無需本地設定的情況下檢查 PR。
- [在雲端使用 Claude Code](https://code.claude.com/docs/zh-TW/claude-code-on-the-web.md): 從您的瀏覽器、手機、桌面應用程式或終端在雲端執行 Claude Code 工作階段，使用 --cloud 和 --teleport 移動工作階段，以及自動修復拉取請求。
- [使用例行程序自動化工作](https://code.claude.com/docs/zh-TW/routines.md): 讓 Claude Code 自動運行。定義在排程上運行、在 API 呼叫時觸發或對來自雲端基礎設施的 GitHub 事件做出反應的例行程序。
- [使用 Ultrareview 尋找錯誤](https://code.claude.com/docs/zh-TW/ultrareview.md): 使用 /code-review ultra 在雲端執行深度多代理程式碼審查，在合併前尋找並驗證錯誤。

##### Claude Code 桌面版

- [開始使用桌面應用程式](https://code.claude.com/docs/zh-TW/desktop-quickstart.md): 在桌面上安裝 Claude Code 並開始您的第一個編碼會話
- [Desktop 應用程式](https://code.claude.com/docs/zh-TW/desktop.md): 充分利用 Claude Code Desktop：具有 Git 隔離的並行會話、拖放窗格佈局、整合終端機和檔案編輯器、側邊聊天、電腦使用、從您的手機 Dispatch 會話、視覺化差異檢查、應用程式預覽、PR 監控、連接器和企業配置。
- [Linux 上的 Claude Desktop（測試版）](https://code.claude.com/docs/zh-TW/desktop-linux.md): 在 Ubuntu 和 Debian 上安裝和更新 Claude 桌面應用程式
- [Claude Code Desktop in WSL](https://code.claude.com/docs/zh-TW/desktop-wsl.md): 在 Windows 上的 WSL 2 發行版內執行 Code 工作階段
- [在 Claude Code Desktop 中排程定期任務](https://code.claude.com/docs/zh-TW/desktop-scheduled-tasks.md): 在 Claude Code Desktop 中設定排程任務，以定期自動執行 Claude 進行每日程式碼審查、相依性稽核或早晨簡報。
- [在模擬器中測試 iOS 應用程式](https://code.claude.com/docs/zh-TW/desktop-ios-simulator.md): Claude Code Desktop 在 Claude 建置、執行或檢查應用程式時，會在 iOS Simulator 窗格中開啟您的應用程式，每個工作階段都有一個獨立的模擬器。

##### 程式碼審查與 CI/CD

- [在 Claude 編寫程式碼時捕捉安全問題](https://code.claude.com/docs/zh-TW/security-guidance.md): 安裝 security-guidance 外掛程式，讓 Claude 檢查自己的程式碼變更是否存在漏洞，並在同一個工作階段中修復它們。
- [掃描程式碼庫以尋找漏洞](https://code.claude.com/docs/zh-TW/claude-security.md): 安裝 Claude Security plugin 以在 Claude Code 工作階段中掃描程式碼庫以尋找漏洞，並將發現的問題轉換為您可以檢查和應用的修補程式。
- [Code Review](https://code.claude.com/docs/zh-TW/code-review.md): 設定自動化 PR 審查，使用多代理分析您的完整程式碼庫來捕捉邏輯錯誤、安全漏洞和迴歸
- [Claude Code GitHub Actions](https://code.claude.com/docs/zh-TW/github-actions.md): 在 GitHub Actions 工作流程中執行 Claude Code，以回應 @claude 提及、自動化任務，並將議題轉換為 pull request
- [使用 Claude Code GitHub Actions 搭配雲端提供者](https://code.claude.com/docs/zh-TW/github-actions-cloud-providers.md): 透過 Amazon Bedrock、Google Cloud 的 Agent Platform 或 Microsoft Foundry 執行 Claude Code GitHub Actions，而不是使用 Claude API
- [Claude Code 與 GitHub Enterprise Server](https://code.claude.com/docs/zh-TW/github-enterprise-server.md): 將 Claude Code 連接到您自託管的 GitHub Enterprise Server 實例，以進行雲端會話、代碼審查和插件市場。
- [Claude Code GitLab CI/CD](https://code.claude.com/docs/zh-TW/gitlab-ci-cd.md): 了解如何將 Claude Code 整合到您的開發工作流程中，使用 GitLab CI/CD

### 使用 Claude Code 建構

#### 代理程式與平行工作

- [平行執行代理](https://code.claude.com/docs/zh-TW/agents.md): 比較 Claude Code 同時執行多項任務的方式：子代理、代理檢視、代理團隊、動態工作流程和專案。
- [建立自訂 subagents](https://code.claude.com/docs/zh-TW/sub-agents.md): 在 Claude Code 中建立和使用專門的 AI subagents，用於特定任務的工作流程和改進的上下文管理。
- [使用 Agent view 管理多個代理](https://code.claude.com/docs/zh-TW/agent-view.md): 從一個螢幕分派和管理許多 Claude Code 工作階段。Agent view 顯示每個工作階段正在做什麼，以及哪些需要您的輸入。
- [協調 Claude Code 工作階段團隊](https://code.claude.com/docs/zh-TW/agent-teams.md): 協調多個 Claude Code 實例作為團隊一起工作，具有共享任務、代理間訊息傳遞和集中管理。
- [訊息傳送至您的其他 Claude Code 工作階段](https://code.claude.com/docs/zh-TW/cross-session-messaging.md): 讓 Claude 列出並訊息傳送至您在此機器上的其他 Claude Code 工作階段，並與您在其他機器或網路上的工作階段聯繫。
- [使用動態工作流程大規模協調子代理](https://code.claude.com/docs/zh-TW/workflows.md): 動態工作流程從 Claude 編寫的指令碼協調許多子代理，您可以重新執行。用於程式碼庫審計、大規模遷移和交叉檢查研究。
- [使用 worktrees 執行平行會話](https://code.claude.com/docs/zh-TW/worktrees.md): 在獨立的 git worktrees 中隔離平行的 Claude Code 會話，使變更不會相互衝突。涵蓋 `--worktree` 旗標、子代理隔離、`.worktreeinclude`、清理和非 git VCS hooks。

#### MCP

- [連接到 MCP 伺服器](https://code.claude.com/docs/zh-TW/mcp-quickstart.md): 將 MCP 伺服器新增至 Claude Code、驗證連接，並在磁碟上找到設定。
- [透過 MCP 將 Claude Code 連接到工具](https://code.claude.com/docs/zh-TW/mcp.md): 了解如何使用 Model Context Protocol 將 Claude Code 連接到您的工具。

#### 技能

- [使用 skills 擴展 Claude](https://code.claude.com/docs/zh-TW/skills.md): 在 Claude Code 中建立、管理和分享 skills 以擴展 Claude 的功能。包括自訂命令和捆綁的 skills。

#### 成品

- [將工作階段輸出分享為成品](https://code.claude.com/docs/zh-TW/artifacts.md): 成品將 Claude Code 的工作轉化為 claude.ai 上的即時互動頁面，您可以保持私密、與您的組織分享，或發佈到公開連結。

#### 自動化

- [使用 hooks 自動化工作流程](https://code.claude.com/docs/zh-TW/hooks-guide.md): 當 Claude Code 編輯檔案、完成任務或需要輸入時，自動執行 shell 命令。格式化程式碼、發送通知、驗證命令並強制執行專案規則。
- [使用 channels 將事件推送到執行中的工作階段](https://code.claude.com/docs/zh-TW/channels.md): 使用 channels 從 MCP 伺服器將訊息、警報和 webhooks 推送到您的 Claude Code 工作階段。轉發 CI 結果、聊天訊息和監控事件，讓 Claude 在您不在時做出反應。
- [按排程執行提示](https://code.claude.com/docs/zh-TW/scheduled-tasks.md): 使用 /loop 和 cron 排程工具在 Claude Code 工作階段內重複執行提示、輪詢狀態或設定一次性提醒。
- [讓 Claude 朝著目標持續工作](https://code.claude.com/docs/zh-TW/goal.md): 使用 /goal 設定完成條件，Claude 會持續工作直到條件滿足、模型判斷不可能達成，或需要修復的錯誤清除目標。
- [以程式方式執行 Claude Code](https://code.claude.com/docs/zh-TW/headless.md): 使用 Agent SDK 從 CLI、Python 或 TypeScript 以程式方式執行 Claude Code。
- [從連結啟動工作階段](https://code.claude.com/docs/zh-TW/deep-links.md): 從 URL 開啟 Claude Code 終端機工作階段。在執行手冊、警報和儀表板中嵌入 `claude-cli://` 連結，只需點擊即可在正確的儲存庫中使用正確的提示開啟 Claude Code。

#### 指南

- [在 monorepo 或大型程式碼庫中設定 Claude Code](https://code.claude.com/docs/zh-TW/large-codebases.md): 使用巢狀 CLAUDE.md 檔案、稀疏 worktrees、程式碼智能和按套件技能為 monorepos 和大型單樹程式碼庫設定 Claude Code，讓 Claude 專注於您正在處理的程式碼。

#### 疑難排解

- [排除安裝和登入問題](https://code.claude.com/docs/zh-TW/troubleshoot-install.md): 修復安裝或登入 Claude Code 時的 command not found、PATH、權限、網路和身份驗證錯誤。
- [故障排除](https://code.claude.com/docs/zh-TW/troubleshooting.md): 修復 Claude Code 中的高 CPU 或記憶體使用、掛起、auto-compact 抖動和搜尋問題，並找到其他問題的正確頁面。
- [偵錯您的設定](https://code.claude.com/docs/zh-TW/debug-your-config.md): 診斷為什麼 CLAUDE.md、settings、hooks、MCP servers 或 skills 沒有生效。使用 /context、/doctor、/hooks 和 /mcp 查看實際載入的內容。
- [錯誤參考](https://code.claude.com/docs/zh-TW/errors.md): 查詢 Claude Code 執行時錯誤訊息，了解每個錯誤的含義及修復方法。

### 外掛程式

#### 外掛程式

- [Plugins 概述](https://code.claude.com/docs/zh-TW/plugins/overview.md): 了解什麼是 Claude Code plugin，何時需要使用 plugin 而不是獨立的 skill 或 MCP 伺服器，以及應該閱讀哪個頁面來安裝或建立 plugin。

#### 使用外掛程式

- [安裝和管理外掛程式](https://code.claude.com/docs/zh-TW/plugins/install.md): 從任何使用介面上的市集安裝 Claude Code 外掛程式，選擇安裝範圍，並在稍後更新或移除它們。
- [Anthropic 的 marketplace](https://code.claude.com/docs/zh-TW/plugins/anthropic-marketplaces.md): Anthropic 官方、社群和示範 plugin marketplace for Claude Code：它們的名稱、儲存庫、如何新增每個，以及在哪裡瀏覽它們的 plugin。
- [Code intelligence plugins](https://code.claude.com/docs/zh-TW/plugins/code-intelligence.md): 安裝語言伺服器外掛程式，讓 Claude 在編輯後看到型別錯誤並按符號導覽程式碼，並回應 LSP 外掛程式建議對話框。
- [Plugin 安全性和信任](https://code.claude.com/docs/zh-TW/plugins/security.md): 在安裝 plugin 之前決定是否信任它，從 plugin 在您的機器上可以執行的操作，到如何檢查它和移除它。

#### 建立外掛程式

- [建立 Claude Code 外掛程式](https://code.claude.com/docs/zh-TW/plugins/create.md): 從空目錄建立您的第一個 Claude Code 外掛程式，在沒有市集的情況下測試它，並轉換現有的 .claude/ 設定。
- [新增元件至外掛程式](https://code.claude.com/docs/zh-TW/plugins/components.md): 新增技能、hooks、MCP 伺服器及其他所有元件類型至 Claude Code 外掛程式，並提供每種元件的驗證範例。
- [外掛程式相依性](https://code.claude.com/docs/zh-TW/plugins/dependencies.md): 宣告您的外掛程式所依賴的外掛程式，使用版本範圍如 ^1.2，並查看 Claude Code 如何安裝、解析和修剪它們。
- [使用 evals 測試 plugins](https://code.claude.com/docs/zh-TW/plugin-evals.md): 為您的 Claude Code plugin 編寫 eval 案例，使用 claude plugin eval 執行它們，評分結果，與無 plugin 基準線進行比較，並在 CI 中根據分數進行把關。
- [發佈和分發外掛程式](https://code.claude.com/docs/zh-TW/plugins/publish.md): 透過您自己的市集或 Anthropic 的社群市集發佈 Claude Code 外掛程式，包括發行前檢查清單以及使用者如何取得更新。
- [測量外掛程式成本和使用情況](https://code.claude.com/docs/zh-TW/plugins/measure.md): 測量 Claude Code 外掛程式的權杖成本，了解人們是否仍在使用它，並為組織範圍的外掛程式問題選擇遙測事件。
- [從您的 CLI 推薦您的外掛程式](https://code.claude.com/docs/zh-TW/plugins/cli-hints.md): 透過從您的 CLI 或 SDK 發出 claude-code-hint 標籤，提示 Claude Code 使用者安裝您的官方市場外掛程式。

#### 執行 marketplace

- [建立 marketplace](https://code.claude.com/docs/zh-TW/plugins/create-marketplace.md): 從 marketplace.json 檔案建立 plugin marketplace，並在託管前在本機測試。
- [託管和維護市集](https://code.claude.com/docs/zh-TW/plugins/host-marketplace.md): 發佈一個外掛程式市集，讓使用者可以透過 /plugin marketplace add 新增它、安裝其外掛程式，並在您推送變更後持續接收更新。
- [為您的組織推薦 plugins](https://code.claude.com/docs/zh-TW/plugins/relevance.md): 在 marketplace plugin 項目中新增相關性區塊，以便當使用者的工作符合時 Claude Code 會建議安裝，並在受管設定中將 marketplace 加入允許清單。

#### 管理您組織的外掛程式

- [為您的組織管理 Claude Code 外掛程式](https://code.claude.com/docs/zh-TW/plugins/org.md): 透過受管設定控制 Claude Code 在組織中每台機器上安裝和允許的外掛程式。

#### 疑難排解

- [排除外掛程式故障](https://code.claude.com/docs/zh-TW/plugins/troubleshooting.md): 修復 Claude Code 中的外掛程式錯誤。找到您看到的確切訊息，按照 /plugin 執行、安裝和組織政策的階段分組。
- [Plugin 載入參考](https://code.claude.com/docs/zh-TW/plugins/loading.md): 追蹤 Claude Code 從何處載入每個 plugin，哪個設定檔決定是否載入，以及為什麼更新沒有改變任何內容。

#### 參考資料

- [Plugin manifest 參考](https://code.claude.com/docs/zh-TW/plugins/manifest-reference.md): plugin.json 的完整參考：每個欄位的類型和預設值、接受的路徑形式，以及 userConfig 和環境變數架構。
- [Plugin 命令參考](https://code.claude.com/docs/zh-TW/plugins/cli-reference.md): claude plugin shell 命令的完整參考，包括在工作階段中的 /plugin 和 /reload-plugins，以及在單一工作階段中載入 plugin 的旗標。

### 管理

#### 設定與存取

- [為您的組織設定 Claude Code](https://code.claude.com/docs/zh-TW/admin-setup.md): 管理員部署 Claude Code 的決策地圖，涵蓋 API 提供者、受管設定、政策執行、使用情況監控和資料處理。
- [進階設定](https://code.claude.com/docs/zh-TW/setup.md): Claude Code 的系統需求、平台特定安裝、版本管理和卸載。
- [驗證](https://code.claude.com/docs/zh-TW/authentication.md): 登入 Claude Code 並為個人、團隊和組織配置驗證。
- [部署受管設定](https://code.claude.com/docs/zh-TW/managed-settings.md): 將受管設定部署到每個開發者的機器：每個作業系統的傳遞機制、Claude Code 如何結合受管來源，以及如何驗證強制執行。
- [設定伺服器管理的設定](https://code.claude.com/docs/zh-TW/server-managed-settings.md): 透過伺服器傳遞的設定在您的組織中集中設定 Claude Code，無需裝置管理基礎設施。
- [控制組織的 MCP 伺服器存取](https://code.claude.com/docs/zh-TW/managed-mcp.md): 使用受管設定檔、受管設定、允許清單和拒絕清單，限制使用者可以新增或連線的 MCP 伺服器，或為每位使用者提供伺服器。
- [設定自動模式](https://code.claude.com/docs/zh-TW/auto-mode-config.md): 告訴自動模式分類器您的組織信任哪些儲存庫、儲存桶和網域。設定環境內容、覆蓋預設的封鎖和允許規則，並使用自動模式 CLI 子命令檢查您的有效設定。

#### 部署

- [企業部署概述](https://code.claude.com/docs/zh-TW/third-party-integrations.md): 了解 Claude Code 如何與各種第三方服務和基礎設施整合，以滿足企業部署需求。
- [功能可用性](https://code.claude.com/docs/zh-TW/feature-availability.md): 比較 Claude Code 功能在 Anthropic 訂閱計畫、Anthropic Console、Amazon Bedrock、AWS 上的 Claude Platform、Google Cloud 的 Agent Platform 和 Microsoft Foundry 中的可用性。
- [Amazon Bedrock 上的 Claude Code](https://code.claude.com/docs/zh-TW/amazon-bedrock.md): 了解如何透過 Amazon Bedrock 設定 Claude Code，包括設定、IAM 設定和故障排除。
- [AWS 上的 Claude Platform 上的 Claude Code](https://code.claude.com/docs/zh-TW/claude-platform-on-aws.md): 設定 Claude Code 以使用 Anthropic 營運的 Claude API，搭配 AWS 驗證、IAM 存取控制和 AWS Marketplace 計費。
- [Google Cloud 的 Agent Platform 上的 Claude Code](https://code.claude.com/docs/zh-TW/google-vertex-ai.md): 了解如何透過 Google Cloud 的 Agent Platform（前身為 Vertex AI）設定 Claude Code，包括設定、IAM 設定和故障排除。
- [Microsoft Foundry 上的 Claude Code](https://code.claude.com/docs/zh-TW/microsoft-foundry.md): 了解如何透過 Microsoft Foundry 配置 Claude Code，包括設定、配置和故障排除。
- [企業網路設定](https://code.claude.com/docs/zh-TW/network-config.md): 為企業環境設定 Claude Code，包括代理伺服器、自訂憑證授權單位 (CA) 和相互傳輸層安全性 (mTLS) 驗證。
- [在公司啟動程式後面執行 Claude Code](https://code.claude.com/docs/zh-TW/corporate-launcher.md): 使用 CLAUDE_CODE_PROCESS_WRAPPER 或 processWrapper 設定，透過必要的啟動程式路由 Claude Code 從其自身二進位檔案啟動的程序，包括背景服務和每個代理檢視工作階段。
- [開發容器](https://code.claude.com/docs/zh-TW/devcontainer.md): 在開發容器中執行 Claude Code，為您的團隊提供一致、隔離的環境。

#### 閘道

- [透過閘道執行 Claude Code](https://code.claude.com/docs/zh-TW/gateways.md): 透過自託管閘道路由 Claude Code，以實現集中式認證、使用情況追蹤和成本控制。涵蓋架構、Anthropic 的 Claude 應用程式閘道和使用其他閘道產品。

##### Claude 應用程式閘道

- [Amazon Bedrock、Claude Platform on AWS、Google Cloud 和 Microsoft Foundry 的 Claude 應用程式閘道](https://code.claude.com/docs/zh-TW/claude-apps-gateway.md): 透過自託管閘道在 Amazon Bedrock、Claude Platform on AWS、Google Cloud 或 Microsoft Foundry 上執行 Claude Code，具備 SSO 登入、按群組模型存取和 OTLP 遙測功能。
- [Claude 應用程式閘道設定](https://code.claude.com/docs/zh-TW/claude-apps-gateway-config.md): 每個 gateway.yaml 選項的參考資料：監聽器和 TLS、OIDC、工作階段、Postgres 存放區、Amazon Bedrock、Claude Platform on AWS、Google Cloud 的 Agent Platform 和 Microsoft Foundry 上游、模型路由、受管原則和遙測。
- [Claude 應用程式閘道支出限制](https://code.claude.com/docs/zh-TW/claude-apps-gateway-spend-limits.md): 透過 Claude 應用程式閘道限制每位開發人員的每日、每週或每月支出。使用管理員 API 設定限制，閘道會在每個請求上即時執行這些限制。
- [Claude 應用程式閘道部署和運營](https://code.claude.com/docs/zh-TW/claude-apps-gateway-deploy.md): 向您的身份提供者註冊閘道、建置容器、在 Kubernetes 或 Cloud Run 上部署，並運營它：健康檢查、祕密輪換、升級和安全性。
- [在 AWS 上部署 Claude apps gateway](https://code.claude.com/docs/zh-TW/claude-apps-gateway-on-aws.md): 在 AWS 上執行 Claude apps gateway 的實際範例：ECS Fargate 或 EKS、Amazon RDS for PostgreSQL、AWS Secrets Manager 和 IAM 角色驗證至 Amazon Bedrock。
- [在 Google Cloud 上部署 Claude 應用程式閘道](https://code.claude.com/docs/zh-TW/claude-apps-gateway-on-gcp.md): 在 Google Cloud 上執行 Claude 應用程式閘道的實際範例：Cloud Run 或 GKE、Cloud SQL for PostgreSQL、Secret Manager，以及對 Google Cloud 的 Agent Platform 的服務帳戶驗證。

##### 其他閘道

- [其他 LLM 閘道](https://code.claude.com/docs/zh-TW/llm-gateway.md): 透過貴組織已執行的 LLM 閘道路由 Claude Code。涵蓋將 Claude Code 連接到閘道、為貴組織推出閘道，以及 Claude Code 傳送到閘道的內容。
- [將 Claude Code 連接到 LLM 閘道](https://code.claude.com/docs/zh-TW/llm-gateway-connect.md): 將 Claude Code 指向您組織的 LLM 閘道。檢查您的管理員是否已配置它，或自行設定基礎 URL 和認證，然後驗證連接並修復閘道錯誤。
- [為您的組織推出 LLM 閘道](https://code.claude.com/docs/zh-TW/llm-gateway-rollout.md): 為 Claude Code 部署閘道產品：配置它以轉發 Claude Code 發送的內容、發放開發者認證、透過受管設定分發配置，並驗證推出。
- [Claude Code 閘道相容性指南](https://code.claude.com/docs/zh-TW/llm-gateway-protocol.md): 保持 LLM 閘道與 Claude Code 相容：它呼叫的端點、必須轉發的標頭和本體欄位，以及移除它們時會中斷的功能。

#### 使用量與成本

- [監控](https://code.claude.com/docs/zh-TW/monitoring-usage.md): 了解如何為 Claude Code 啟用和配置 OpenTelemetry。
- [有效管理成本](https://code.claude.com/docs/zh-TW/costs.md): 追蹤 token 使用情況、設定團隊支出限制，並透過上下文管理、模型選擇、延伸思考設定和預處理 hooks 來降低 Claude Code 成本。
- [使用分析追蹤團隊使用情況](https://code.claude.com/docs/zh-TW/analytics.md): 在分析儀表板中檢視 Claude Code 使用指標、追蹤採用情況，並衡量 Claude Code 對工程速度的影響。

#### 安全性和資料

- [安全性](https://code.claude.com/docs/zh-TW/security.md): 了解 Claude Code 的安全防護措施和安全使用的最佳實踐。
- [資料使用](https://code.claude.com/docs/zh-TW/data-usage.md): 了解 Anthropic 對 Claude 資料使用政策
- [零資料保留](https://code.claude.com/docs/zh-TW/zero-data-retention.md): 了解 Claude for Enterprise 合格帳戶可用的 Claude Code 零資料保留 (ZDR)，包括範圍、停用的功能，以及如何要求啟用。

#### 採用

- [通訊工具包](https://code.claude.com/docs/zh-TW/communications-kit.md): 推出公告、滴灌式行銷訊息和常見問題解答，用於在您的工程組織中推出 Claude Code。
- [Champion kit](https://code.claude.com/docs/zh-TW/champion-kit.md): 工程師在內部倡導 Claude Code 的行動手冊：分享什麼、如何回答問題，以及如何在團隊中推動採用。

### 設定

#### 設定

- [設定檔案和優先順序](https://code.claude.com/docs/zh-TW/settings.md): 變更 Claude Code 設定、選擇金鑰所屬的範圍、驗證變更，並了解當金鑰在多個位置設定時 Claude Code 使用哪個值。
- [所有設定](https://code.claude.com/docs/zh-TW/settings-reference.md): Claude Code settings.json 的完整參考：每個鍵的位置、類型和預設值，以及隨時可貼上的範例，包含每個鍵的索引。
- [設定檔範例](https://code.claude.com/docs/zh-TW/settings-example.md): 開發者、團隊和組織的實際 settings.json 檔案：複製其中一個，保留您想要的鍵，並變更數值。

#### 權限與 sandboxing

- [設定權限](https://code.claude.com/docs/zh-TW/permissions.md): 使用細粒度權限規則、模式和受管理原則來控制 Claude Code 可以存取和執行的操作。
- [選擇權限模式](https://code.claude.com/docs/zh-TW/permission-modes.md): 控制 Claude 在採取動作前是否詢問。在 CLI 中使用 Shift+Tab、在 VS Code 中使用模式指示器，或在 Desktop 中使用模式選擇器來切換權限模式。
- [設定沙箱化 Bash 工具](https://code.claude.com/docs/zh-TW/sandboxing.md): 了解 Claude Code 的沙箱化 Bash 工具如何提供檔案系統和網路隔離，以實現更安全、更自主的代理執行。
- [選擇沙箱環境](https://code.claude.com/docs/zh-TW/sandbox-environments.md): 比較 Claude Code 沙箱選項：內建的沙箱化 Bash 工具、sandbox runtime、dev containers、Docker 和虛擬機。為您的威脅模型選擇適當的隔離。

#### 環境

- [設定雲端環境](https://code.claude.com/docs/zh-TW/cloud-environments.md): 為 Claude Code 雲端工作階段設定雲端環境：網路存取層級、環境變數、設定指令碼和環境快取。

##### 自行託管環境

- [自託管環境](https://code.claude.com/docs/zh-TW/self-hosted-environments.md): 在您控制的基礎設施上執行 Claude Code 雲端工作階段：設定自託管環境、部署執行器，並將工作階段路由到您自己的運算資源。
- [自託管環境快速入門](https://code.claude.com/docs/zh-TW/self-hosted-environments-quickstart.md): 設定您的第一個自託管環境：安裝 Claude Code、建立環境、啟動執行器，並將工作階段路由到該環境。
- [將自託管環境部署到生產環境](https://code.claude.com/docs/zh-TW/self-hosted-environments-deploy.md): 在生產環境中執行自託管執行器：安全強化、網路出站流量控制、Git 認證、Kubernetes 和 Compose 配方，以及故障排除。
- [在自託管環境中自訂會話](https://code.claude.com/docs/zh-TW/self-hosted-environments-configuration.md): 使用包裝指令碼在自託管環境會話中自訂每個會話的認證、生命週期掛鉤和按需執行器生成。
- [端對端測試自託管環境](https://code.claude.com/docs/zh-TW/self-hosted-environments-testing.md): 從 CI 驗證自託管執行器映像：使用 CLI 分派工作階段、透過 Stop hook 讀取 Claude 的回覆，並編寫完整迴圈的指令碼。
- [自託管環境參考](https://code.claude.com/docs/zh-TW/self-hosted-environments-reference.md): 自託管執行器和協調器的完整參考：CLI 旗標、環境變數和 Prometheus 指標。
- [在自託管環境中驗證工作階段身分](https://code.claude.com/docs/zh-TW/self-hosted-environments-identity.md): 驗證 CLAUDE_CODE_SESSION_ACCESS_TOKEN JWT，以便您網路上的服務可以信任來自自託管環境中工作階段的請求。

#### 模型與回應

- [模型配置](https://code.claude.com/docs/zh-TW/model-config.md): 了解 Claude Code 模型配置，包括模型別名如 `opusplan`
- [使用快速模式加快回應速度](https://code.claude.com/docs/zh-TW/fast-mode.md): 在 Claude Code 中切換快速模式，以獲得更快的 Opus 回應。
- [使用顧問工具升級困難決策](https://code.claude.com/docs/zh-TW/advisor.md): 將您的主要模型與更強大的顧問模型配對，Claude 在任務期間的關鍵時刻會諮詢該模型。
- [輸出樣式](https://code.claude.com/docs/zh-TW/output-styles.md): 使用內建輸出樣式（例如簡潔或詳細說明）改變 Claude Code 的角色、語氣和回應格式，或撰寫自訂樣式。

#### 介面

- [為 Claude Code 設定您的終端機](https://code.claude.com/docs/zh-TW/terminal-config.md): 修正 Shift+Enter 以插入新行、在 Claude 完成時取得終端機鈴聲、設定 tmux、符合色彩主題，以及在 Claude Code CLI 中啟用 Vim 模式。
- [全螢幕渲染](https://code.claude.com/docs/zh-TW/fullscreen.md): 啟用更平順、無閃爍的渲染模式，具有滑鼠支援和穩定的記憶體使用，適用於長對話。
- [使用 Claude Code 搭配螢幕閱讀器](https://code.claude.com/docs/zh-TW/accessibility.md): 為 VoiceOver 和 NVDA 等螢幕閱讀器設定 Claude Code，以及螢幕放大鏡、減少動畫和色盲友善主題的設定。
- [語音聽寫](https://code.claude.com/docs/zh-TW/voice-dictation.md): 在 Claude Code CLI 中使用按住錄音或點擊錄音的語音聽寫功能來說出您的提示。
- [自訂您的狀態列](https://code.claude.com/docs/zh-TW/statusline.md): 設定自訂狀態列以監控 Claude Code 中的 context window 使用情況、成本和 git 狀態
- [自訂鍵盤快捷鍵](https://code.claude.com/docs/zh-TW/keybindings.md): 使用快捷鍵配置檔案在 Claude Code 中自訂鍵盤快捷鍵。

### 參考資料

#### 參考資料

- [CLI 參考](https://code.claude.com/docs/zh-TW/cli-reference.md): Claude Code 命令列介面的完整參考，包括命令和旗標。
- [Commands](https://code.claude.com/docs/zh-TW/commands.md): Claude Code 中可用命令的完整參考，包括內建命令和捆綁的 skills。
- [環境變數](https://code.claude.com/docs/zh-TW/env-vars.md): 控制 Claude Code 行為的環境變數參考。
- [工具參考](https://code.claude.com/docs/zh-TW/tools-reference.md): Claude Code 可以使用的工具完整參考，包括權限要求和各工具行為。
- [互動模式](https://code.claude.com/docs/zh-TW/interactive-mode.md): Claude Code 會話中鍵盤快捷鍵、輸入模式和互動功能的完整參考。
- [Checkpointing](https://code.claude.com/docs/zh-TW/checkpointing.md): 追蹤、回溯和總結 Claude 的編輯和對話以管理會話狀態。
- [Hooks 參考](https://code.claude.com/docs/zh-TW/hooks.md): Claude Code hook 事件、配置架構、JSON 輸入/輸出格式、退出代碼、非同步 hooks、HTTP hooks、提示 hooks 和 MCP 工具 hooks 的參考。
- [Channels 參考](https://code.claude.com/docs/zh-TW/channels-reference.md): 建立一個 MCP 伺服器，將 webhooks、警報和聊天訊息推送到 Claude Code 工作階段。頻道合約的參考：功能聲明、通知事件、回覆工具、寄件者閘道和權限中繼。

#### 詞彙表

- [詞彙表](https://code.claude.com/docs/zh-TW/glossary.md): Claude Code 術語定義。了解 agentic loop、compaction、CLAUDE.md、hooks、subagents、MCP 和其他核心概念的含義。

### Agent SDK

#### Agent SDK

- [Agent SDK 概述](https://code.claude.com/docs/zh-TW/agent-sdk/overview.md): 使用 Claude Code 作為程式庫構建生產級 AI 代理
- [快速開始](https://code.claude.com/docs/zh-TW/agent-sdk/quickstart.md): 使用 Python 或 TypeScript Agent SDK 開始構建能夠自主工作的 AI 代理
- [遷移至 Claude Agent SDK](https://code.claude.com/docs/zh-TW/agent-sdk/migration-guide.md): 將 Claude Code TypeScript 和 Python SDK 遷移至 Claude Agent SDK 的指南
- [排除 Agent SDK 的故障](https://code.claude.com/docs/zh-TW/agent-sdk/troubleshooting.md): 當 Claude Code CLI 無法啟動、CLI 程序退出或成功結果到達但沒有結構化輸出時，修復 Agent SDK 錯誤。

#### 建立代理程式

- [設定您的代理](https://code.claude.com/docs/zh-TW/agent-sdk/configuration.md): 設定 Agent SDK 工作階段：組合選項物件、設定模型、環境和限制，並找到每個功能選項的頁面。
- [範例](https://code.claude.com/docs/zh-TW/agent-sdk/examples.md): 尋找完整、可執行的 Agent SDK 專案或 Claude Cookbook 中的引導式配方，以符合您想要建置的內容。

#### 核心概念

- [代理程式迴圈如何運作](https://code.claude.com/docs/zh-TW/agent-sdk/agent-loop.md): 了解訊息生命週期、工具執行、上下文視窗和支援 SDK 代理程式的架構。
- [在 SDK 中使用 Claude Code 功能](https://code.claude.com/docs/zh-TW/agent-sdk/claude-code-features.md): 將專案指令、skills、hooks 和其他 Claude Code 功能載入到您的 SDK 代理中。
- [使用 sessions](https://code.claude.com/docs/zh-TW/agent-sdk/sessions.md): Sessions 如何保持代理對話歷史，以及何時使用 continue、resume 和 fork 返回到先前的運行。
- [將工作階段持久化到外部儲存](https://code.claude.com/docs/zh-TW/agent-sdk/session-storage.md): 將 Agent SDK 工作階段文字記錄鏡像到您自己的物件儲存、鍵值儲存或資料庫，以便其他主機可以繼續您的工作階段。

#### 輸入和輸出

- [串流輸入](https://code.claude.com/docs/zh-TW/agent-sdk/streaming-vs-single-mode.md): 了解 Claude Agent SDK 的兩種輸入模式及何時使用各種模式
- [處理批准和使用者輸入](https://code.claude.com/docs/zh-TW/agent-sdk/user-input.md): 將 Claude 的批准請求和澄清問題呈現給使用者，然後將他們的決定返回給 SDK。
- [即時串流回應](https://code.claude.com/docs/zh-TW/agent-sdk/streaming-output.md): 當文字和工具呼叫串流進來時，從 Agent SDK 取得即時回應
- [從代理獲取結構化輸出](https://code.claude.com/docs/zh-TW/agent-sdk/structured-outputs.md): 使用 JSON Schema、Zod 或 Pydantic 從代理工作流程返回驗證的 JSON。在多輪工具使用後獲得類型安全的結構化資料。

#### 使用工具擴充

- [為 Claude 提供自訂工具](https://code.claude.com/docs/zh-TW/agent-sdk/custom-tools.md): 使用 Claude Agent SDK 的同程序 MCP 伺服器定義自訂工具，讓 Claude 可以呼叫您的函數、存取您的 API，並執行特定領域的操作。
- [使用 MCP 連接外部工具](https://code.claude.com/docs/zh-TW/agent-sdk/mcp.md): 配置 MCP 伺服器以擴展您的代理程式的外部工具。涵蓋傳輸類型、大型工具集的工具搜尋、身份驗證和錯誤處理。
- [使用工具搜尋擴展到許多工具](https://code.claude.com/docs/zh-TW/agent-sdk/tool-search.md): 通過動態發現和按需加載，將您的代理擴展到數千個工具。
- [SDK 中的子代理](https://code.claude.com/docs/zh-TW/agent-sdk/subagents.md): 定義並調用子代理以隔離上下文、並行運行任務，以及在 Claude Agent SDK 應用程式中應用專門指令。

#### 自訂行為

- [修改系統提示詞](https://code.claude.com/docs/zh-TW/agent-sdk/modifying-system-prompts.md): 在 `claude_code` 預設和自訂系統提示詞之間選擇，並使用 CLAUDE.md、輸出樣式、append 或完全自訂提示詞來自訂行為。
- [使用 Skills 擴展 Agent](https://code.claude.com/docs/zh-TW/agent-sdk/skills.md): 控制 Claude 在 Claude Agent SDK 會話中可以調用的 Skills，按名稱分派命令，以及編寫會話發現的 Skills
- [SDK 中的 Plugins](https://code.claude.com/docs/zh-TW/agent-sdk/plugins.md): 通過 Agent SDK 加載自訂 plugins，以使用 skills、agents、hooks 和 MCP servers 擴展 Claude Code

#### 控制與可觀測性

- [設定權限](https://code.claude.com/docs/zh-TW/agent-sdk/permissions.md): 使用權限模式、hooks 和宣告式允許/拒絕規則來控制您的代理程式如何使用工具。
- [使用 hooks 攔截和控制代理行為](https://code.claude.com/docs/zh-TW/agent-sdk/hooks.md): 在代理執行的關鍵點使用 hooks 攔截和自訂代理行為
- [使用 checkpointing 回溯檔案變更](https://code.claude.com/docs/zh-TW/agent-sdk/file-checkpointing.md): 追蹤代理程式工作階段期間的檔案變更，並將檔案還原到任何先前的狀態
- [追蹤成本和使用量](https://code.claude.com/docs/zh-TW/agent-sdk/cost-tracking.md): 了解如何追蹤 token 使用量、估計成本，以及使用 Claude Agent SDK 設定 prompt caching。
- [使用 OpenTelemetry 進行可觀測性](https://code.claude.com/docs/zh-TW/agent-sdk/observability.md): 使用 OpenTelemetry 將追蹤、指標和事件從 Agent SDK 匯出到您的可觀測性後端。
- [追蹤待辦事項](https://code.claude.com/docs/zh-TW/agent-sdk/todo-tracking.md): 在 Agent SDK 工作階段中追蹤待辦事項，並從結構化工具呼叫在應用程式中呈現 Claude 的進度

#### 部署

- [代理 SDK 的託管](https://code.claude.com/docs/zh-TW/agent-sdk/hosting.md): 在生產環境中部署 Agent SDK：子程序架構、工作階段持久化、擴展、可觀測性，以及針對 Docker、Kubernetes 和沙箱提供者的多租戶隔離。
- [安全部署 AI 代理](https://code.claude.com/docs/zh-TW/agent-sdk/secure-deployment.md): 一份關於使用隔離、認證管理和網路控制來保護 Claude Code 和 Agent SDK 部署的指南

#### SDK 參考資料

- [Agent SDK 參考 - TypeScript](https://code.claude.com/docs/zh-TW/agent-sdk/typescript.md): TypeScript Agent SDK 的完整 API 參考，包括所有函數、類型和介面。
- [TypeScript SDK V2 會話 API（已移除）](https://code.claude.com/docs/zh-TW/agent-sdk/typescript-v2-preview.md): 已移除的 V2 TypeScript Agent SDK 會話 API 參考，具有用於多輪對話的基於會話的 send/stream 模式。
- [Agent SDK 參考 - Python](https://code.claude.com/docs/zh-TW/agent-sdk/python.md): Python Agent SDK 的完整 API 參考，包括所有函數、類型和類別。

### 最新消息

#### 最新消息

- [最新動態](https://code.claude.com/docs/zh-TW/whats-new/index.md): Claude Code 功能的每週摘要，包含程式碼片段、示範和背景說明。
- [第 37 週 · 2026 年 9 月 7–11 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w37.md): 使用 claude plugin eval 測試您的外掛程式，並將 Claude Code Desktop 窗格彈出到各自的視窗中。
- [第 36 週 · 8 月 31 日 – 9 月 4 日，2026 年](https://code.claude.com/docs/zh-TW/whats-new/2026-w36.md): 切換至 Claude Fable 5.1，讓電腦使用在 Desktop 上於背景執行，並在即時 /diff 面板中觀看 Claude 的編輯。
- [第 35 週 · 2026 年 8 月 24–28 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w35.md): 在 Claude Code Desktop 應用程式中復原終端機工作階段、檢閱 Claude 為您起草的意見回饋報告，以及在受限模式中啟動工作階段。
- [第 34 週 · 2026 年 8 月 17–21 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w34.md): 使用 /design 技能草擬可編輯的 UI 畫板、設定簡潔輸出風格，以及從手機在您的機器上啟動 Claude Code 工作階段。
- [第 33 週 · 2026 年 8 月 10–14 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w33.md): Claude Code Desktop 在使用限制重設後自動繼續，Fork 模式預設開啟，GitLab 合併請求和市集加入 GitHub。
- [第 32 週 · 2026 年 8 月 3–7 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w32.md): Claude Code 工作階段可以互相傳送訊息、自託管環境在您的基礎設施上執行雲端工作階段，以及自動模式成為預設權限模式。
- [第 30 週 · 7 月 20–24 日，2026 年](https://code.claude.com/docs/zh-TW/whats-new/2026-w30.md): Opus 5 成為預設的 Opus 模型，Claude Code Desktop 新增 iOS Simulator 窗格，Claude Security plugin 掃描您的程式碼以尋找漏洞。
- [第 29 週 · 2026 年 7 月 13–17 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w29.md): 透過 MCP 連接器將即時資料拉入已發佈的成品中，並在新的螢幕閱讀器模式中使用 Claude Code 搭配螢幕閱讀器。
- [第 28 週 · 2026 年 7 月 6–10 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w28.md): 從桌面應用程式的內建瀏覽器瀏覽外部網站、使用 /doctor 執行完整設定檢查，以及取得自動模式文字記錄保護和代理程式檢視升級。
- [第 27 週 · 6 月 29 日 – 7 月 3 日，2026 年](https://code.claude.com/docs/zh-TW/whats-new/2026-w27.md): Claude Sonnet 5 成為預設模型，Claude in Chrome 達到正式推出，子代理預設在背景執行，Claude Desktop 在 Linux 上推出測試版，/radio 調頻至 Claude FM。
- [第 26 週 · 2026 年 6 月 22–26 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w26.md): 使用 claude mcp login 從您的 shell 驗證 MCP 伺服器，使用 ! 前綴取得 shell 模式命令輸出的回應，以及使用 /rewind 從 /clear 之前恢復對話。
- [第 25 週 · 2026 年 6 月 15–19 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w25.md): 從您的工作階段使用 Artifacts 發佈即時可分享的頁面、在拒絕和詢問規則中比對工具參數，以及使用 /config 從提示設定任何設定。
- [第 24 週 · 2026 年 6 月 8–12 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w24.md): 使用 /cd 將工作階段移至新目錄、讓子代理程式產生自己的子代理程式，以及使用安全模式對損壞的設定進行故障排除。
- [第 23 週 · 2026 年 6 月 1–5 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w23.md): 在 Amazon Bedrock、Google Cloud 的 Agent Platform 和 Microsoft Foundry 上執行自動模式，在 acceptEdits 模式下提示寫入可執行程式碼的檔案，使用 /plugin list 列出已安裝的外掛程式，以及為受管部署要求已核准的版本範圍。
- [第 22 週 · 5 月 25–29 日，2026 年](https://code.claude.com/docs/zh-TW/whats-new/2026-w22.md): 在 Claude Opus 4.8 上執行 Claude Code、使用動態工作流程協調大型任務、使用 security-guidance 外掛程式捕捉安全問題，以及以更低的價格在 Opus 4.8 上使用快速模式。
- [第 21 週 · 2026 年 5 月 18–22 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w21.md): 在 Pro 方案上使用 auto mode 並搭配 Sonnet 4.6，在 /usage 中查看哪些 skills、subagents 和 MCP servers 推動您的方案限制，並使用新的 /code-review 命令檢查差異。
- [第 20 週 · 2026 年 5 月 11–15 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w20.md): 從一個螢幕管理每個 Claude Code 工作階段，使用代理檢視，讓 Claude 持續朝著目標工作直到條件成立，並在 Opus 4.7 上預設執行快速模式。
- [第 19 週 · 2026 年 5 月 4–8 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w19.md): 從 .zip 檔案和 URL 載入 plugins，使用 Ctrl+R 搜尋所有專案的命令歷史記錄，從本機 HEAD 或遠端預設分支建立新 worktrees，以及使用 auto mode hard deny 規則無條件地阻止操作。
- [第 18 週 · 4 月 27 日 – 5 月 1 日，2026 年](https://code.claude.com/docs/zh-TW/whats-new/2026-w18.md): Claude Code 在 Windows 上無需 Git Bash 即可運行，claude auth login 在瀏覽器回調無法到達 localhost 時接受貼上的 OAuth 代碼，claude project purge 清理每個專案的本地狀態，將 PR URL 貼到 /resume 中可找到建立該會話的會話。
- [第 17 週 · 2026 年 4 月 20–24 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w17.md): /ultrareview 作為研究預覽版開放，當您返回終端時自動生成會話摘要，您可以在插件中構建和發佈自訂色彩主題，以及重新設計的網頁版 Claude Code。
- [第 16 週 · 2026 年 4 月 13–17 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w16.md): Claude Opus 4.7 搭配新的 xhigh 努力等級、Claude Code 網頁版上的 Routines、行動推播通知在 Claude 需要您時 ping 您的手機、顯示限制驅動因素的 /usage 細目分析，以及取代捆綁 JavaScript 的原生二進位檔。
- [第 15 週 · 2026 年 4 月 6–10 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w15.md): Ultraplan 雲端規劃、具有自我調整 /loop 的 Monitor 工具、用於打包設定的 /team-onboarding，以及從終端執行的 /autofix-pr。
- [第 14 週 · 3 月 30 日 – 4 月 3 日，2026 年](https://code.claude.com/docs/zh-TW/whats-new/2026-w14.md): CLI 中的電腦使用、互動式產品內課程、無閃爍渲染、按工具 MCP 結果大小覆蓋，以及 PATH 上的外掛程式可執行檔。
- [第 13 週 · 2026 年 3 月 23–27 日](https://code.claude.com/docs/zh-TW/whats-new/2026-w13.md): 自動模式用於免提權限、內建電腦使用、雲端 PR 自動修復、文字稿搜尋，以及適用於 Windows 的 PowerShell 工具。

### 資源

#### 資源

- [法律和合規](https://code.claude.com/docs/zh-TW/legal-and-compliance.md): Claude Code 的法律協議、合規認證和安全資訊。
