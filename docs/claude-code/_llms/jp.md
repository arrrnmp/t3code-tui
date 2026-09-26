# Claude Code Docs: Japanese

> Official documentation for Claude Code, Anthropic's agentic coding tool available in the terminal, IDE, desktop app, and browser. Covers installation, configuration, skills, subagents, hooks, MCP, the Agent SDK, and reference material.

## Japanese

### はじめに

#### はじめに

- [概要](https://code.claude.com/docs/ja/overview.md): Claude Code は agentic coding ツールで、コードベースを読み取り、ファイルを編集し、コマンドを実行し、開発ツールと統合します。ターミナル、IDE、デスクトップアプリ、ブラウザで利用できます。
- [クイックスタート](https://code.claude.com/docs/ja/quickstart.md): Claude Code へようこそ！
- [変更履歴](https://code.claude.com/docs/ja/changelog.md)

#### コアコンセプト

- [Claude Code の仕組み](https://code.claude.com/docs/ja/how-claude-code-works.md): agentic ループ、組み込みツール、Claude Code がプロジェクトとどのように相互作用するかを理解します。
- [Claude Code を拡張する](https://code.claude.com/docs/ja/features-overview.md): CLAUDE.md、Skills、subagents、hooks、MCP、plugins をいつ使用するかを理解します。
- [.claude ディレクトリを探索する](https://code.claude.com/docs/ja/claude-directory.md): Claude Code が CLAUDE.md、settings.json、hooks、skills、commands、subagents、workflows、rules、auto memory を読み込む場所。プロジェクト内の .claude ディレクトリとホームディレクトリの ~/.claude を探索します。
- [コンテキストウィンドウを探索する](https://code.claude.com/docs/ja/context-window.md): Claude Code のコンテキストウィンドウがセッション中にどのように満たされるかのインタラクティブなシミュレーション。自動的に読み込まれるもの、各ファイル読み込みのコスト、ルールとフックが発火するタイミングを確認できます。
- [Claude Code がプロンプトキャッシングを使用する方法](https://code.claude.com/docs/ja/prompt-caching.md): Claude Code はプロンプトキャッシングを自動的に管理します。モデル切り替えがキャッシュなしの遅いターンをトリガーする理由、`/compact` のコスト、CLAUDE.md の編集がセッション中に適用されない理由、キャッシュヒット率を確認する方法を確認してください。

#### Claude Code を使用する

- [Claude があなたのプロジェクトを記憶する方法](https://code.claude.com/docs/ja/memory.md): CLAUDE.md ファイルで Claude に永続的な指示を与え、自動メモリで Claude が自動的に学習を蓄積できるようにします。
- [セッションの管理](https://code.claude.com/docs/ja/sessions.md): Claude Code の会話に名前を付け、再開し、分岐し、切り替えます。`--continue`、`--resume`、`--from-pr`、`/resume` ピッカー、セッション命名、トランスクリプトのエクスポート、およびトランスクリプトの保存場所について説明します。
- [一般的なワークフロー](https://code.claude.com/docs/ja/common-workflows.md): Claude Code を使用してコードベースの探索、バグ修正、リファクタリング、テスト、その他の日常的なタスクを実行するためのステップバイステップガイド。
- [プロンプトライブラリ](https://code.claude.com/docs/ja/prompt-library.md): Claude Code 用のコピー＆ペーストプロンプト。タスクと役割でタグ付けされています。
- [Claude Code のベストプラクティス](https://code.claude.com/docs/ja/best-practices.md): 環境設定から並列セッションでのスケーリングまで、Claude Code を最大限に活用するためのヒントとパターン。

#### プラットフォームと統合

- [プラットフォームと統合](https://code.claude.com/docs/ja/platforms.md): Claude Code を実行する場所を選択し、何に接続するかを決定します。CLI、Desktop、VS Code、JetBrains、Web、モバイル、および Chrome、Slack、CI/CD などの統合を比較します。
- [任意のデバイスからローカルセッションを続行する Remote Control](https://code.claude.com/docs/ja/remote-control.md): Remote Control を使用して、電話、タブレット、または任意のブラウザから Claude Code のローカルセッションを続行します。claude.ai/code と Claude モバイルアプリで動作します。
- [Claude がプロジェクトで進行中の作業を調整する](https://code.claude.com/docs/ja/claude-projects.md): 関連する作業の本体を 1 つの会話で Claude に提供し、リポジトリ、指示、メモリを共有する並列クラウドセッションを調整させます。
- [モバイルの Claude Code](https://code.claude.com/docs/ja/mobile.md): Claude アプリ for iOS と Android を使用して、携帯電話から Claude Code タスクを開始、監視、操作します。
- [Chrome で Claude Code を使用する](https://code.claude.com/docs/ja/chrome.md): Claude Code を Chrome ブラウザに接続して、Web アプリをテストし、コンソールログでデバッグし、フォーム入力を自動化し、Web ページからデータを抽出します。
- [Claude に CLI からコンピュータを使用させる](https://code.claude.com/docs/ja/computer-use.md): Claude Code CLI でコンピュータ使用を有効にして、Claude がアプリを開いたり、クリックしたり、入力したり、macOS でスクリーンを表示したりできるようにします。ネイティブアプリをテストし、ビジュアルの問題をデバッグし、ターミナルを離れることなく GUI のみのツールを自動化します。
- [VS Code で Claude Code を使用する](https://code.claude.com/docs/ja/vs-code.md): Claude Code 拡張機能を VS Code にインストールして設定します。インラインの差分表示、@-メンション、プラン確認、キーボードショートカットを使用した AI コーディング支援を取得します。
- [JetBrains IDEs](https://code.claude.com/docs/ja/jetbrains.md): Claude Code を IntelliJ、PyCharm、WebStorm など JetBrains IDEs で使用する
- [Slack での Claude Code](https://code.claude.com/docs/ja/slack.md): Slack ワークスペースから直接コーディングタスクを委任する。Anthropic は Team および Enterprise ワークスペース向けにこの以前のバージョンを Claude Tag に置き換えています。Pro および Max プランではセットアップパスのままです。
- [Claude Tag](https://code.claude.com/docs/ja/claude-tag.md): Claude Tag を使用して Claude をチームの Slack チャネルに導入し、claude.com で設定と使用方法のドキュメントを確認できます。

##### Claude Code クラウド版

- [Claude Code をクラウドで始める](https://code.claude.com/docs/ja/web-quickstart.md): ブラウザまたはスマートフォンからクラウドで Claude Code を実行します。GitHub リポジトリを接続し、タスクを送信し、ローカルセットアップなしで PR をレビューします。
- [クラウドで Claude Code を使用する](https://code.claude.com/docs/ja/claude-code-on-the-web.md): ブラウザ、携帯電話、デスクトップアプリ、またはターミナルからクラウドで Claude Code セッションを実行し、--cloud と --teleport で移動し、プルリクエストを自動修正します。
- [ルーティンで作業を自動化する](https://code.claude.com/docs/ja/routines.md): Claude Code を自動操縦に設定します。スケジュールで実行するルーティンを定義したり、API 呼び出しでトリガーしたり、Anthropic が管理するクラウドインフラストラクチャから GitHub イベントに反応させたりできます。
- [ultrareview でバグを見つける](https://code.claude.com/docs/ja/ultrareview.md): /code-review ultra でクラウド上で深い複数エージェント型のコードレビューを実行し、マージ前にバグを見つけて検証します。

##### Claude Code デスクトップ版

- [デスクトップアプリを始める](https://code.claude.com/docs/ja/desktop-quickstart.md): Claude Code をデスクトップにインストールして、最初のコーディングセッションを開始します
- [Desktop application](https://code.claude.com/docs/ja/desktop.md): Claude Code Desktop をさらに活用する：Git 分離による並列セッション、ドラッグアンドドロップペインレイアウト、統合ターミナルとファイルエディタ、サイドチャット、コンピュータ使用、電話から Dispatch セッションを送信、ビジュアル diff レビュー、アプリプレビュー、PR 監視、コネクタ、エンタープライズ設定。
- [Claude Desktop on Linux (beta)](https://code.claude.com/docs/ja/desktop-linux.md): Ubuntu と Debian に Claude デスクトップアプリをインストールおよび更新する
- [Claude Code Desktop in WSL](https://code.claude.com/docs/ja/desktop-wsl.md): WSL 2 ディストリビューション内で Code セッションを実行する
- [Claude Code Desktop でスケジュール設定されたタスクを実行する](https://code.claude.com/docs/ja/desktop-scheduled-tasks.md): Claude Code Desktop でスケジュール設定されたタスクを設定して、毎日のコードレビュー、依存関係の監査、または朝のブリーフィングなど、定期的に Claude を自動的に実行します。
- [iOS シミュレータでアプリをテストする](https://code.claude.com/docs/ja/desktop-ios-simulator.md): Claude Code Desktop は、Claude がアプリをビルド、実行、またはチェックするときに、iOS シミュレータペインでアプリを開きます。各セッションに対して個別のシミュレータが用意されます。

##### コードレビュー & CI/CD

- [Claude がコードを書く際のセキュリティ問題をキャッチする](https://code.claude.com/docs/ja/security-guidance.md): security-guidance プラグインをインストールして、Claude が自身のコード変更の脆弱性をレビューし、同じセッション内で修正するようにします。
- [コードベースの脆弱性をスキャンする](https://code.claude.com/docs/ja/claude-security.md): Claude Security プラグインをインストールして、Claude Code セッション内でコードベースの脆弱性をスキャンし、検出結果をレビューして適用できるパッチに変換します。
- [Code Review](https://code.claude.com/docs/ja/code-review.md): マルチエージェント分析を使用してコードベース全体を検査し、ロジックエラー、セキュリティ脆弱性、リグレッションを検出する自動化された PR レビューを設定します
- [Claude Code GitHub Actions](https://code.claude.com/docs/ja/github-actions.md): @claude メンションに応答し、タスクを自動化し、イシューをプルリクエストに変換するために GitHub Actions ワークフロー内で Claude Code を実行します
- [Claude Code GitHub Actions をクラウドプロバイダーで使用する](https://code.claude.com/docs/ja/github-actions-cloud-providers.md): Claude Code GitHub Actions を Claude API の代わりに Amazon Bedrock、Google Cloud の Agent Platform、または Microsoft Foundry を通じて実行する
- [Claude Code と GitHub Enterprise Server](https://code.claude.com/docs/ja/github-enterprise-server.md): Claude Code を自社ホストの GitHub Enterprise Server インスタンスに接続して、クラウドセッション、コードレビュー、プラグインマーケットプレイスを利用できます。
- [Claude Code GitLab CI/CD](https://code.claude.com/docs/ja/gitlab-ci-cd.md): Claude Code を GitLab CI/CD で開発ワークフローに統合する方法を学びます

### Claude Code で構築する

#### エージェントと並列処理

- [エージェントを並列実行する](https://code.claude.com/docs/ja/agents.md): Claude Code が複数のタスクを同時に実行する 5 つの方法を比較します。サブエージェント、エージェントビュー、エージェントチーム、動的ワークフロー、およびプロジェクトについて説明します。
- [カスタムサブエージェントの作成](https://code.claude.com/docs/ja/sub-agents.md): Claude Code でタスク固有のワークフローと改善されたコンテキスト管理のための特化した AI サブエージェントを作成して使用します。
- [複数のエージェントをエージェントビューで管理する](https://code.claude.com/docs/ja/agent-view.md): 1 つの画面から多くの Claude Code セッションをディスパッチして管理します。エージェントビューは、すべてのセッションが何をしているか、どのセッションが入力を必要としているかを表示します。
- [Claude Code セッションのチームを調整する](https://code.claude.com/docs/ja/agent-teams.md): 複数の Claude Code インスタンスがチームとして連携して動作するように調整し、共有タスク、エージェント間メッセージング、および一元管理を実現します。
- [他の Claude Code セッションにメッセージを送信する](https://code.claude.com/docs/ja/cross-session-messaging.md): Claude が同じマシン上の他の Claude Code セッションをリストアップしてメッセージを送信できるようにし、他のマシンまたはクラウド上のセッションに到達します。
- [動的ワークフローで大規模にサブエージェントをオーケストレーションする](https://code.claude.com/docs/ja/workflows.md): 動的ワークフローは、Claude が作成したスクリプトから多くのサブエージェントをオーケストレーションし、再実行できます。コードベース監査、大規模マイグレーション、相互検証研究に使用します。
- [worktree を使用して並列セッションを実行する](https://code.claude.com/docs/ja/worktrees.md): 並列 Claude Code セッションを個別の git worktree に分離して、変更が衝突しないようにします。`--worktree` フラグ、subagent の分離、`.worktreeinclude`、クリーンアップ、および非 git VCS フックについて説明します。

#### Model Context Protocol（MCP）

- [MCP サーバーに接続する](https://code.claude.com/docs/ja/mcp-quickstart.md): MCP サーバーを Claude Code に追加し、接続を確認し、ディスク上の設定を見つけます。
- [MCP を使用して Claude Code をツールに接続する](https://code.claude.com/docs/ja/mcp.md): Model Context Protocol を使用して Claude Code をツールに接続する方法を学びます。

#### Skills

- [Claude をスキルで拡張する](https://code.claude.com/docs/ja/skills.md): Claude Code でスキルを作成、管理、共有して Claude の機能を拡張します。カスタムコマンドとバンドルされたスキルが含まれます。

#### Artifacts

- [セッション出力をアーティファクトとして共有する](https://code.claude.com/docs/ja/artifacts.md): Artifacts は Claude Code の成果物を claude.ai 上のライブでインタラクティブなページに変え、プライベートに保つ、組織と共有する、または公開リンクで公開することができます。

#### オートメーション

- [hooks でアクションを自動化する](https://code.claude.com/docs/ja/hooks-guide.md): Claude Code がファイルを編集したり、タスクを完了したり、入力が必要になったりしたときに、シェルコマンドを自動的に実行します。コードをフォーマットし、通知を送信し、コマンドを検証し、プロジェクトルールを適用します。
- [チャネルを使用して実行中のセッションにイベントをプッシュする](https://code.claude.com/docs/ja/channels.md): チャネルを使用して、MCP サーバーから実行中の Claude Code セッションにメッセージ、アラート、ウェブフックをプッシュします。CI 結果、チャットメッセージ、監視イベントを転送して、あなたが不在の間に Claude が対応できるようにします。
- [スケジュールに従ってプロンプトを実行する](https://code.claude.com/docs/ja/scheduled-tasks.md): /loop と cron スケジューリングツールを使用して、Claude Code セッション内でプロンプトを繰り返し実行したり、ステータスをポーリングしたり、1 回限りのリマインダーを設定したりします。
- [Claude をゴールに向かって動作させ続ける](https://code.claude.com/docs/ja/goal.md): /goal でコンプリーション条件を設定すると、Claude はターン間でプロンプトなしに条件が満たされるまで動作し続けます。モデルが不可能と判断するか、修正が必要なエラーが発生するとゴールがクリアされます。
- [Claude Code をプログラムで実行する](https://code.claude.com/docs/ja/headless.md): Agent SDK を使用して、CLI、Python、または TypeScript からプログラムで Claude Code を実行します。
- [リンクからセッションを起動する](https://code.claude.com/docs/ja/deep-links.md): URL から Claude Code ターミナルセッションを開きます。ランブック、アラート、ダッシュボードに `claude-cli://` リンクを埋め込むと、クリックで Claude Code が正しいリポジトリで正しいプロンプトを使って開きます。

#### ガイド

- [モノレポまたは大規模コードベースで Claude Code をセットアップする](https://code.claude.com/docs/ja/large-codebases.md): ネストされた CLAUDE.md ファイル、スパースワークツリー、コード インテリジェンス、パッケージごとのスキルを使用して、モノレポと大規模シングルツリーコードベース向けに Claude Code を設定し、Claude が作業中のコードに焦点を当てるようにします。

#### トラブルシューティング

- [インストールとログインのトラブルシューティング](https://code.claude.com/docs/ja/troubleshoot-install.md): Claude Code のインストールまたはサインイン時に、コマンドが見つからない、PATH、権限、ネットワーク、認証エラーを修正します。
- [トラブルシューティング](https://code.claude.com/docs/ja/troubleshooting.md): Claude Code の高い CPU またはメモリ使用量、ハング、auto-compact スラッシング、検索の問題を修正し、その他の問題に対応する適切なページを見つけます。
- [設定をデバッグする](https://code.claude.com/docs/ja/debug-your-config.md): CLAUDE.md、設定、hooks、MCP サーバー、またはスキルが機能していない理由を診断します。/context、/doctor、/hooks、/mcp を使用して、実際に読み込まれた内容を確認します。
- [エラーリファレンス](https://code.claude.com/docs/ja/errors.md): Claude Code のランタイムエラーメッセージを検索し、各エラーの意味と修正方法を確認できます。

### プラグイン

#### プラグイン

- [プラグインの概要](https://code.claude.com/docs/ja/plugins/overview.md): Claude Code プラグインとは何か、スタンドアロンスキルまたは MCP サーバーの代わりにプラグインが必要な場合、およびプラグインをインストールまたは作成するために読むべきページについて理解します。

#### プラグインを使用する

- [プラグインのインストールと管理](https://code.claude.com/docs/ja/plugins/install.md): 任意のサーフェスから Claude Code プラグインをマーケットプレイスからインストールし、インストール範囲を選択して、後で更新または削除します。
- [Anthropic のマーケットプレイス](https://code.claude.com/docs/ja/plugins/anthropic-marketplaces.md): Claude Code 向けの Anthropic 公式、コミュニティ、デモプラグインマーケットプレイス：それぞれの名前、リポジトリ、追加方法、プラグインの閲覧場所。
- [コード インテリジェンス プラグイン](https://code.claude.com/docs/ja/plugins/code-intelligence.md): 言語サーバー プラグインをインストールして、Claude が編集後の型エラーを検出し、シンボルでコードをナビゲートできるようにし、LSP プラグイン推奨ダイアログに応答します。
- [プラグインのセキュリティと信頼](https://code.claude.com/docs/ja/plugins/security.md): プラグインをインストールする前に信頼できるかどうかを判断します。マシン上でプラグインが何ができるか、プラグインをレビューする方法、削除する方法について説明します。

#### プラグインを作成

- [Claude Code プラグインを作成する](https://code.claude.com/docs/ja/plugins/create.md): 空のディレクトリから最初の Claude Code プラグインを構築し、マーケットプレイスなしでテストし、既存の .claude/ セットアップを変換します。
- [プラグインにコンポーネントを追加する](https://code.claude.com/docs/ja/plugins/components.md): スキル、フック、MCP サーバー、その他すべてのコンポーネントタイプを Claude Code プラグインに追加し、各コンポーネントの検証例を含めます。
- [プラグイン依存関係](https://code.claude.com/docs/ja/plugins/dependencies.md): プラグインが依存するプラグインを宣言し、^1.2 などのバージョン範囲を指定して、Claude Code がどのようにインストール、解決、削除するかを確認します。
- [evals でプラグインをテストする](https://code.claude.com/docs/ja/plugin-evals.md): Claude Code プラグイン用の eval ケースを作成し、claude plugin eval で実行し、結果をグレード化し、プラグインなしのベースラインと比較し、CI でスコアをゲートする。
- [プラグインを公開・配布する](https://code.claude.com/docs/ja/plugins/publish.md): Claude Code プラグインを独自のマーケットプレイスまたは Anthropic のコミュニティマーケットプレイスを通じて公開し、リリース前チェックリストとユーザーが更新を受け取る方法について説明します。
- [プラグインのコストと使用状況を測定する](https://code.claude.com/docs/ja/plugins/measure.md): Claude Code プラグインのトークンコスト、人々がまだそれを使用しているかどうかを確認し、組織全体のプラグイン質問のテレメトリイベントを選択します。
- [CLI から プラグインを推奨する](https://code.claude.com/docs/ja/plugins/cli-hints.md): Claude Code ユーザーに対して、CLI または SDK から claude-code-hint タグを出力することで、公式マーケットプレイスのプラグインをインストールするよう促します。

#### マーケットプレイスを実行する

- [マーケットプレイスを作成する](https://code.claude.com/docs/ja/plugins/create-marketplace.md): marketplace.json ファイルからプラグインマーケットプレイスを構築し、ホストする前にローカルでテストします。
- [マーケットプレイスをホストして維持する](https://code.claude.com/docs/ja/plugins/host-marketplace.md): ユーザーが到達できる場所にプラグインマーケットプレイスを公開し、プライベートマーケットプレイスへのアクセスを許可し、インストールを破損させずに更新と名前変更をリリースします。
- [組織向けプラグインを推奨する](https://code.claude.com/docs/ja/plugins/relevance.md): マーケットプレイスプラグインエントリに関連性ブロックを追加して、ユーザーの作業が一致するときに Claude Code が推奨するようにし、マネージド設定でマーケットプレイスをホワイトリストに登録します。

#### 組織向けプラグインを管理する

- [組織向けの Claude Code プラグインを管理する](https://code.claude.com/docs/ja/plugins/org.md): マネージド設定を通じて、組織内のすべてのマシンに Claude Code がインストールして許可するプラグインを制御します。

#### トラブルシューティング

- [プラグインのトラブルシューティング](https://code.claude.com/docs/ja/plugins/troubleshooting.md): Claude Code でプラグインエラーを修正します。/plugin の実行からインストール、組織ポリシーまで、段階ごとにグループ化された正確なメッセージを見つけます。
- [プラグイン読み込みリファレンス](https://code.claude.com/docs/ja/plugins/loading.md): Claude Code がどのプラグインをどこから読み込むか、どの設定ファイルが読み込みを決定するか、なぜアップデートが反映されなかったのかを追跡します。

#### リファレンス

- [プラグインマニフェストリファレンス](https://code.claude.com/docs/ja/plugins/manifest-reference.md): plugin.json の完全なリファレンス：すべてのフィールドとその型、デフォルト値、受け入れられるパス形式、userConfig と環境変数スキーマ。
- [マーケットプレイスリファレンス](https://code.claude.com/docs/ja/plugins/marketplace-reference.md): marketplace.json フィールド、プラグインエントリ、プラグインおよびマーケットプレイスソースオブジェクトの完全なリファレンス。各フィールドの有効な場所を含みます。
- [プラグインコマンドリファレンス](https://code.claude.com/docs/ja/plugins/cli-reference.md): claude プラグインシェルコマンド、セッション内の /plugin と /reload-plugins、および 1 つのセッションのためにプラグインをロードするフラグの完全なリファレンス。

### 管理

#### セットアップとアクセス

- [組織向けに Claude Code をセットアップする](https://code.claude.com/docs/ja/admin-setup.md): Claude Code を展開する管理者向けの決定マップ。API プロバイダー、マネージド設定、ポリシー実行、使用状況監視、データ処理をカバーしています。
- [高度なセットアップ](https://code.claude.com/docs/ja/setup.md): Claude Code のシステム要件、プラットフォーム固有のインストール、バージョン管理、およびアンインストール。
- [認証](https://code.claude.com/docs/ja/authentication.md): Claude Code にログインし、個人、チーム、組織向けの認証を設定します。
- [マネージド設定をデプロイする](https://code.claude.com/docs/ja/managed-settings.md): すべての開発者のマシンにマネージド設定をデプロイします。OS ごとの配信メカニズム、Claude Code がマネージドソースを組み合わせる方法、および強制の検証方法について説明します。
- [サーバー管理設定を構成する](https://code.claude.com/docs/ja/server-managed-settings.md): デバイス管理インフラストラクチャを必要とせずに、サーバー配信設定を通じて組織全体で Claude Code を一元的に構成します。
- [組織の MCP サーバーアクセスを制御する](https://code.claude.com/docs/ja/managed-mcp.md): 管理対象設定ファイル、管理対象設定、許可リスト、拒否リストを使用して、ユーザーが追加または接続できる MCP サーバーを制限するか、すべてのユーザーにサーバーを提供します。
- [オートモードの設定](https://code.claude.com/docs/ja/auto-mode-config.md): オートモード分類器に、組織が信頼するリポジトリ、バケット、ドメインを指定します。環境コンテキストを設定し、デフォルトのブロックおよび許可ルールをオーバーライドし、オートモード CLI サブコマンドで有効な設定を検査します。

#### デプロイメント

- [エンタープライズデプロイメント概要](https://code.claude.com/docs/ja/third-party-integrations.md): Claude Code が様々なサードパーティサービスとインフラストラクチャと統合して、エンタープライズデプロイメント要件を満たす方法について学びます。
- [機能の利用可能性](https://code.claude.com/docs/ja/feature-availability.md): Anthropic のサブスクリプションプラン、Anthropic Console、Amazon Bedrock、Claude Platform on AWS、Google Cloud の Agent Platform、Microsoft Foundry 全体で利用可能な Claude Code 機能を比較します。
- [Amazon Bedrock 上の Claude Code](https://code.claude.com/docs/ja/amazon-bedrock.md): Amazon Bedrock を通じた Claude Code の設定方法（セットアップ、IAM 設定、トラブルシューティングを含む）について学習します。
- [AWS 上の Claude Platform での Claude Code](https://code.claude.com/docs/ja/claude-platform-on-aws.md): AWS 認証、IAM アクセス制御、AWS Marketplace 請求を使用して、Anthropic が運営する Claude API を使用するように Claude Code を設定します。
- [Google Cloud の Agent Platform 上の Claude Code](https://code.claude.com/docs/ja/google-vertex-ai.md): Google Cloud の Agent Platform（旧 Vertex AI）を通じた Claude Code の設定方法について学びます。セットアップ、IAM 設定、トラブルシューティングを含みます。
- [Claude Code on Microsoft Foundry](https://code.claude.com/docs/ja/microsoft-foundry.md): Microsoft Foundry を通じて Claude Code を構成する方法について学びます。セットアップ、構成、トラブルシューティングを含みます。
- [エンタープライズネットワーク設定](https://code.claude.com/docs/ja/network-config.md): プロキシサーバー、カスタム認証局（CA）、相互 Transport Layer Security（mTLS）認証を使用して、エンタープライズ環境向けに Claude Code を設定します。
- [企業ランチャーの背後で Claude Code を実行する](https://code.claude.com/docs/ja/corporate-launcher.md): CLAUDE_CODE_PROCESS_WRAPPER または processWrapper 設定を使用して、Claude Code がそのバイナリから起動するプロセス（バックグラウンドサービスとすべてのエージェントビューセッションを含む）を必須ランチャーを通じてルーティングします。
- [開発コンテナ](https://code.claude.com/docs/ja/devcontainer.md): チーム全体で一貫した分離環境を実現するため、開発コンテナ内で Claude Code を実行します。

#### ゲートウェイ

- [ゲートウェイを通じて Claude Code を実行する](https://code.claude.com/docs/ja/gateways.md): Claude Code を自社ホスト型ゲートウェイ経由でルーティングして、認証情報の一元管理、使用状況の追跡、コスト管理を実現します。アーキテクチャ、Anthropic の Claude apps ゲートウェイ、および他のゲートウェイ製品の使用方法について説明します。

##### Claude apps gateway

- [Amazon Bedrock、Claude Platform on AWS、Google Cloud、Microsoft Foundry 向け Claude アプリゲートウェイ](https://code.claude.com/docs/ja/claude-apps-gateway.md): SSO サインイン、グループごとのモデルアクセス、OTLP テレメトリを備えた自己ホスト型ゲートウェイを通じて、Amazon Bedrock、Claude Platform on AWS、Google Cloud、または Microsoft Foundry で Claude Code を実行します。
- [Claude apps gateway 設定](https://code.claude.com/docs/ja/claude-apps-gateway-config.md): gateway.yaml のすべてのオプションのリファレンス：リスナーと TLS、OIDC、セッション、Postgres ストア、Amazon Bedrock、Claude Platform on AWS、Google Cloud の Agent Platform、Microsoft Foundry アップストリーム、モデルルーティング、マネージドポリシー、テレメトリー。
- [Claude apps gateway の支出制限](https://code.claude.com/docs/ja/claude-apps-gateway-spend-limits.md): Claude apps gateway を通じて各開発者の支出を日単位、週単位、または月単位で制限します。Admin API で制限を設定すると、gateway はすべてのリクエストでそれらを実行します。
- [Claude apps gateway のデプロイと運用](https://code.claude.com/docs/ja/claude-apps-gateway-deploy.md): IdP にゲートウェイを登録し、コンテナをビルドして Kubernetes または Cloud Run にデプロイし、ヘルスチェック、シークレットローテーション、アップグレード、セキュリティを運用します。
- [AWS に Claude apps gateway をデプロイする](https://code.claude.com/docs/ja/claude-apps-gateway-on-aws.md): AWS で Claude apps gateway を実行する実装例：ECS Fargate または EKS、Amazon RDS for PostgreSQL、AWS Secrets Manager、および Amazon Bedrock への IAM ロール認証。
- [Google Cloud に Claude apps gateway をデプロイする](https://code.claude.com/docs/ja/claude-apps-gateway-on-gcp.md): Google Cloud で Claude apps gateway を実行する実装例：Cloud Run または GKE、Cloud SQL for PostgreSQL、Secret Manager、および Google Cloud の Agent Platform への service account 認証。

##### その他のゲートウェイ

- [その他の LLM gateway](https://code.claude.com/docs/ja/llm-gateway.md): 組織が既に実行している LLM gateway を通じて Claude Code をルーティングします。Claude Code をゲートウェイに接続する方法、組織向けのロールアウト、Claude Code がゲートウェイに送信する内容について説明します。
- [Claude Code を LLM ゲートウェイに接続する](https://code.claude.com/docs/ja/llm-gateway-connect.md): Claude Code を組織の LLM ゲートウェイに指定します。管理者がすでに設定しているかどうかを確認するか、基本 URL と認証情報を自分で設定してから、接続を確認し、ゲートウェイエラーを修正します。
- [組織向けの LLM ゲートウェイをロールアウトする](https://code.claude.com/docs/ja/llm-gateway-rollout.md): Claude Code 用のゲートウェイ製品をデプロイします。Claude Code が送信する内容を転送するように設定し、開発者認証情報を発行し、マネージド設定を通じて設定を配布し、ロールアウトを検証します。
- [Claude Code ゲートウェイ互換性ガイド](https://code.claude.com/docs/ja/llm-gateway-protocol.md): Claude Code と互換性のある LLM ゲートウェイを保つ：呼び出すエンドポイント、転送する必要があるヘッダーとボディフィールド、および削除されると機能しなくなるもの。

#### 使用状況とコスト

- [監視](https://code.claude.com/docs/ja/monitoring-usage.md): Claude Code の OpenTelemetry を有効にして設定する方法を学びます。
- [コストを効果的に管理する](https://code.claude.com/docs/ja/costs.md): トークン使用量を追跡し、チームの支出制限を設定し、コンテキスト管理、モデル選択、拡張思考設定、前処理フックを使用して Claude Code のコストを削減します。
- [チームの使用状況を分析で追跡する](https://code.claude.com/docs/ja/analytics.md): Claude Code の使用メトリクスを表示し、採用状況を追跡し、分析ダッシュボードでエンジニアリング速度を測定します。

#### セキュリティとデータ

- [セキュリティ](https://code.claude.com/docs/ja/security.md): Claude Code のセキュリティ対策とセキュアな使用方法のベストプラクティスについて学びます。
- [データ使用](https://code.claude.com/docs/ja/data-usage.md): Anthropic の Claude のデータ使用ポリシーについて学習します
- [ゼロデータ保持](https://code.claude.com/docs/ja/zero-data-retention.md): Claude for Enterprise での Claude Code のゼロデータ保持（ZDR）について、スコープ、無効化される機能、有効化のリクエスト方法を学びます。

#### 導入

- [コミュニケーションキット](https://code.claude.com/docs/ja/communications-kit.md): Claude Code をエンジニアリング組織全体にロールアウトするための、ローンチアナウンスメント、ドリップキャンペーンメッセージ、FAQ 回答。
- [チャンピオンキット](https://code.claude.com/docs/ja/champion-kit.md): Claude Code を社内で推進するエンジニア向けの実行計画：何を共有するか、質問にどう答えるか、チーム内での採用を拡大する方法。

### 設定

#### 設定

- [設定ファイルと優先順位](https://code.claude.com/docs/ja/settings.md): Claude Code の設定を変更し、キーが属するスコープを選択し、変更を確認し、複数の場所でキーが設定されている場合に Claude Code が使用する値を学びます。
- [すべての設定](https://code.claude.com/docs/ja/settings-reference.md): Claude Code の settings.json キーの完全なリファレンス：各キーの場所、型とデフォルト値、貼り付け可能な例、およびすべてのキーのインデックス。
- [設定ファイルの例](https://code.claude.com/docs/ja/settings-example.md): 開発者、チーム、組織向けの現実的な settings.json ファイル：1 つをコピーして、必要なキーを保持し、値を変更してください。

#### 権限とサンドボックス

- [権限を設定する](https://code.claude.com/docs/ja/permissions.md): きめ細かい権限ルール、モード、管理ポリシーを使用して、Claude Code がアクセスして実行できる内容を制御します。
- [権限モードを選択する](https://code.claude.com/docs/ja/permission-modes.md): Claude がアクションを実行する前に確認するかどうかを制御します。CLI で Shift+Tab でモードを切り替えるか、VS Code のモード指示器、Desktop のモードセレクター、または Web のモードドロップダウンを使用します。
- [サンドボックス化された Bash ツールを設定する](https://code.claude.com/docs/ja/sandboxing.md): Claude Code のサンドボックス化された Bash ツールがファイルシステムとネットワークの分離を提供し、より安全で自律的なエージェント実行を実現する方法について学びます。
- [サンドボックス環境を選択する](https://code.claude.com/docs/ja/sandbox-environments.md): Claude Code のサンドボックスオプションを比較します。組み込みのサンドボックス化された Bash ツール、サンドボックスランタイム、dev コンテナ、Docker、VM があります。脅威モデルに適した分離を選択してください。

#### 環境

- [クラウド環境を設定する](https://code.claude.com/docs/ja/cloud-environments.md): Claude Code クラウドセッション用のクラウド環境を設定します。ネットワークアクセスレベル、環境変数、セットアップスクリプト、環境キャッシュを構成できます。

##### セルフホスト環境

- [自己ホスト環境](https://code.claude.com/docs/ja/self-hosted-environments.md): 自分たちが管理するインフラストラクチャで Claude Code クラウドセッションを実行します。自己ホスト環境をセットアップし、ランナーをデプロイし、セッションを自分たちのコンピュートにルーティングします。
- [セルフホストされた環境のクイックスタート](https://code.claude.com/docs/ja/self-hosted-environments-quickstart.md): セルフホストされた環境を初めてセットアップします。Claude Code をインストールし、環境を作成し、ランナーを起動し、セッションをルーティングします。
- [本番環境へのセルフホスト環境のデプロイ](https://code.claude.com/docs/ja/self-hosted-environments-deploy.md): 本番環境でセルフホストランナーを実行する：セキュリティ強化、ネットワーク出力制御、git 認証情報、Kubernetes と Compose レシピ、トラブルシューティング。
- [セルフホストされた環境でセッションをカスタマイズする](https://code.claude.com/docs/ja/self-hosted-environments-configuration.md): ラッパースクリプト、ライフサイクルフック、オンデマンドランナースポーニングを使用して、セルフホストされた環境セッションをセッションごとの認証情報、ライフサイクルフック、オンデマンドランナースポーニングでカスタマイズします。
- [自己ホスト環境をエンドツーエンドでテストする](https://code.claude.com/docs/ja/self-hosted-environments-testing.md): CI から自己ホスト実行イメージを検証します。CLI でセッションをディスパッチし、Stop フックを通じて Claude の返信を読み取り、完全なループをスクリプト化します。
- [セルフホスト環境リファレンス](https://code.claude.com/docs/ja/self-hosted-environments-reference.md): セルフホストランナーとオーケストレーターの完全なリファレンス：CLI フラグ、環境変数、Prometheus メトリクス。
- [自己ホスト環境でセッション ID を検証する](https://code.claude.com/docs/ja/self-hosted-environments-identity.md): CLAUDE_CODE_SESSION_ACCESS_TOKEN JWT を検証して、自己ホスト環境内のセッションからのリクエストをネットワーク上のサービスが信頼できるようにします。

#### モデルと応答

- [モデル設定](https://code.claude.com/docs/ja/model-config.md): Claude Code のモデル設定について学習します。`opusplan` などのモデルエイリアスを含みます
- [高速モードでレスポンスを高速化](https://code.claude.com/docs/ja/fast-mode.md): Claude Code で高速モードを切り替えて、Opus のレスポンスを高速化します。
- [advisor ツールで難しい判断をエスカレートする](https://code.claude.com/docs/ja/advisor.md): メインモデルをより強力な advisor モデルと組み合わせて、タスク中の重要な瞬間に Claude が相談できるようにします。
- [出力スタイル](https://code.claude.com/docs/ja/output-styles.md): Concise や Explanatory などの組み込み出力スタイルを使用するか、カスタムスタイルを作成して、Claude Code のロール、トーン、応答形式を変更します。

#### インターフェース

- [Claude Code 用にターミナルを設定する](https://code.claude.com/docs/ja/terminal-config.md): Shift+Enter で改行を挿入する、Claude の処理完了時にターミナルベルを鳴らす、tmux を設定する、カラーテーマを合わせる、Claude Code CLI で Vim モードを有効にする方法を説明します。
- [フルスクリーンレンダリング](https://code.claude.com/docs/ja/fullscreen.md): マウスサポートと安定したメモリ使用量を備えた、より滑らかでちらつきのないレンダリングモードを有効にします。長い会話でも安定した動作を実現します。
- [スクリーンリーダーで Claude Code を使用する](https://code.claude.com/docs/ja/accessibility.md): VoiceOver や NVDA などのスクリーンリーダー、スクリーン拡大鏡、モーション削減、色覚異常対応テーマの設定で Claude Code をセットアップします。
- [音声ディクテーション](https://code.claude.com/docs/ja/voice-dictation.md): Claude Code CLI で音声ディクテーション機能を使用して、プロンプトを話して入力できます。長押しまたはタップで録音できます。
- [ステータスラインをカスタマイズする](https://code.claude.com/docs/ja/statusline.md): Claude Code でコンテキストウィンドウの使用状況、コスト、git ステータスを監視するカスタムステータスバーを設定します
- [キーボードショートカットのカスタマイズ](https://code.claude.com/docs/ja/keybindings.md): キーボードショートカットをカスタマイズして、Claude Code でキーバインディング設定ファイルを使用します。

### リファレンス

#### リファレンス

- [CLI リファレンス](https://code.claude.com/docs/ja/cli-reference.md): Claude Code コマンドラインインターフェースの完全なリファレンス。コマンドとフラグを含みます。
- [コマンド](https://code.claude.com/docs/ja/commands.md): Claude Code で利用可能なコマンドの完全なリファレンス。ビルトインコマンドとバンドルされたスキルを含みます。
- [環境変数](https://code.claude.com/docs/ja/env-vars.md): Claude Code の動作を制御する環境変数のリファレンス。
- [ツールリファレンス](https://code.claude.com/docs/ja/tools-reference.md): Claude Code が使用できるツールの完全なリファレンス。権限要件とツール別の動作を含みます。
- [インタラクティブモード](https://code.claude.com/docs/ja/interactive-mode.md): Claude Code セッションのキーボードショートカット、入力モード、インタラクティブ機能の完全なリファレンス。
- [チェックポイント](https://code.claude.com/docs/ja/checkpointing.md): Claude のエディット内容と会話を追跡、巻き戻し、要約してセッション状態を管理します。
- [Hooks リファレンス](https://code.claude.com/docs/ja/hooks.md): Claude Code のフック イベント、設定スキーマ、JSON 入出力形式、終了コード、非同期フック、HTTP フック、プロンプト フック、MCP ツール フックのリファレンス。
- [チャネルリファレンス](https://code.claude.com/docs/ja/channels-reference.md): webhook、アラート、チャットメッセージを Claude Code セッションにプッシュする MCP サーバーを構築します。チャネルコントラクトのリファレンス：機能宣言、通知イベント、返信ツール、送信者ゲーティング、権限リレー。

#### 用語集

- [用語集](https://code.claude.com/docs/ja/glossary.md): Claude Code の用語の定義。agentic loop、compaction、CLAUDE.md、hooks、subagents、MCP などのコア概念の意味を学びます。

### Agent SDK

#### Agent SDK

- [Agent SDK の概要](https://code.claude.com/docs/ja/agent-sdk/overview.md): Claude Code をライブラリとして使用して、本番環境対応の AI エージェントを構築します
- [クイックスタート](https://code.claude.com/docs/ja/agent-sdk/quickstart.md): Python または TypeScript Agent SDK を使用して、自律的に動作する AI エージェントを構築する方法を学びます
- [Claude Agent SDK への移行](https://code.claude.com/docs/ja/agent-sdk/migration-guide.md): Claude Code TypeScript および Python SDK を Claude Agent SDK に移行するためのガイド
- [Agent SDK のトラブルシューティング](https://code.claude.com/docs/ja/agent-sdk/troubleshooting.md): Claude Code CLI が起動に失敗した場合、CLI プロセスが終了した場合、または構造化出力なしで成功結果が返された場合の Agent SDK エラーを修正します。

#### エージェントを構築

- [エージェントを設定する](https://code.claude.com/docs/ja/agent-sdk/configuration.md): Agent SDK セッションを設定する：options オブジェクトを構成し、モデル、環境、制限を設定し、各機能オプションのページを見つけます。
- [例](https://code.claude.com/docs/ja/agent-sdk/examples.md): 構築したいものに合致する完全で実行可能な Agent SDK プロジェクト、または Claude Cookbook のガイド付きレシピを見つけてください。

#### コアコンセプト

- [エージェントループの仕組み](https://code.claude.com/docs/ja/agent-sdk/agent-loop.md): メッセージライフサイクル、ツール実行、コンテキストウィンドウ、および SDK エージェントを支えるアーキテクチャを理解します。
- [SDK で Claude Code 機能を使用する](https://code.claude.com/docs/ja/agent-sdk/claude-code-features.md): プロジェクト指示、スキル、フック、その他の Claude Code 機能を SDK エージェントに読み込みます。
- [セッションの操作](https://code.claude.com/docs/ja/agent-sdk/sessions.md): セッションがエージェント会話履歴をどのように保持するか、および以前の実行に戻るために continue、resume、fork をいつ使用するかについて説明します。
- [セッションを外部ストレージに永続化する](https://code.claude.com/docs/ja/agent-sdk/session-storage.md): Agent SDK セッションのトランスクリプトを独自のオブジェクトストア、キーバリューストア、またはデータベースにミラーリングして、他のホストがセッションを再開できるようにします。

#### 入力と出力

- [ストリーミング入力](https://code.claude.com/docs/ja/agent-sdk/streaming-vs-single-mode.md): Claude Agent SDK の 2 つの入力モードを理解し、各モードをいつ使用するかを学ぶ
- [承認とユーザー入力を処理する](https://code.claude.com/docs/ja/agent-sdk/user-input.md): Claude の承認リクエストと確認質問をユーザーに表示し、その決定を SDK に返します。
- [リアルタイムでレスポンスをストリーミングする](https://code.claude.com/docs/ja/agent-sdk/streaming-output.md): テキストとツール呼び出しがストリーミングされるときに、Agent SDK からリアルタイムレスポンスを取得します
- [エージェントから構造化された出力を取得する](https://code.claude.com/docs/ja/agent-sdk/structured-outputs.md): JSON Schema、Zod、または Pydantic を使用して、エージェントワークフローから検証済みの JSON を返します。マルチターンツール使用後に型安全で構造化されたデータを取得します。

#### ツールで拡張する

- [Claude にカスタムツールを提供する](https://code.claude.com/docs/ja/agent-sdk/custom-tools.md): Claude Agent SDK のインプロセス MCP サーバーでカスタムツールを定義し、Claude が関数を呼び出し、API にアクセスし、ドメイン固有の操作を実行できるようにします。
- [MCP を使用して外部ツールに接続する](https://code.claude.com/docs/ja/agent-sdk/mcp.md): MCP サーバーを設定してエージェントを外部ツールで拡張します。トランスポートタイプ、大規模なツールセット向けのツール検索、認証、エラーハンドリングについて説明します。
- [多くのツールにスケーリングするツール検索](https://code.claude.com/docs/ja/agent-sdk/tool-search.md): 必要なものだけをオンデマンドで検出して読み込むことで、エージェントを数千のツールにスケーリングします。
- [SDK のサブエージェント](https://code.claude.com/docs/ja/agent-sdk/subagents.md): コンテキストを分離し、タスクを並列実行し、Claude Agent SDK アプリケーションで特化した指示を適用するサブエージェントを定義および呼び出します。

#### 動作をカスタマイズ

- [システムプロンプトの変更](https://code.claude.com/docs/ja/agent-sdk/modifying-system-prompts.md): `claude_code` プリセットとカスタムシステムプロンプトの間で選択し、CLAUDE.md、出力スタイル、append、または完全にカスタムなプロンプトで動作をカスタマイズします。
- [Agent Skills でエージェントを拡張する](https://code.claude.com/docs/ja/agent-sdk/skills.md): Claude Agent SDK セッションで Claude が呼び出せる Skills を制御し、名前でコマンドをディスパッチし、セッションが検出する Skills を作成します
- [SDK のプラグイン](https://code.claude.com/docs/ja/agent-sdk/plugins.md): Agent SDK を通じてカスタムプラグインを読み込み、スキル、エージェント、フック、MCP サーバーで Claude Code を拡張します

#### 制御と可観測性

- [権限の設定](https://code.claude.com/docs/ja/agent-sdk/permissions.md): 権限モード、hooks、および宣言的な許可/拒否ルールを使用して、エージェントがツールをどのように使用するかを制御します。
- [フックを使用してエージェントの動作をインターセプトして制御する](https://code.claude.com/docs/ja/agent-sdk/hooks.md): フックを使用して、エージェント実行の重要なポイントでエージェントの動作をインターセプトしてカスタマイズします
- [checkpointing でファイル変更を巻き戻す](https://code.claude.com/docs/ja/agent-sdk/file-checkpointing.md): エージェントセッション中のファイル変更を追跡し、ファイルを以前の任意の状態に復元します
- [コストと使用状況を追跡する](https://code.claude.com/docs/ja/agent-sdk/cost-tracking.md): Claude Agent SDK でトークン使用状況を追跡し、コストを見積もり、プロンプトキャッシングを設定する方法を学びます。
- [OpenTelemetry を使用した可観測性](https://code.claude.com/docs/ja/agent-sdk/observability.md): Agent SDK からトレース、メトリクス、イベントを OpenTelemetry を使用して可観測性バックエンドにエクスポートします。
- [Todo を追跡する](https://code.claude.com/docs/ja/agent-sdk/todo-tracking.md): Agent SDK セッションで todo を追跡し、構造化されたツール呼び出しから Claude の進捗をアプリケーションでレンダリングします

#### デプロイメント

- [Agent SDK のホスティング](https://code.claude.com/docs/ja/agent-sdk/hosting.md): Agent SDK を本番環境にデプロイする：サブプロセスアーキテクチャ、セッション永続化、スケーリング、可観測性、Docker、Kubernetes、サンドボックスプロバイダー向けのマルチテナント分離。
- [AI エージェントの安全なデプロイ](https://code.claude.com/docs/ja/agent-sdk/secure-deployment.md): 分離、認証情報管理、ネットワーク制御を使用して Claude Code と Agent SDK のデプロイを保護するためのガイド

#### SDK リファレンス

- [Agent SDK リファレンス - TypeScript](https://code.claude.com/docs/ja/agent-sdk/typescript.md): TypeScript Agent SDK の完全な API リファレンス。すべての関数、型、インターフェースを含みます。
- [TypeScript SDK V2 セッション API（削除済み）](https://code.claude.com/docs/ja/agent-sdk/typescript-v2-preview.md): マルチターン会話向けのセッションベースの send/stream パターンを備えた、削除済みの V2 TypeScript Agent SDK セッション API のリファレンス。
- [Agent SDK リファレンス - Python](https://code.claude.com/docs/ja/agent-sdk/python.md): Python Agent SDK の完全な API リファレンス。すべての関数、型、クラスを含みます。

### 新機能

#### 新機能

- [新機能](https://code.claude.com/docs/ja/whats-new/index.md): Claude Code の注目すべき機能を毎週紹介するダイジェスト。コードスニペット、デモ、およびそれらが重要である理由についての説明が含まれています。
- [Week 36 · 8月31日～9月4日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w36.md): Claude Fable 5.1に切り替え、Desktop でコンピュータ使用をバックグラウンドで実行し、ライブ /diff パネルで Claude の編集を確認します。
- [第 35 週・2026 年 8 月 24～28 日](https://code.claude.com/docs/ja/whats-new/2026-w35.md): Claude Code デスクトップアプリでターミナルセッションを再開し、Claude が作成したフィードバックレポートを確認し、制限モードでセッションを開始します。
- [Week 34 · 8月17～21日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w34.md): /design スキルでドラフト可能な UI アートボードを作成し、Concise 出力スタイルを設定し、スマートフォンからマシン上で Claude Code セッションを開始します。
- [第 33 週・8 月 10～14 日、2026 年](https://code.claude.com/docs/ja/whats-new/2026-w33.md): Claude Code Desktop は使用制限がリセットされた後に自動継続し、フォークモードがデフォルトで有効になり、GitLab マージリクエストとマーケットプレイスが GitHub に参加します。
- [Week 32 · 8月3日～7日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w32.md): Claude Code セッションが相互にメッセージを送信でき、自己ホスト環境がクラウドセッションをお客様のインフラストラクチャで実行でき、自動モードがデフォルトの権限モードになります。
- [Week 30 · 7月20～24日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w30.md): Opus 5 が Opus のデフォルトモデルになり、Claude Code Desktop に iOS Simulator ペインが追加され、Claude Security プラグインがコードの脆弱性をスキャンします。
- [第 29 週・2026 年 7 月 13～17 日](https://code.claude.com/docs/ja/whats-new/2026-w29.md): MCP コネクタを通じてライブデータを公開アーティファクトに取り込み、新しいスクリーンリーダーモードで Claude Code をスクリーンリーダーと共に使用します。
- [Week 28 · 7月6日～10日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w28.md): Desktop アプリの組み込みブラウザから外部サイトを閲覧し、/doctor で完全なセットアップチェックアップを実行し、オートモードのトランスクリプト保護とエージェントビューのアップグレードを取得します。
- [Week 27 · 6月29日～7月3日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w27.md): Claude Sonnet 5 がデフォルトモデルになり、Claude in Chrome が一般提供開始、サブエージェントがデフォルトでバックグラウンド実行、Claude Desktop が Linux でベータ版提供開始、/radio が Claude FM にチューニングします。
- [Week 26 · 2026 年 6 月 22 日～26 日](https://code.claude.com/docs/ja/whats-new/2026-w26.md): シェルから claude mcp login で MCP サーバーを認証し、! プレフィックスでシェルモードコマンド出力に応答を取得し、/clear の前の会話を /rewind で再開します。
- [Week 25 · 2026年6月15日～19日](https://code.claude.com/docs/ja/whats-new/2026-w25.md): Artifacts を使用してセッションからライブで共有可能なページを公開し、deny ルールと ask ルールでツールパラメータをマッチングし、/config でプロンプトから任意の設定を行います。
- [Week 24 · 2026年6月8日～12日](https://code.claude.com/docs/ja/whats-new/2026-w24.md): /cd でセッションを新しいディレクトリに移動し、サブエージェントが独自のサブエージェントをスポーンでき、セーフモードで壊れた設定をトラブルシューティングします。
- [Week 23 · 2026 年 6 月 1 日～5 日](https://code.claude.com/docs/ja/whats-new/2026-w23.md): Amazon Bedrock、Google Cloud の Agent Platform、Microsoft Foundry で auto mode を実行し、acceptEdits モードでコードを実行できるファイルを書き込む前にプロンプトを表示し、/plugin list でインストール済みプラグインをリストアップし、マネージドデプロイメント向けに承認されたバージョン範囲を要求します。
- [Week 22 · 5月25～29日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w22.md): Claude Opus 4.8 で Claude Code を実行し、動的ワークフローで大規模なタスクを調整し、security-guidance プラグインでセキュリティの問題をキャッチし、Opus 4.8 でファストモードをより低い価格で使用します。
- [Week 21 · 5月18～22日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w21.md): Pro プランで auto mode を使用し、Sonnet 4.6 でサポートされ、/usage でどのスキル、サブエージェント、MCP サーバーがプラン制限を駆動しているかを確認し、新しい /code-review コマンドでdiff を確認します。
- [Week 20 · 2026年5月11日～15日](https://code.claude.com/docs/ja/whats-new/2026-w20.md): 1つの画面からすべての Claude Code セッションを管理できるエージェントビュー、条件が満たされるまで Claude を目標に向かって動作させ続け、Opus 4.7 でデフォルトでファストモードを実行します。
- [Week 19 · 2026年5月4日～8日](https://code.claude.com/docs/ja/whats-new/2026-w19.md): .zip アーカイブと URL からプラグインを読み込み、Ctrl+R ですべてのプロジェクト全体のコマンド履歴を検索し、ローカル HEAD またはリモートデフォルトから新しいワークツリーをブランチし、オートモードのハードデニールルールで無条件にアクションをブロックします。
- [Week 18 · 4月27日～5月1日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w18.md): Claude Code は Windows で Git Bash なしで実行でき、claude auth login はブラウザコールバックが localhost に到達できない場合に貼り付けられた OAuth コードを受け入れ、claude project purge はプロジェクトごとにローカル状態をクリーンアップし、PR URL を /resume に貼り付けるとそれを作成したセッションが見つかります。
- [Week 17 · 2026年4月20～24日](https://code.claude.com/docs/ja/whats-new/2026-w17.md): /ultrareview がリサーチプレビューとしてオープン、ターミナルに戻ったときの自動セッションリキャップ、プラグインで構築・配布できるカスタムカラーテーマ、ウェブ上で再設計された Claude Code。
- [Week 16 · 4月13～17日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w16.md): 新しい xhigh エフォートレベルを備えた Claude Opus 4.7、Claude Code ウェブ版の Routines、Claude が必要なときにあなたの電話に ping を送信するモバイルプッシュ通知、使用制限を駆動している要因を表示する /usage 内訳、およびバンドルされた JavaScript に代わるネイティブバイナリ。
- [Week 15 · 2026年4月6日～10日](https://code.claude.com/docs/ja/whats-new/2026-w15.md): Ultraplan クラウドプランニング、セルフペーシング /loop を備えた Monitor ツール、セットアップをパッケージ化するための /team-onboarding、およびターミナルからの /autofix-pr。
- [Week 14 · 3月30日～4月3日、2026年](https://code.claude.com/docs/ja/whats-new/2026-w14.md): CLI でのコンピュータ使用、インタラクティブなプロダクト内レッスン、ちらつきのないレンダリング、ツール別 MCP 結果サイズオーバーライド、および PATH 上のプラグイン実行ファイル。
- [Week 13 · 2026年3月23日～27日](https://code.claude.com/docs/ja/whats-new/2026-w13.md): 自動モード（ハンズオフ権限）、コンピュータ使用機能の組み込み、クラウド内の PR 自動修正、トランスクリプト検索、Windows 用 PowerShell ツール。

### リソース

#### リソース

- [法的および規制対応](https://code.claude.com/docs/ja/legal-and-compliance.md): Claude Code の法的契約、規制認証、およびセキュリティ情報。
