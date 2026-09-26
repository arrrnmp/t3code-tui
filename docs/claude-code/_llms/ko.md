# Claude Code Docs: Korean

> Official documentation for Claude Code, Anthropic's agentic coding tool available in the terminal, IDE, desktop app, and browser. Covers installation, configuration, skills, subagents, hooks, MCP, the Agent SDK, and reference material.

## Korean

### 시작하기

#### 시작하기

- [개요](https://code.claude.com/docs/ko/overview.md): Claude Code는 코드베이스를 읽고, 파일을 편집하고, 명령을 실행하고, 개발 도구와 통합하는 에이전트 코딩 도구입니다. 터미널, IDE, 데스크톱 앱 및 브라우저에서 사용할 수 있습니다.
- [빠른 시작](https://code.claude.com/docs/ko/quickstart.md): Claude Code에 오신 것을 환영합니다!
- [변경 로그](https://code.claude.com/docs/ko/changelog.md)

#### 핵심 개념

- [Claude Code의 작동 방식](https://code.claude.com/docs/ko/how-claude-code-works.md): 에이전트 루프, 내장 도구, Claude Code가 프로젝트와 상호작용하는 방식을 이해합니다.
- [Claude Code 확장하기](https://code.claude.com/docs/ko/features-overview.md): CLAUDE.md, Skills, subagents, hooks, MCP, 플러그인을 언제 사용할지 이해합니다.
- [.claude 디렉토리 탐색](https://code.claude.com/docs/ko/claude-directory.md): Claude Code가 CLAUDE.md, settings.json, hooks, skills, commands, subagents, workflows, rules, auto memory를 읽는 위치입니다. 프로젝트의 .claude 디렉토리와 홈 디렉토리의 ~/.claude를 탐색합니다.
- [컨텍스트 윈도우 살펴보기](https://code.claude.com/docs/ko/context-window.md): Claude Code의 컨텍스트 윈도우가 세션 중에 어떻게 채워지는지 보여주는 대화형 시뮬레이션입니다. 자동으로 로드되는 항목, 각 파일 읽기의 비용, 규칙과 훅이 언제 실행되는지 확인하세요.
- [Claude Code가 prompt caching을 사용하는 방법](https://code.claude.com/docs/ko/prompt-caching.md): Claude Code는 prompt caching을 자동으로 관리합니다. 모델 전환이 느린 캐시되지 않은 턴을 트리거하는 이유, `/compact`의 비용, CLAUDE.md 편집이 세션 중에 적용되지 않는 이유, 캐시 히트율을 확인하는 방법을 알아봅니다.

#### Claude Code 사용하기

- [Claude가 프로젝트를 기억하는 방법](https://code.claude.com/docs/ko/memory.md): CLAUDE.md 또는 AGENTS.md 파일로 Claude에 지속적인 지침을 제공하고, 자동 메모리를 통해 Claude가 자동으로 학습을 축적하도록 합니다.
- [세션 관리](https://code.claude.com/docs/ko/sessions.md): Claude Code 대화의 이름을 지정하고, 재개하고, 분기하고, 전환합니다. `--continue`, `--resume`, `--from-pr`, `/resume` 선택기, 세션 이름 지정, 대화 기록 내보내기 및 대화 기록 저장 위치를 다룹니다.
- [일반적인 워크플로우](https://code.claude.com/docs/ko/common-workflows.md): Claude Code를 사용하여 코드베이스 탐색, 버그 수정, 리팩토링, 테스트 및 기타 일상적인 작업을 위한 단계별 가이드입니다.
- [프롬프트 라이브러리](https://code.claude.com/docs/ko/prompt-library.md): Claude Code에 복사하여 붙여넣을 수 있는 프롬프트 모음으로, 작업과 역할별로 태그가 지정되어 있습니다.
- [Claude Code 모범 사례](https://code.claude.com/docs/ko/best-practices.md): 환경 구성부터 병렬 세션 확장까지 Claude Code를 최대한 활용하기 위한 팁과 패턴입니다.

#### 플랫폼 및 통합

- [플랫폼 및 통합](https://code.claude.com/docs/ko/platforms.md): Claude Code를 실행할 위치를 선택하고 연결할 항목을 결정합니다. CLI, Desktop, VS Code, JetBrains, 웹, 모바일 및 Chrome, Slack, CI/CD와 같은 통합을 비교합니다.
- [모든 기기에서 로컬 세션 계속하기 (Remote Control)](https://code.claude.com/docs/ko/remote-control.md): Remote Control을 사용하여 휴대폰, 태블릿 또는 모든 브라우저에서 로컬 Claude Code 세션을 계속할 수 있습니다. claude.ai/code 및 Claude 모바일 앱과 함께 작동합니다.
- [Claude가 프로젝트로 진행 중인 작업을 조율하도록 하기](https://code.claude.com/docs/ko/claude-projects.md): Claude에게 한 대화에서 관련된 작업 모음을 제공하고 저장소, 지침 및 메모리를 공유하는 병렬 클라우드 세션을 조율하도록 합니다.
- [모바일에서 Claude Code](https://code.claude.com/docs/ko/mobile.md): Claude 앱(iOS 및 Android)을 통해 휴대폰에서 Claude Code 작업을 시작, 모니터링 및 조종합니다.
- [Chrome에서 Claude Code 사용하기](https://code.claude.com/docs/ko/chrome.md): Claude Code를 Chrome 브라우저에 연결하여 웹 앱을 테스트하고, 콘솔 로그로 디버깅하며, 양식 작성을 자동화하고, 웹 페이지에서 데이터를 추출합니다.
- [Claude가 CLI에서 컴퓨터를 사용하도록 설정](https://code.claude.com/docs/ko/computer-use.md): Claude Code CLI에서 컴퓨터 사용을 활성화하여 Claude가 macOS에서 앱을 열고, 클릭하고, 입력하고, 화면을 볼 수 있도록 합니다. 터미널을 떠나지 않고 네이티브 앱을 테스트하고, 시각적 문제를 디버깅하고, GUI 전용 도구를 자동화합니다.
- [VS Code에서 Claude Code 사용하기](https://code.claude.com/docs/ko/vs-code.md): VS Code용 Claude Code 확장 프로그램을 설치하고 구성합니다. 인라인 diff, @-멘션, 계획 검토 및 키보드 단축키를 통해 AI 코딩 지원을 받습니다.
- [JetBrains IDEs](https://code.claude.com/docs/ko/jetbrains.md): Claude Code를 IntelliJ, PyCharm, WebStorm 등 JetBrains IDE와 함께 사용합니다
- [Slack의 Claude Code](https://code.claude.com/docs/ko/slack.md): Slack 워크스페이스에서 직접 코딩 작업을 위임합니다. Anthropic은 Team 및 Enterprise 워크스페이스를 위해 이 이전 버전을 Claude Tag로 대체하고 있으며, Pro 및 Max 플랜에서는 이것이 설정 경로로 유지됩니다.
- [Claude Tag](https://code.claude.com/docs/ko/claude-tag.md): Claude Tag를 사용하여 팀의 Slack 채널에 Claude를 가져오고 claude.com에서 설정 및 사용 설명서를 찾습니다.

##### 클라우드의 Claude Code

- [클라우드에서 Claude Code 시작하기](https://code.claude.com/docs/ko/web-quickstart.md): 브라우저나 휴대폰에서 클라우드에서 Claude Code를 실행합니다. GitHub 저장소를 연결하고, 작업을 제출하고, 로컬 설정 없이 PR을 검토합니다.
- [클라우드에서 Claude Code 사용하기](https://code.claude.com/docs/ko/claude-code-on-the-web.md): 브라우저, 휴대폰, 데스크톱 앱 또는 터미널에서 클라우드의 Claude Code 세션을 실행하고, --cloud 및 --teleport로 이동하며, pull request를 자동 수정합니다.
- [루틴으로 작업 자동화하기](https://code.claude.com/docs/ko/routines.md): Claude Code를 자동 조종 장치에 올려놓으세요. 클라우드 인프라에서 일정에 따라 실행되거나 API 호출로 트리거되거나 GitHub 이벤트에 반응하는 루틴을 정의하세요.
- [ultrareview로 버그 찾기](https://code.claude.com/docs/ko/ultrareview.md): /code-review ultra를 사용하여 클라우드에서 심층적인 다중 에이전트 코드 리뷰를 실행하여 병합 전에 버그를 찾고 검증합니다.

##### Claude Code 데스크톱

- [데스크톱 앱 시작하기](https://code.claude.com/docs/ko/desktop-quickstart.md): 데스크톱에 Claude Code를 설치하고 첫 번째 코딩 세션을 시작합니다
- [Desktop 애플리케이션](https://code.claude.com/docs/ko/desktop.md): Claude Code Desktop을 더 활용하기: Git 격리를 통한 병렬 세션, 드래그 앤 드롭 패널 레이아웃, 통합 터미널 및 파일 편집기, 사이드 채팅, 컴퓨터 사용, 휴대폰에서 Dispatch 세션 전송, 시각적 diff 검토, 앱 미리보기, PR 모니터링, 커넥터, 엔터프라이즈 구성.
- [Linux의 Claude Desktop (베타)](https://code.claude.com/docs/ko/desktop-linux.md): Ubuntu 및 Debian에서 Claude 데스크톱 앱 설치 및 업데이트
- [WSL의 Claude Code Desktop](https://code.claude.com/docs/ko/desktop-wsl.md): WSL 2 배포판 내에서 Code 세션 실행
- [Claude Code Desktop에서 반복 작업 예약하기](https://code.claude.com/docs/ko/desktop-scheduled-tasks.md): Claude Code Desktop에서 예약된 작업을 설정하여 일일 코드 리뷰, 종속성 감사 또는 아침 브리핑을 위해 Claude를 자동으로 반복 실행합니다.
- [iOS 시뮬레이터에서 앱 테스트하기](https://code.claude.com/docs/ko/desktop-ios-simulator.md): Claude Code Desktop은 Claude가 앱을 빌드, 실행 또는 확인할 때 iOS 시뮬레이터 창에서 앱을 열며, 각 세션마다 별도의 시뮬레이터를 제공합니다.

##### 코드 검토 및 CI/CD

- [Claude가 코드를 작성할 때 보안 문제 포착](https://code.claude.com/docs/ko/security-guidance.md): security-guidance 플러그인을 설치하여 Claude가 자신의 코드 변경 사항을 취약점에 대해 검토하고 동일한 세션에서 수정하도록 합니다.
- [코드베이스에서 취약점 스캔하기](https://code.claude.com/docs/ko/claude-security.md): Claude Security 플러그인을 설치하여 Claude Code 세션에서 코드베이스의 취약점을 스캔하고 발견 사항을 검토 및 적용할 수 있는 패치로 변환합니다.
- [Code Review](https://code.claude.com/docs/ko/code-review.md): 다중 에이전트 분석을 통해 전체 코드베이스를 검토하여 논리 오류, 보안 취약점 및 회귀를 감지하는 자동화된 PR 검토를 설정합니다
- [Claude Code GitHub Actions](https://code.claude.com/docs/ko/github-actions.md): @claude 멘션에 응답하고, 작업을 자동화하고, 이슈를 풀 리퀘스트로 변환하기 위해 GitHub Actions 워크플로우에서 Claude Code를 실행합니다
- [Claude Code GitHub Actions를 클라우드 제공자와 함께 사용하기](https://code.claude.com/docs/ko/github-actions-cloud-providers.md): Claude API 대신 Amazon Bedrock, Google Cloud의 Agent Platform 또는 Microsoft Foundry를 통해 Claude Code GitHub Actions 실행하기
- [GitHub Enterprise Server와 Claude Code](https://code.claude.com/docs/ko/github-enterprise-server.md): 자체 호스팅되는 GitHub Enterprise Server 인스턴스에 Claude Code를 연결하여 클라우드 세션, 코드 리뷰 및 플러그인 마켓플레이스를 사용합니다.
- [Claude Code GitLab CI/CD](https://code.claude.com/docs/ko/gitlab-ci-cd.md): Claude Code를 GitLab CI/CD와 함께 개발 워크플로우에 통합하는 방법을 알아봅니다

### Claude Code로 빌드하기

#### 에이전트 및 병렬 작업

- [에이전트를 병렬로 실행하기](https://code.claude.com/docs/ko/agents.md): Claude Code가 여러 작업을 동시에 처리하는 방법들을 비교합니다: 서브에이전트, 에이전트 뷰, 에이전트 팀, 동적 워크플로우, 프로젝트.
- [사용자 정의 subagent 만들기](https://code.claude.com/docs/ko/sub-agents.md): Claude Code에서 작업별 워크플로우 및 향상된 컨텍스트 관리를 위한 특화된 AI subagent를 만들고 사용합니다.
- [여러 에이전트를 에이전트 뷰로 관리하기](https://code.claude.com/docs/ko/agent-view.md): 하나의 화면에서 많은 Claude Code 세션을 디스패치하고 관리합니다. 에이전트 뷰는 모든 세션이 무엇을 하고 있는지, 어떤 세션이 입력을 필요로 하는지 보여줍니다.
- [Claude Code 세션 팀 조율하기](https://code.claude.com/docs/ko/agent-teams.md): 공유 작업, 에이전트 간 메시징, 중앙 집중식 관리를 통해 함께 작동하는 여러 Claude Code 인스턴스를 조율합니다.
- [다른 Claude Code 세션에 메시지 보내기](https://code.claude.com/docs/ko/cross-session-messaging.md): Claude가 이 머신의 다른 Claude Code 세션을 나열하고 메시지를 보낼 수 있도록 하며, 다른 머신이나 클라우드의 세션에 도달합니다.
- [동적 워크플로우로 대규모 서브에이전트 조율하기](https://code.claude.com/docs/ko/workflows.md): 동적 워크플로우는 Claude가 작성한 스크립트에서 많은 서브에이전트를 조율하며, 이를 다시 실행할 수 있습니다. 코드베이스 감사, 대규모 마이그레이션, 교차 검증 연구에 사용합니다.
- [worktree를 사용하여 병렬 세션 실행](https://code.claude.com/docs/ko/worktrees.md): git worktree에서 병렬 Claude Code 세션을 격리하여 변경 사항이 충돌하지 않도록 합니다. `--worktree` 플래그, 서브에이전트 격리, `.worktreeinclude`, 정리 및 비git VCS 훅을 다룹니다.

#### MCP

- [MCP 서버에 연결하기](https://code.claude.com/docs/ko/mcp-quickstart.md): Claude Code에 MCP 서버를 추가하고, 연결을 확인하며, 디스크에서 구성을 찾습니다.
- [MCP를 통해 Claude Code를 도구에 연결하기](https://code.claude.com/docs/ko/mcp.md): Model Context Protocol을 사용하여 Claude Code를 도구에 연결하는 방법을 알아봅니다.

#### Skills

- [Claude를 skills로 확장하기](https://code.claude.com/docs/ko/skills.md): Claude Code에서 skills를 생성, 관리 및 공유하여 Claude의 기능을 확장합니다. 사용자 정의 명령어 및 번들 skills를 포함합니다.

#### 아티팩트

- [세션 출력을 아티팩트로 공유하기](https://code.claude.com/docs/ko/artifacts.md): 아티팩트는 Claude Code의 작업을 claude.ai의 라이브 인터랙티브 페이지로 변환하여 비공개로 유지하거나, 조직과 공유하거나, 공개 링크로 게시할 수 있습니다.

#### 자동화

- [hooks를 사용하여 작업 자동화](https://code.claude.com/docs/ko/hooks-guide.md): Claude Code가 파일을 편집하거나 작업을 완료하거나 입력이 필요할 때 자동으로 셸 명령을 실행합니다. 코드 형식 지정, 알림 전송, 명령 검증 및 프로젝트 규칙 적용합니다.
- [채널을 사용하여 실행 중인 세션으로 이벤트 푸시하기](https://code.claude.com/docs/ko/channels.md): 채널을 사용하여 MCP 서버에서 실행 중인 Claude Code 세션으로 메시지, 알림 및 웹훅을 푸시합니다. CI 결과, 채팅 메시지 및 모니터링 이벤트를 전달하여 Claude가 자리를 비웠을 때 반응할 수 있도록 합니다.
- [일정에 따라 프롬프트 실행하기](https://code.claude.com/docs/ko/scheduled-tasks.md): /loop와 cron 스케줄링 도구를 사용하여 Claude Code 세션 내에서 프롬프트를 반복 실행하거나, 상태를 폴링하거나, 일회성 알림을 설정합니다.
- [Claude를 목표를 향해 계속 작동하게 하기](https://code.claude.com/docs/ko/goal.md): /goal로 완료 조건을 설정하면 Claude가 조건이 충족될 때까지 계속 작동하며, 모델이 불가능하다고 판단하거나 수정해야 할 오류가 발생하면 목표가 지워집니다.
- [Claude Code를 프로그래밍 방식으로 실행하기](https://code.claude.com/docs/ko/headless.md): Agent SDK를 사용하여 CLI, Python 또는 TypeScript에서 Claude Code를 프로그래밍 방식으로 실행합니다.
- [링크에서 세션 시작하기](https://code.claude.com/docs/ko/deep-links.md): URL에서 Claude Code 터미널 세션을 엽니다. 런북, 알림 및 대시보드에 `claude-cli://` 링크를 포함하여 클릭하면 Claude Code가 올바른 저장소에서 올바른 프롬프트와 함께 열립니다.

#### 가이드

- [모노레포 또는 대규모 코드베이스에서 Claude Code 설정하기](https://code.claude.com/docs/ko/large-codebases.md): 중첩된 CLAUDE.md 파일, 스파스 워크트리, 코드 인텔리전스, 패키지별 스킬을 사용하여 모노레포 및 대규모 단일 트리 코드베이스에 대해 Claude Code를 구성하여 Claude가 작업 중인 코드에 집중하도록 유지합니다.

#### 문제 해결

- [설치 및 로그인 문제 해결](https://code.claude.com/docs/ko/troubleshoot-install.md): Claude Code 설치 또는 로그인 시 command not found, PATH, 권한, 네트워크 및 인증 오류를 수정합니다.
- [문제 해결](https://code.claude.com/docs/ko/troubleshooting.md): Claude Code에서 높은 CPU 또는 메모리 사용량, 중단, 자동 압축 스래싱 및 검색 문제를 해결하고 다른 문제에 대한 올바른 페이지를 찾습니다.
- [구성 디버깅하기](https://code.claude.com/docs/ko/debug-your-config.md): CLAUDE.md, 설정, 훅, MCP 서버 또는 스킬이 적용되지 않는 이유를 진단합니다. /context, /doctor, /hooks, /mcp를 사용하여 실제로 로드된 항목을 확인합니다.
- [오류 참조](https://code.claude.com/docs/ko/errors.md): Claude Code 런타임 오류 메시지를 조회하고 각 오류의 의미와 해결 방법을 확인합니다.

### 플러그인

#### 플러그인

- [플러그인 개요](https://code.claude.com/docs/ko/plugins/overview.md): Claude Code 플러그인이 무엇인지, 독립형 스킬이나 MCP 서버 대신 플러그인이 필요한 경우, 플러그인을 설치하거나 만드는 방법을 알아봅니다.

#### 플러그인 사용

- [플러그인 설치 및 관리](https://code.claude.com/docs/ko/plugins/install.md): 마켓플레이스에서 Claude Code 플러그인을 설치하고, 설치 범위를 선택하며, 나중에 업데이트하거나 제거합니다.
- [Anthropic의 마켓플레이스](https://code.claude.com/docs/ko/plugins/anthropic-marketplaces.md): Claude Code를 위한 Anthropic의 공식, 커뮤니티, 데모 플러그인 마켓플레이스: 이름, 저장소, 각각을 추가하는 방법, 플러그인을 찾아보는 위치.
- [코드 인텔리전스 플러그인](https://code.claude.com/docs/ko/plugins/code-intelligence.md): 언어 서버 플러그인을 설치하여 Claude가 편집 후 타입 오류를 확인하고 기호로 코드를 탐색하며, LSP 플러그인 권장 대화상자에 응답합니다.
- [플러그인 보안 및 신뢰](https://code.claude.com/docs/ko/plugins/security.md): 플러그인을 설치하기 전에 신뢰할 수 있는지 결정하세요. 플러그인이 머신에서 할 수 있는 작업부터 플러그인을 검토하고 제거하는 방법까지 알아봅니다.

#### 플러그인 만들기

- [Claude Code 플러그인 만들기](https://code.claude.com/docs/ko/plugins/create.md): 빈 디렉토리에서 첫 번째 Claude Code 플러그인을 만들고, 마켓플레이스 없이 테스트하며, 기존 .claude/ 설정을 변환합니다.
- [플러그인에 컴포넌트 추가하기](https://code.claude.com/docs/ko/plugins/components.md): Claude Code 플러그인에 skills, hooks, MCP 서버 및 다른 모든 컴포넌트 유형을 추가하고, 각각에 대해 검증하는 예제를 포함합니다.
- [플러그인 의존성](https://code.claude.com/docs/ko/plugins/dependencies.md): 플러그인이 의존하는 플러그인을 선언하고, ^1.2와 같은 버전 범위를 사용하며, Claude Code가 이를 설치, 해결 및 정리하는 방법을 알아봅니다.
- [evals로 플러그인 테스트하기](https://code.claude.com/docs/ko/plugin-evals.md): Claude Code 플러그인에 대한 eval 케이스를 작성하고, claude plugin eval로 실행하며, 결과를 채점하고, 플러그인 없는 기준선과 비교하고, CI에서 점수를 기준으로 게이트합니다.
- [플러그인 게시 및 배포](https://code.claude.com/docs/ko/plugins/publish.md): Claude Code 플러그인을 자신의 마켓플레이스 또는 Anthropic의 커뮤니티 마켓플레이스를 통해 게시하고, 사전 릴리스 체크리스트 및 사용자가 업데이트를 받는 방법을 알아봅니다.
- [플러그인 비용 및 사용량 측정](https://code.claude.com/docs/ko/plugins/measure.md): Claude Code 플러그인의 토큰 비용을 측정하고, 사람들이 여전히 사용하는지 확인하며, 조직 전체 플러그인 질문을 위한 텔레메트리 이벤트를 선택합니다.
- [CLI에서 플러그인 추천하기](https://code.claude.com/docs/ko/plugins/cli-hints.md): CLI 또는 SDK에서 claude-code-hint 태그를 내보내 Claude Code 사용자에게 공식 마켓플레이스 플러그인 설치를 유도합니다.

#### 마켓플레이스 실행

- [마켓플레이스 만들기](https://code.claude.com/docs/ko/plugins/create-marketplace.md): marketplace.json 파일에서 플러그인 마켓플레이스를 구축하고 호스팅하기 전에 로컬에서 테스트합니다.
- [마켓플레이스 호스팅 및 유지 관리](https://code.claude.com/docs/ko/plugins/host-marketplace.md): 사용자가 접근할 수 있는 플러그인 마켓플레이스를 게시하고, 비공개 마켓플레이스에 대한 액세스를 부여하며, 설치를 중단하지 않고 업데이트 및 이름 변경을 릴리스합니다.
- [조직을 위한 플러그인 추천](https://code.claude.com/docs/ko/plugins/relevance.md): 마켓플레이스 플러그인 항목에 관련성 블록을 추가하여 사용자의 작업이 일치할 때 Claude Code가 플러그인을 제안하도록 하고, 관리 설정에서 마켓플레이스를 허용 목록에 추가합니다.

#### 조직의 플러그인 관리

- [조직을 위한 Claude Code 플러그인 관리](https://code.claude.com/docs/ko/plugins/org.md): 관리되는 설정을 통해 조직의 모든 머신에 Claude Code가 설치하고 허용하는 플러그인을 제어합니다.

#### 문제 해결

- [플러그인 로딩 참조](https://code.claude.com/docs/ko/plugins/loading.md): Claude Code가 각 플러그인을 어디에서 로드하는지, 어떤 설정 파일이 로드 여부를 결정하는지, 그리고 업데이트가 아무것도 변경하지 않은 이유를 추적합니다.

#### 참고

- [플러그인 매니페스트 참조](https://code.claude.com/docs/ko/plugins/manifest-reference.md): plugin.json의 완전한 참조: 모든 필드의 타입과 기본값, 허용되는 경로 형식, userConfig 및 환경 변수 스키마.
- [마켓플레이스 참조](https://code.claude.com/docs/ko/plugins/marketplace-reference.md): marketplace.json 필드, 플러그인 항목, 플러그인 및 마켓플레이스 소스 객체의 완전한 참조와 각각이 유효한 위치입니다.
- [플러그인 명령어 참조](https://code.claude.com/docs/ko/plugins/cli-reference.md): claude 플러그인 셸 명령어, 세션 내 /plugin 및 /reload-plugins, 그리고 한 세션 동안 플러그인을 로드하는 플래그에 대한 완전한 참조입니다.

### 관리

#### 설정 및 액세스

- [조직을 위한 Claude Code 설정](https://code.claude.com/docs/ko/admin-setup.md): Claude Code를 배포하는 관리자를 위한 의사결정 맵으로, API 제공자, 관리 설정, 정책 시행, 사용량 모니터링 및 데이터 처리를 다룹니다.
- [고급 설정](https://code.claude.com/docs/ko/setup.md): Claude Code의 시스템 요구사항, 플랫폼별 설치, 버전 관리 및 제거.
- [인증](https://code.claude.com/docs/ko/authentication.md): Claude Code에 로그인하고 개인, 팀, 조직을 위한 인증을 구성합니다.
- [관리형 설정 배포](https://code.claude.com/docs/ko/managed-settings.md): 모든 개발자의 머신에 관리형 설정을 배포합니다: OS별 전달 메커니즘, Claude Code가 관리형 소스를 결합하는 방식, 그리고 적용 여부를 확인하는 방법입니다.
- [서버 관리 설정 구성](https://code.claude.com/docs/ko/server-managed-settings.md): 기기 관리 인프라 없이 서버 전달 설정을 통해 조직을 위해 Claude Code를 중앙에서 구성합니다.
- [조직의 MCP 서버 접근 제어](https://code.claude.com/docs/ko/managed-mcp.md): 관리형 구성 파일, 관리형 설정, 허용 목록 및 거부 목록을 사용하여 사용자가 추가하거나 연결할 수 있는 MCP 서버를 제한하거나 모든 사용자에게 서버를 제공합니다.
- [자동 모드 구성](https://code.claude.com/docs/ko/auto-mode-config.md): 자동 모드 분류기에 조직이 신뢰하는 저장소, 버킷 및 도메인을 알려줍니다. 환경 컨텍스트를 설정하고, 기본 차단 및 허용 규칙을 재정의하며, 자동 모드 CLI 하위 명령으로 유효한 구성을 검사합니다.

#### 배포

- [엔터프라이즈 배포 개요](https://code.claude.com/docs/ko/third-party-integrations.md): Claude Code가 다양한 타사 서비스 및 인프라와 통합되어 엔터프라이즈 배포 요구사항을 충족하는 방법을 알아봅니다.
- [기능 가용성](https://code.claude.com/docs/ko/feature-availability.md): Anthropic 구독 플랜, Anthropic Console, Amazon Bedrock, AWS의 Claude Platform, Google Cloud의 Agent Platform, Microsoft Foundry에서 사용 가능한 Claude Code 기능을 비교합니다.
- [Amazon Bedrock의 Claude Code](https://code.claude.com/docs/ko/amazon-bedrock.md): Amazon Bedrock을 통한 Claude Code 구성, 설정, IAM 구성 및 문제 해결에 대해 알아봅니다.
- [AWS의 Claude Platform에서 Claude Code](https://code.claude.com/docs/ko/claude-platform-on-aws.md): AWS 인증, IAM 액세스 제어 및 AWS Marketplace 청구를 사용하여 Anthropic 운영 Claude API를 사용하도록 Claude Code를 구성합니다.
- [Google Cloud의 Agent Platform에서 Claude Code 사용하기](https://code.claude.com/docs/ko/google-vertex-ai.md): Google Cloud의 Agent Platform(이전 Vertex AI)을 통해 Claude Code를 구성하는 방법을 알아봅니다. 설정, IAM 구성 및 문제 해결을 포함합니다.
- [Microsoft Foundry의 Claude Code](https://code.claude.com/docs/ko/microsoft-foundry.md): 설정, 구성 및 문제 해결을 포함하여 Microsoft Foundry를 통해 Claude Code를 구성하는 방법을 알아봅니다.
- [엔터프라이즈 네트워크 구성](https://code.claude.com/docs/ko/network-config.md): 프록시 서버, 사용자 정의 인증 기관(CA), 상호 전송 계층 보안(mTLS) 인증을 통해 엔터프라이즈 환경에서 Claude Code를 구성합니다.
- [기업 런처 뒤에서 Claude Code 실행](https://code.claude.com/docs/ko/corporate-launcher.md): CLAUDE_CODE_PROCESS_WRAPPER 또는 processWrapper 설정을 사용하여 Claude Code가 자체 바이너리에서 시작하는 프로세스(백그라운드 서비스 및 모든 에이전트 뷰 세션 포함)를 필수 런처를 통해 라우팅합니다.
- [개발 컨테이너](https://code.claude.com/docs/ko/devcontainer.md): 팀 전체에서 일관되고 격리된 환경을 위해 Claude Code를 개발 컨테이너 내에서 실행합니다.

#### 게이트웨이

- [게이트웨이를 통해 Claude Code 실행](https://code.claude.com/docs/ko/gateways.md): Claude Code를 자체 호스팅 게이트웨이를 통해 라우팅하여 중앙 집중식 자격 증명, 사용량 추적 및 비용 제어를 수행합니다. 아키텍처, Anthropic의 Claude 앱 게이트웨이 및 다른 게이트웨이 제품 사용을 다룹니다.

##### Claude 앱 게이트웨이

- [Amazon Bedrock, AWS의 Claude Platform, Google Cloud 및 Microsoft Foundry용 Claude 앱 게이트웨이](https://code.claude.com/docs/ko/claude-apps-gateway.md): SSO 로그인, 그룹별 모델 액세스, OTLP 텔레메트리를 갖춘 자체 호스팅 게이트웨이를 통해 Amazon Bedrock, AWS의 Claude Platform, Google Cloud 또는 Microsoft Foundry에서 Claude Code를 실행합니다.
- [Claude 앱 게이트웨이 구성](https://code.claude.com/docs/ko/claude-apps-gateway-config.md): 모든 gateway.yaml 옵션에 대한 참조: 리스너 및 TLS, OIDC, 세션, Postgres 저장소, Amazon Bedrock, Claude Platform on AWS, Google Cloud의 Agent Platform, Microsoft Foundry 업스트림, 모델 라우팅, 관리형 정책 및 텔레메트리.
- [Claude 앱 게이트웨이 지출 한도](https://code.claude.com/docs/ko/claude-apps-gateway-spend-limits.md): Claude 앱 게이트웨이를 통해 각 개발자의 지출을 일, 주 또는 월 단위로 제한합니다. Admin API로 한도를 설정하면 게이트웨이가 모든 요청에서 실시간으로 이를 적용합니다.
- [Claude 앱 게이트웨이 배포 및 운영](https://code.claude.com/docs/ko/claude-apps-gateway-deploy.md): IdP에 게이트웨이를 등록하고, 컨테이너를 빌드하며, Kubernetes 또는 Cloud Run에 배포하고 운영합니다: 상태 확인, 시크릿 로테이션, 업그레이드 및 보안.
- [AWS에서 Claude 앱 게이트웨이 배포](https://code.claude.com/docs/ko/claude-apps-gateway-on-aws.md): AWS에서 Claude 앱 게이트웨이를 실행하는 실제 예제입니다: ECS Fargate 또는 EKS, PostgreSQL용 Amazon RDS, AWS Secrets Manager, Amazon Bedrock에 대한 IAM 역할 인증.
- [Google Cloud에 Claude 앱 게이트웨이 배포](https://code.claude.com/docs/ko/claude-apps-gateway-on-gcp.md): Google Cloud에서 Claude 앱 게이트웨이를 실행하는 실제 예제: Cloud Run 또는 GKE, Cloud SQL for PostgreSQL, Secret Manager, 그리고 Google Cloud의 Agent Platform에 대한 서비스 계정 인증.

##### 기타 게이트웨이

- [다른 LLM gateway](https://code.claude.com/docs/ko/llm-gateway.md): 조직이 이미 실행 중인 LLM gateway를 통해 Claude Code를 라우팅합니다. Claude Code를 gateway에 연결하고, 조직을 위해 gateway를 배포하고, Claude Code가 gateway에 전송하는 내용을 다룹니다.
- [Claude Code를 LLM 게이트웨이에 연결](https://code.claude.com/docs/ko/llm-gateway-connect.md): 조직의 LLM 게이트웨이에 Claude Code를 연결합니다. 관리자가 이미 구성했는지 확인하거나, 기본 URL과 자격 증명을 직접 설정한 후 연결을 확인하고 게이트웨이 오류를 해결합니다.
- [조직을 위한 LLM 게이트웨이 배포](https://code.claude.com/docs/ko/llm-gateway-rollout.md): Claude Code용 게이트웨이 제품 배포: Claude Code가 전송하는 내용을 전달하도록 구성하고, 개발자 자격증명을 발급하며, 관리되는 설정을 통해 구성을 배포하고, 롤아웃을 확인합니다.
- [Claude Code 게이트웨이 호환성 가이드](https://code.claude.com/docs/ko/llm-gateway-protocol.md): Claude Code와 호환되는 LLM 게이트웨이 유지: 호출하는 엔드포인트, 전달해야 할 헤더 및 본문 필드, 그리고 제거될 때 중단되는 기능.

#### 사용량 및 비용

- [모니터링](https://code.claude.com/docs/ko/monitoring-usage.md): Claude Code에 대한 OpenTelemetry를 활성화하고 구성하는 방법을 알아봅니다.
- [비용을 효과적으로 관리하기](https://code.claude.com/docs/ko/costs.md): 토큰 사용량을 추적하고, 팀 지출 한도를 설정하며, 컨텍스트 관리, 모델 선택, 확장 사고 설정 및 전처리 hooks를 통해 Claude Code 비용을 절감합니다.
- [팀 사용량을 분석으로 추적하기](https://code.claude.com/docs/ko/analytics.md): Claude Code 사용량 지표를 확인하고, 채택 현황을 추적하며, 분석 대시보드에서 엔지니어링 속도를 측정합니다.

#### 보안 및 데이터

- [보안](https://code.claude.com/docs/ko/security.md): Claude Code의 보안 보호 기능과 안전한 사용을 위한 모범 사례에 대해 알아봅니다.
- [데이터 사용](https://code.claude.com/docs/ko/data-usage.md): Anthropic의 Claude 데이터 사용 정책에 대해 알아봅니다
- [Zero data retention](https://code.claude.com/docs/ko/zero-data-retention.md): Claude for Enterprise에서 Claude Code의 Zero Data Retention(ZDR)에 대해 알아보세요. 범위, 비활성화된 기능, 활성화 요청 방법을 포함합니다.

#### 도입

- [커뮤니케이션 키트](https://code.claude.com/docs/ko/communications-kit.md): 엔지니어링 조직에 Claude Code를 배포할 때 사용할 수 있는 출시 공지, 드립 캠페인 메시지, FAQ 응답입니다.
- [Champion kit](https://code.claude.com/docs/ko/champion-kit.md): Claude Code를 내부적으로 옹호하는 엔지니어를 위한 플레이북: 공유할 내용, 질문에 답하는 방법, 팀 내 도입 확대 방법.

### 구성

#### 설정

- [설정 파일 및 우선순위](https://code.claude.com/docs/ko/settings.md): Claude Code 설정을 변경하고, 키가 속할 범위를 선택하고, 변경을 확인하고, 키가 여러 위치에 설정되어 있을 때 Claude Code가 사용하는 값을 알아봅니다.
- [모든 설정](https://code.claude.com/docs/ko/settings-reference.md): Claude Code settings.json의 모든 키에 대한 완전한 참조: 각 키의 위치, 유형 및 기본값, 붙여넣기 가능한 예제, 모든 키의 인덱스.
- [예제 설정 파일](https://code.claude.com/docs/ko/settings-example.md): 개발자, 팀, 조직을 위한 현실적인 settings.json 파일: 하나를 복사하고 원하는 키를 유지한 후 값을 변경하세요.

#### 권한 및 샌드박싱

- [권한 구성](https://code.claude.com/docs/ko/permissions.md): 세분화된 권한 규칙, 모드 및 관리형 정책을 통해 Claude Code가 액세스하고 수행할 수 있는 작업을 제어합니다.
- [권한 모드 선택](https://code.claude.com/docs/ko/permission-modes.md): Claude가 작업하기 전에 묻는지 여부를 제어합니다. CLI에서 Shift+Tab, VS Code의 모드 표시기 또는 Desktop의 모드 선택기로 권한 모드를 전환합니다.
- [샌드박싱된 Bash 도구 구성](https://code.claude.com/docs/ko/sandboxing.md): Claude Code의 샌드박싱된 Bash 도구가 파일시스템 및 네트워크 격리를 제공하여 더 안전하고 자율적인 에이전트 실행을 가능하게 하는 방법을 알아봅니다.
- [샌드박스 환경 선택](https://code.claude.com/docs/ko/sandbox-environments.md): Claude Code 샌드박스 옵션 비교: 기본 제공 샌드박스 Bash 도구, 샌드박스 런타임, 개발 컨테이너, Docker, VM. 위협 모델에 맞는 적절한 격리를 선택합니다.

#### 환경

- [클라우드 환경 구성](https://code.claude.com/docs/ko/cloud-environments.md): Claude Code 클라우드 세션을 위한 클라우드 환경 구성: 네트워크 액세스 수준, 환경 변수, 설정 스크립트 및 환경 캐싱.

##### 자체 호스팅 환경

- [자체 호스팅 환경](https://code.claude.com/docs/ko/self-hosted-environments.md): 조직이 제어하는 인프라에서 Claude Code 클라우드 세션을 실행합니다: 자체 호스팅 환경을 설정하고, 러너를 배포하고, 세션을 자신의 컴퓨팅으로 라우팅합니다.
- [자체 호스팅 환경 빠른 시작](https://code.claude.com/docs/ko/self-hosted-environments-quickstart.md): 첫 번째 자체 호스팅 환경 설정: Claude Code 설치, 환경 생성, 러너 시작, 세션 라우팅.
- [자체 호스팅 환경을 프로덕션에 배포](https://code.claude.com/docs/ko/self-hosted-environments-deploy.md): 프로덕션에서 자체 호스팅 러너 실행: 보안 강화, 네트워크 이그레스 제어, git 자격증명, Kubernetes 및 Compose 레시피, 그리고 문제 해결.
- [자체 호스팅 환경에서 세션 사용자 정의](https://code.claude.com/docs/ko/self-hosted-environments-configuration.md): 세션별 자격 증명, 라이프사이클 훅, 온디맨드 러너 생성을 위한 래퍼 스크립트로 자체 호스팅 환경 세션을 사용자 정의합니다.
- [자체 호스팅 환경을 엔드투엔드로 테스트하기](https://code.claude.com/docs/ko/self-hosted-environments-testing.md): CI에서 자체 호스팅 러너 이미지 검증: CLI로 세션을 디스패치하고, Stop 훅을 통해 Claude의 응답을 읽으며, 전체 루프를 스크립트로 작성합니다.
- [자체 호스팅 환경 참조](https://code.claude.com/docs/ko/self-hosted-environments-reference.md): 자체 호스팅 러너 및 오케스트레이터에 대한 완전한 참조: CLI 플래그, 환경 변수 및 Prometheus 메트릭.
- [자체 호스팅 환경에서 세션 ID 확인](https://code.claude.com/docs/ko/self-hosted-environments-identity.md): 자체 호스팅 환경의 세션에서 요청을 신뢰할 수 있도록 네트워크의 서비스가 CLAUDE_CODE_SESSION_ACCESS_TOKEN JWT를 확인합니다.

#### 모델 및 응답

- [모델 구성](https://code.claude.com/docs/ko/model-config.md): Claude Code가 사용하는 모델, 노력 수준, 확장된 컨텍스트 및 자동 압축 윈도우를 구성합니다
- [빠른 모드로 응답 속도 향상](https://code.claude.com/docs/ko/fast-mode.md): Claude Code에서 빠른 모드를 전환하여 더 빠른 Opus 응답을 받습니다.
- [어려운 결정을 조언자 도구로 에스컬레이션하기](https://code.claude.com/docs/ko/advisor.md): 주 모델을 더 강력한 조언자 모델과 쌍으로 만들어 Claude가 작업 중 핵심 순간에 조언자를 참고하도록 합니다.
- [출력 스타일](https://code.claude.com/docs/ko/output-styles.md): 내장된 Concise 또는 Explanatory와 같은 출력 스타일이나 사용자 정의 스타일로 Claude Code의 역할, 톤, 응답 형식을 변경합니다.

#### 인터페이스

- [Claude Code를 위한 터미널 구성](https://code.claude.com/docs/ko/terminal-config.md): Shift+Enter를 개행으로 수정하고, Claude가 완료되면 터미널 벨을 받으며, tmux를 구성하고, 색상 테마를 일치시키고, Claude Code CLI에서 Vim 모드를 활성화합니다.
- [전체 화면 렌더링](https://code.claude.com/docs/ko/fullscreen.md): 마우스 지원과 안정적인 메모리 사용으로 더 부드럽고 깜빡임 없는 렌더링 모드를 활성화합니다.
- [스크린 리더로 Claude Code 사용하기](https://code.claude.com/docs/ko/accessibility.md): VoiceOver 및 NVDA와 같은 스크린 리더, 스크린 확대기, 감소된 모션, 색맹 친화적 테마에 대한 Claude Code 설정하기.
- [음성 받아쓰기](https://code.claude.com/docs/ko/voice-dictation.md): Claude Code CLI에서 누르고 있기 또는 탭하기 음성 받아쓰기로 프롬프트를 말씀하세요.
- [상태 표시줄 사용자 정의](https://code.claude.com/docs/ko/statusline.md): Claude Code에서 컨텍스트 윈도우 사용량, 비용 및 git 상태를 모니터링하기 위해 사용자 정의 상태 표시줄 구성
- [키보드 단축키 사용자 정의](https://code.claude.com/docs/ko/keybindings.md): keybindings 구성 파일을 사용하여 Claude Code에서 키보드 단축키를 사용자 정의합니다.

### 참고

#### 참고

- [CLI 참조](https://code.claude.com/docs/ko/cli-reference.md): Claude Code 명령줄 인터페이스의 완전한 참조로, 명령어와 플래그를 포함합니다.
- [명령어](https://code.claude.com/docs/ko/commands.md): Claude Code에서 사용 가능한 명령어의 완전한 참조 자료로, 기본 제공 명령어 및 번들 스킬을 포함합니다.
- [환경 변수](https://code.claude.com/docs/ko/env-vars.md): Claude Code 동작을 제어하는 환경 변수에 대한 참고 자료입니다.
- [도구 참조](https://code.claude.com/docs/ko/tools-reference.md): Claude Code가 사용할 수 있는 도구의 완전한 참조로, 권한 요구사항 및 도구별 동작을 포함합니다.
- [대화형 모드](https://code.claude.com/docs/ko/interactive-mode.md): Claude Code 세션의 키보드 단축키, 입력 모드 및 대화형 기능에 대한 완전한 참조입니다.
- [Checkpointing](https://code.claude.com/docs/ko/checkpointing.md): Claude의 편집 및 대화를 추적, 되돌리기 및 요약하여 세션 상태를 관리합니다.
- [Hooks 참조](https://code.claude.com/docs/ko/hooks.md): Claude Code hook 이벤트, 구성 스키마, JSON 입출력 형식, 종료 코드, 비동기 hook, HTTP hook, 프롬프트 hook, MCP 도구 hook에 대한 참조입니다.
- [채널 참조](https://code.claude.com/docs/ko/channels-reference.md): 웹훅, 알림, 채팅 메시지를 Claude Code 세션으로 푸시하는 MCP 서버를 구축합니다. 채널 계약 참조: 기능 선언, 알림 이벤트, 회신 도구, 발신자 게이팅, 권한 릴레이.

#### 용어집

- [용어집](https://code.claude.com/docs/ko/glossary.md): Claude Code 용어 정의. 에이전트 루프, 컴팩션, CLAUDE.md, 훅, 서브에이전트, MCP 및 기타 핵심 개념의 의미를 알아봅니다.

### Agent SDK

#### Agent SDK

- [Agent SDK 개요](https://code.claude.com/docs/ko/agent-sdk/overview.md): Claude Code를 라이브러리로 사용하여 프로덕션 AI 에이전트 구축하기
- [빠른 시작](https://code.claude.com/docs/ko/agent-sdk/quickstart.md): Python 또는 TypeScript Agent SDK를 사용하여 자율적으로 작동하는 AI 에이전트를 구축하기 시작합니다
- [Claude Agent SDK로 마이그레이션](https://code.claude.com/docs/ko/agent-sdk/migration-guide.md): Claude Code TypeScript 및 Python SDK를 Claude Agent SDK로 마이그레이션하기 위한 가이드
- [Agent SDK 문제 해결](https://code.claude.com/docs/ko/agent-sdk/troubleshooting.md): Claude Code CLI가 시작되지 않거나, CLI 프로세스가 종료되거나, 구조화된 출력 없이 성공적인 결과가 도착할 때 Agent SDK 오류를 수정합니다.

#### 에이전트 구축하기

- [에이전트 구성](https://code.claude.com/docs/ko/agent-sdk/configuration.md): Agent SDK 세션 구성: 옵션 객체 작성, 모델 설정, 환경 및 제한 설정, 각 기능 옵션의 페이지 찾기.
- [예제](https://code.claude.com/docs/ko/agent-sdk/examples.md): 구축하려는 것과 일치하는 완전하고 실행 가능한 Agent SDK 프로젝트 또는 Claude Cookbook의 가이드 레시피를 찾습니다.

#### 핵심 개념

- [에이전트 루프의 작동 원리](https://code.claude.com/docs/ko/agent-sdk/agent-loop.md): 메시지 생명주기, 도구 실행, 컨텍스트 윈도우, 그리고 SDK 에이전트를 구동하는 아키텍처를 이해합니다.
- [SDK에서 Claude Code 기능 사용하기](https://code.claude.com/docs/ko/agent-sdk/claude-code-features.md): 프로젝트 지침, 스킬, 훅 및 기타 Claude Code 기능을 SDK 에이전트에 로드합니다.
- [세션으로 작업하기](https://code.claude.com/docs/ko/agent-sdk/sessions.md): 세션이 에이전트 대화 기록을 어떻게 유지하는지, 그리고 이전 실행으로 돌아가기 위해 continue, resume, fork를 언제 사용할지에 대해 알아봅니다.
- [세션을 외부 스토리지에 유지하기](https://code.claude.com/docs/ko/agent-sdk/session-storage.md): Agent SDK 세션 트랜스크립트를 자신의 객체 저장소, 키-값 저장소 또는 데이터베이스에 미러링하여 다른 호스트에서 세션을 재개할 수 있습니다.

#### 입력 및 출력

- [스트리밍 입력](https://code.claude.com/docs/ko/agent-sdk/streaming-vs-single-mode.md): Claude Agent SDK의 두 가지 입력 모드를 이해하고 각각을 언제 사용할지 알아보기
- [승인 및 사용자 입력 처리](https://code.claude.com/docs/ko/agent-sdk/user-input.md): Claude의 승인 요청 및 명확화 질문을 사용자에게 표시한 후 SDK에 사용자의 결정을 반환합니다.
- [실시간으로 응답 스트리밍하기](https://code.claude.com/docs/ko/agent-sdk/streaming-output.md): 텍스트와 도구 호출이 스트리밍될 때 Agent SDK에서 실시간 응답 받기
- [에이전트에서 구조화된 출력 얻기](https://code.claude.com/docs/ko/agent-sdk/structured-outputs.md): JSON Schema, Zod 또는 Pydantic을 사용하여 에이전트 워크플로우에서 검증된 JSON을 반환합니다. 다중 턴 도구 사용 후 타입 안전 구조화된 데이터를 얻습니다.

#### 도구로 확장하기

- [Claude에 사용자 정의 도구 제공](https://code.claude.com/docs/ko/agent-sdk/custom-tools.md): Claude Agent SDK의 인프로세스 MCP 서버로 사용자 정의 도구를 정의하여 Claude가 함수를 호출하고, API를 사용하며, 도메인별 작업을 수행할 수 있도록 합니다.
- [외부 도구와 MCP로 연결하기](https://code.claude.com/docs/ko/agent-sdk/mcp.md): MCP 서버를 구성하여 에이전트를 외부 도구로 확장합니다. 전송 유형, 대규모 도구 세트를 위한 도구 검색, 인증 및 오류 처리를 다룹니다.
- [많은 도구로 확장하기 - 도구 검색](https://code.claude.com/docs/ko/agent-sdk/tool-search.md): 수백 개 또는 수천 개의 도구로 에이전트를 확장하고, 필요한 것만 동적으로 발견하여 로드합니다.
- [SDK의 서브에이전트](https://code.claude.com/docs/ko/agent-sdk/subagents.md): Claude Agent SDK 애플리케이션에서 서브에이전트를 정의하고 호출하여 컨텍스트를 격리하고, 작업을 병렬로 실행하며, 메인 에이전트의 프롬프트에 추가하지 않고 특화된 지시사항을 적용합니다.

#### 동작 사용자 정의

- [시스템 프롬프트 수정](https://code.claude.com/docs/ko/agent-sdk/modifying-system-prompts.md): `claude_code` 프리셋과 사용자 정의 시스템 프롬프트 중에서 선택하고, CLAUDE.md, 출력 스타일, append, 또는 완전히 사용자 정의된 프롬프트로 동작을 사용자 정의합니다.
- [Skills로 에이전트 확장하기](https://code.claude.com/docs/ko/agent-sdk/skills.md): Claude Agent SDK 세션에서 Claude가 호출할 수 있는 Skills를 제어하고, 이름으로 명령을 전달하며, 세션이 발견하는 Skills를 작성합니다
- [SDK의 플러그인](https://code.claude.com/docs/ko/agent-sdk/plugins.md): Agent SDK를 통해 스킬, 에이전트, 훅 및 MCP 서버를 추가하여 Claude Code를 확장하는 사용자 정의 플러그인 로드

#### 제어 및 관찰성

- [권한 구성](https://code.claude.com/docs/ko/agent-sdk/permissions.md): 권한 모드, 훅, 선언적 허용/거부 규칙을 사용하여 에이전트가 도구를 사용하는 방식을 제어합니다.
- [훅으로 에이전트 동작 가로채기 및 제어](https://code.claude.com/docs/ko/agent-sdk/hooks.md): 훅을 사용하여 에이전트 실행의 주요 지점에서 에이전트 동작을 가로채고 사용자 정의합니다
- [체크포인팅으로 파일 변경 사항 되돌리기](https://code.claude.com/docs/ko/agent-sdk/file-checkpointing.md): 에이전트 세션 중 파일 변경 사항을 추적하고 파일을 이전의 모든 상태로 복원합니다
- [비용 및 사용량 추적](https://code.claude.com/docs/ko/agent-sdk/cost-tracking.md): Claude Agent SDK를 사용하여 토큰 사용량을 추적하고, 비용을 예측하며, 프롬프트 캐싱을 구성하는 방법을 알아봅니다.
- [OpenTelemetry를 통한 관찰성](https://code.claude.com/docs/ko/agent-sdk/observability.md): Agent SDK에서 OpenTelemetry를 사용하여 추적, 메트릭 및 이벤트를 관찰성 백엔드로 내보냅니다.
- [할일 추적](https://code.claude.com/docs/ko/agent-sdk/todo-tracking.md): Agent SDK 세션에서 할일을 추적하고 구조화된 도구 호출에서 Claude의 진행 상황을 애플리케이션에 렌더링합니다

#### 배포

- [Agent SDK 호스팅](https://code.claude.com/docs/ko/agent-sdk/hosting.md): 프로덕션에서 Agent SDK 배포: 서브프로세스 아키텍처, 세션 지속성, 확장성, 관찰성, Docker, Kubernetes 및 샌드박스 제공자를 위한 멀티테넌트 격리.
- [AI 에이전트 안전하게 배포하기](https://code.claude.com/docs/ko/agent-sdk/secure-deployment.md): 격리, 자격증명 관리, 네트워크 제어를 통해 Claude Code 및 Agent SDK 배포를 보호하는 가이드

#### SDK 참고자료

- [Agent SDK 참조 - TypeScript](https://code.claude.com/docs/ko/agent-sdk/typescript.md): TypeScript Agent SDK의 완전한 API 참조로, 모든 함수, 타입 및 인터페이스를 포함합니다.
- [TypeScript SDK V2 세션 API (지원 중단됨)](https://code.claude.com/docs/ko/agent-sdk/typescript-v2-preview.md): 다중 턴 대화를 위한 세션 기반 send/stream 패턴을 사용하는 지원 중단된 V2 TypeScript Agent SDK 세션 API 참조입니다.
- [Agent SDK 참조 - Python](https://code.claude.com/docs/ko/agent-sdk/python.md): Python Agent SDK의 완전한 API 참조로, 모든 함수, 타입 및 클래스를 포함합니다.

### 새로운 소식

#### 새로운 소식

- [새로운 기능](https://code.claude.com/docs/ko/whats-new/index.md): Claude Code 기능의 주간 요약으로, 코드 스니펫, 데모, 그리고 그 중요성에 대한 맥락을 포함합니다.
- [주간 37 · 2026년 9월 7–11일](https://code.claude.com/docs/ko/whats-new/2026-w37.md): claude plugin eval로 플러그인을 테스트하고 Claude Code Desktop 창을 별도의 윈도우로 팝아웃합니다.
- [주간 36 · 8월 31일 – 9월 4일, 2026년](https://code.claude.com/docs/ko/whats-new/2026-w36.md): Claude Fable 5.1로 전환하고, Desktop에서 컴퓨터 사용을 백그라운드에서 실행하며, /diff 패널에서 Claude의 편집 내용을 실시간으로 확인합니다.
- [35주 · 2026년 8월 24–28일](https://code.claude.com/docs/ko/whats-new/2026-w35.md): Claude Code 데스크톱 앱에서 터미널 세션을 재개하고, Claude가 작성한 피드백 보고서를 검토하며, 제한된 모드에서 세션을 시작합니다.
- [34주차 · 2026년 8월 17–21일](https://code.claude.com/docs/ko/whats-new/2026-w34.md): /design 스킬로 편집 가능한 UI 아트보드를 작성하고, Concise 출력 스타일을 설정하며, 휴대폰에서 머신의 Claude Code 세션을 시작합니다.
- [33주차 · 8월 10–14일, 2026년](https://code.claude.com/docs/ko/whats-new/2026-w33.md): Claude Code Desktop이 사용량 제한 리셋 후 자동으로 계속 진행되며, 포크 모드가 기본적으로 켜지고, GitLab 병합 요청 및 마켓플레이스가 GitHub에 합류합니다.
- [32주차 · 2026년 8월 3–7일](https://code.claude.com/docs/ko/whats-new/2026-w32.md): Claude Code 세션이 서로 메시지를 주고받으며, 자체 호스팅 환경이 클라우드 세션을 사용자의 인프라에서 실행하고, 자동 모드가 기본 권한 모드가 됩니다.
- [주간 30 · 7월 20–24, 2026](https://code.claude.com/docs/ko/whats-new/2026-w30.md): Opus 5가 기본 Opus 모델이 되고, Claude Code Desktop에 iOS Simulator 창이 추가되며, Claude Security 플러그인이 코드의 취약점을 스캔합니다.
- [29주차 · 2026년 7월 13–17일](https://code.claude.com/docs/ko/whats-new/2026-w29.md): MCP 커넥터를 통해 라이브 데이터를 게시된 아티팩트로 가져오고, 새로운 스크린 리더 모드에서 Claude Code를 스크린 리더와 함께 사용합니다.
- [28주차 · 2026년 7월 6–10일](https://code.claude.com/docs/ko/whats-new/2026-w28.md): Desktop 앱의 내장 브라우저에서 외부 사이트를 탐색하고, /doctor로 전체 설정 점검을 실행하며, 자동 모드 트랜스크립트 보호 및 에이전트 뷰 업그레이드를 확인합니다.
- [27주차 · 6월 29일 – 7월 3일, 2026](https://code.claude.com/docs/ko/whats-new/2026-w27.md): Claude Sonnet 5가 기본 모델이 되었으며, Chrome의 Claude가 정식 출시되었고, 서브에이전트가 기본적으로 백그라운드에서 실행되며, Claude Desktop이 Linux에서 베타로 출시되었고, /radio가 Claude FM으로 튜닝됩니다.
- [26주차 · 2026년 6월 22–26일](https://code.claude.com/docs/ko/whats-new/2026-w26.md): 셸에서 claude mcp login으로 MCP 서버를 인증하고, ! 접두사로 셸 모드 명령 출력에 응답을 받으며, /clear 이전 대화를 /rewind로 재개합니다.
- [25주차 · 2026년 6월 15–19일](https://code.claude.com/docs/ko/whats-new/2026-w25.md): Artifacts를 사용하여 세션에서 라이브 공유 가능한 페이지를 게시하고, 거부 및 요청 규칙에서 도구 매개변수를 일치시키며, /config를 사용하여 프롬프트에서 모든 설정을 지정합니다.
- [24주차 · 2026년 6월 8–12일](https://code.claude.com/docs/ko/whats-new/2026-w24.md): /cd로 세션을 새 디렉토리로 이동하고, 하위 에이전트가 자신의 하위 에이전트를 생성하도록 하며, 안전 모드로 손상된 구성을 문제 해결합니다.
- [23주차 · 2026년 6월 1–5일](https://code.claude.com/docs/ko/whats-new/2026-w23.md): Amazon Bedrock, Google Cloud의 Agent Platform, Microsoft Foundry에서 자동 모드 실행, acceptEdits 모드에서 코드를 실행할 수 있는 파일 작성 전 프롬프트 표시, /plugin list로 설치된 플러그인 나열, 관리형 배포를 위한 승인된 버전 범위 필수.
- [Week 22 · May 25–29, 2026](https://code.claude.com/docs/ko/whats-new/2026-w22.md): Claude Opus 4.8에서 Claude Code를 실행하고, 동적 워크플로우로 대규모 작업을 조율하며, security-guidance 플러그인으로 보안 문제를 포착하고, Opus 4.8의 빠른 모드를 더 낮은 가격으로 사용합니다.
- [21주차 · 2026년 5월 18–22일](https://code.claude.com/docs/ko/whats-new/2026-w21.md): Pro 플랜에서 자동 모드를 사용하고 Sonnet 4.6을 지원하며, /usage에서 플랜 한도를 주도하는 스킬, 서브에이전트, MCP 서버를 확인하고, 새로운 /code-review 명령으로 diff를 검토합니다.
- [20주차 · 2026년 5월 11–15일](https://code.claude.com/docs/ko/whats-new/2026-w20.md): 에이전트 뷰로 모든 Claude Code 세션을 한 화면에서 관리하고, Claude가 조건을 만족할 때까지 목표를 향해 작동하도록 유지하며, Opus 4.7에서 기본적으로 빠른 모드를 실행합니다.
- [19주차 · 2026년 5월 4–8일](https://code.claude.com/docs/ko/whats-new/2026-w19.md): .zip 아카이브 및 URL에서 플러그인을 로드하고, Ctrl+R로 모든 프로젝트의 명령 기록을 검색하고, 로컬 HEAD 또는 원격 기본값에서 새 worktree를 분기하고, 자동 모드 하드 거부 규칙으로 작업을 무조건 차단합니다.
- [18주차 · 4월 27일 – 5월 1일, 2026년](https://code.claude.com/docs/ko/whats-new/2026-w18.md): Claude Code가 Windows에서 Git Bash 없이 실행되며, claude auth login은 브라우저 콜백이 localhost에 도달할 수 없을 때 붙여넣은 OAuth 코드를 허용하고, claude project purge는 프로젝트별 로컬 상태를 정리하며, PR URL을 /resume에 붙여넣으면 이를 생성한 세션을 찾습니다.
- [17주차 · 2026년 4월 20–24일](https://code.claude.com/docs/ko/whats-new/2026-w17.md): /ultrareview가 연구 미리보기로 공개되며, 터미널로 돌아올 때 자동 세션 요약, 플러그인으로 빌드하고 배포할 수 있는 커스텀 색상 테마, 그리고 재설계된 웹용 Claude Code가 제공됩니다.
- [16주차 · 2026년 4월 13–17일](https://code.claude.com/docs/ko/whats-new/2026-w16.md): 새로운 xhigh 노력 수준이 포함된 Claude Opus 4.7, Claude Code 웹의 루틴, Claude가 필요할 때 휴대폰에 알림을 보내는 모바일 푸시 알림, 사용 한도를 주도하는 요소를 보여주는 /usage 분석, 그리고 번들된 JavaScript를 대체하는 네이티브 바이너리.
- [15주차 · 2026년 4월 6–10일](https://code.claude.com/docs/ko/whats-new/2026-w15.md): Ultraplan 클라우드 계획, 자동 페이싱 /loop이 있는 Monitor 도구, 설정을 패키징하기 위한 /team-onboarding, 그리고 터미널에서 /autofix-pr을 사용합니다.
- [14주차 · 3월 30일 – 4월 3일, 2026](https://code.claude.com/docs/ko/whats-new/2026-w14.md): CLI의 컴퓨터 사용, 인터랙티브 인제품 레슨, 깜빡임 없는 렌더링, 도구별 MCP 결과 크기 오버라이드, PATH의 플러그인 실행 파일.
- [13주차 · 2026년 3월 23–27일](https://code.claude.com/docs/ko/whats-new/2026-w13.md): 자동 모드의 무인 권한 관리, 내장된 컴퓨터 사용, 클라우드의 PR 자동 수정, 트랜스크립트 검색, Windows용 PowerShell 도구.

### 리소스

#### 리소스

- [법률 및 규정 준수](https://code.claude.com/docs/ko/legal-and-compliance.md): Claude Code의 법률 계약, 규정 준수 인증 및 보안 정보입니다.
