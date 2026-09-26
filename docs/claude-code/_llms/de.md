# Claude Code Docs: German

> Official documentation for Claude Code, Anthropic's agentic coding tool available in the terminal, IDE, desktop app, and browser. Covers installation, configuration, skills, subagents, hooks, MCP, the Agent SDK, and reference material.

## German

### Erste Schritte

#### Erste Schritte

- [Übersicht](https://code.claude.com/docs/de/overview.md): Claude Code ist ein agentengestütztes Codierungswerkzeug, das Ihre Codebasis liest, Dateien bearbeitet, Befehle ausführt und sich in Ihre Entwicklungstools integriert. Verfügbar in Ihrem Terminal, IDE, Desktop-App und Browser.
- [Schnellstart](https://code.claude.com/docs/de/quickstart.md): Willkommen bei Claude Code!
- [Changelog](https://code.claude.com/docs/de/changelog.md)

#### Kernkonzepte

- [So funktioniert Claude Code](https://code.claude.com/docs/de/how-claude-code-works.md): Verstehen Sie die agentengesteuerte Schleife, integrierte Tools und wie Claude Code mit Ihrem Projekt interagiert.
- [Claude Code erweitern](https://code.claude.com/docs/de/features-overview.md): Verstehen Sie, wann Sie CLAUDE.md, Skills, Subagents, Hooks, MCP und Plugins verwenden.
- [Erkunden Sie das .claude-Verzeichnis](https://code.claude.com/docs/de/claude-directory.md): Wo Claude Code CLAUDE.md, settings.json, hooks, skills, commands, subagents, workflows, rules und auto memory liest. Erkunden Sie das .claude-Verzeichnis in Ihrem Projekt und ~/.claude in Ihrem Home-Verzeichnis.
- [Erkunden Sie das Kontextfenster](https://code.claude.com/docs/de/context-window.md): Eine interaktive Simulation, wie sich das Kontextfenster von Claude Code während einer Sitzung füllt. Sehen Sie, was automatisch geladen wird, welche Kosten jeder Dateilesevorgang hat, und wann Regeln und Hooks ausgelöst werden.
- [Wie Claude Code Prompt Caching nutzt](https://code.claude.com/docs/de/prompt-caching.md): Claude Code verwaltet Prompt Caching automatisch. Erfahren Sie, warum ein Modellwechsel einen langsamen unkachedten Turn auslöst, was `/compact` kostet, warum CLAUDE.md-Änderungen mid-session nicht angewendet werden, und wie Sie Ihre Cache-Hit-Rate überprüfen.

#### Claude Code verwenden

- [Wie Claude sich Ihr Projekt merkt](https://code.claude.com/docs/de/memory.md): Geben Sie Claude persistente Anweisungen mit CLAUDE.md- oder AGENTS.md-Dateien, und lassen Sie Claude automatisch Erkenntnisse mit Auto-Memory sammeln.
- [Sitzungen verwalten](https://code.claude.com/docs/de/sessions.md): Benennen, fortsetzen, verzweigen und wechseln Sie zwischen Claude Code-Gesprächen. Behandelt `--continue`, `--resume`, `--from-pr`, die `/resume`-Auswahl, Sitzungsbenennung, Exportieren von Transkripten und wo Transkripte gespeichert werden.
- [Häufige Workflows](https://code.claude.com/docs/de/common-workflows.md): Schritt-für-Schritt-Anleitungen zum Erkunden von Codebases, Beheben von Fehlern, Refaktorierung, Testen und anderen alltäglichen Aufgaben mit Claude Code.
- [Prompt-Bibliothek](https://code.claude.com/docs/de/prompt-library.md): Kopieren Sie Prompts für Claude Code, kategorisiert nach Aufgabe und Rolle.
- [Best Practices für Claude Code](https://code.claude.com/docs/de/best-practices.md): Tipps und Muster, um das Beste aus Claude Code herauszuholen – von der Konfiguration Ihrer Umgebung bis zur Skalierung über parallele Sessions.

#### Plattformen und Integrationen

- [Plattformen und Integrationen](https://code.claude.com/docs/de/platforms.md): Wählen Sie, wo Sie Claude Code ausführen möchten, und was Sie damit verbinden. Vergleichen Sie die CLI, Desktop, VS Code, JetBrains, Web und Integrationen wie Chrome, Slack und CI/CD.
- [Lokale Sitzungen von jedem Gerät aus mit Remote Control fortsetzen](https://code.claude.com/docs/de/remote-control.md): Setzen Sie eine lokale Claude Code-Sitzung von Ihrem Telefon, Tablet oder einem beliebigen Browser aus mit Remote Control fort. Funktioniert mit claude.ai/code und der Claude-Mobile-App.
- [Lassen Sie Claude laufende Arbeiten mit Projekten koordinieren](https://code.claude.com/docs/de/claude-projects.md): Geben Sie Claude einen Bestand zusammenhängender Arbeiten in einem Gespräch und lassen Sie ihn parallele Cloud-Sitzungen koordinieren, die Repositorys, Anweisungen und Speicher gemeinsam nutzen.
- [Claude Code auf Mobilgeräten](https://code.claude.com/docs/de/mobile.md): Starten, überwachen und steuern Sie Claude Code-Aufgaben von Ihrem Telefon aus mit der Claude-App für iOS und Android.
- [Claude Code mit Chrome verwenden](https://code.claude.com/docs/de/chrome.md): Verbinden Sie Claude Code mit Ihrem Chrome-Browser, um Web-Apps zu testen, mit Konsolenprotokollen zu debuggen, Formularausfüllungen zu automatisieren und Daten von Webseiten zu extrahieren.
- [Claude von der CLI aus Ihren Computer nutzen lassen](https://code.claude.com/docs/de/computer-use.md): Aktivieren Sie die Computernutzung in der Claude Code CLI, damit Claude Apps öffnen, klicken, tippen und Ihren Bildschirm auf macOS sehen kann. Testen Sie native Apps, debuggen Sie visuelle Probleme und automatisieren Sie GUI-only-Tools, ohne Ihr Terminal zu verlassen.
- [Claude Code in VS Code verwenden](https://code.claude.com/docs/de/vs-code.md): Installieren und konfigurieren Sie die Claude Code-Erweiterung für VS Code. Erhalten Sie KI-Codierungshilfe mit Inline-Diffs, @-Erwähnungen, Planüberprüfung und Tastaturkürzeln.
- [JetBrains IDEs](https://code.claude.com/docs/de/jetbrains.md): Verwenden Sie Claude Code mit JetBrains IDEs einschließlich IntelliJ, PyCharm, WebStorm und mehr
- [Claude Code in Slack](https://code.claude.com/docs/de/slack.md): Delegieren Sie Codierungsaufgaben direkt aus Ihrem Slack-Arbeitsbereich. Anthropic stellt diese frühere Version für Team- und Enterprise-Arbeitsbereiche zugunsten von Claude Tag ein; sie bleibt der Einrichtungspfad für Pro- und Max-Pläne.
- [Claude Tag](https://code.claude.com/docs/de/claude-tag.md): Bringen Sie Claude mit Claude Tag in die Slack-Kanäle Ihres Teams und finden Sie die Setup- und Nutzungsdokumentation auf claude.com.

##### Claude Code in der Cloud

- [Erste Schritte mit Claude Code in der Cloud](https://code.claude.com/docs/de/web-quickstart.md): Führen Sie Claude Code in der Cloud aus Ihrem Browser oder Telefon aus. Verbinden Sie ein GitHub-Repository, übermitteln Sie eine Aufgabe und überprüfen Sie den PR ohne lokales Setup.
- [Claude Code in der Cloud verwenden](https://code.claude.com/docs/de/claude-code-on-the-web.md): Führen Sie Claude Code-Sitzungen in der Cloud aus Ihrem Browser, Telefon, Desktop-App oder Terminal aus, verschieben Sie sie mit --cloud und --teleport, und beheben Sie Pull Requests automatisch.
- [Automatisieren Sie Arbeitsabläufe mit Routinen](https://code.claude.com/docs/de/routines.md): Setzen Sie Claude Code auf Autopilot. Definieren Sie Routinen, die nach einem Zeitplan ausgeführt werden, durch API-Aufrufe ausgelöst werden oder auf GitHub-Ereignisse von der Cloud-Infrastruktur reagieren.
- [Bugs mit Ultrareview finden](https://code.claude.com/docs/de/ultrareview.md): Führen Sie eine tiefe, Multi-Agent-Code-Review in der Cloud mit /code-review ultra durch, um Bugs vor dem Merge zu finden und zu verifizieren.

##### Claude Code auf dem Desktop

- [Erste Schritte mit der Desktop-App](https://code.claude.com/docs/de/desktop-quickstart.md): Installieren Sie Claude Code auf dem Desktop und starten Sie Ihre erste Coding-Sitzung
- [Desktop-Anwendung](https://code.claude.com/docs/de/desktop.md): Nutzen Sie Claude Code Desktop optimal: parallele Sitzungen mit Git-Isolation, Drag-and-Drop-Pane-Layout, integriertes Terminal und Datei-Editor, Seitenchats, Computernutzung, Dispatch-Sitzungen von Ihrem Telefon, visuelle Diff-Überprüfung, App-Vorschau, PR-Überwachung, Konnektoren und Unternehmensk…
- [Claude Desktop unter Linux (Beta)](https://code.claude.com/docs/de/desktop-linux.md): Installieren und aktualisieren Sie die Claude-Desktop-App unter Ubuntu und Debian
- [Claude Code Desktop in WSL](https://code.claude.com/docs/de/desktop-wsl.md): Führen Sie Code-Sitzungen in einer WSL 2-Distribution unter Windows aus
- [Wiederkehrende Aufgaben in Claude Code Desktop planen](https://code.claude.com/docs/de/desktop-scheduled-tasks.md): Richten Sie geplante Aufgaben in Claude Code Desktop ein, um Claude automatisch in regelmäßigen Abständen für tägliche Code-Reviews, Abhängigkeitsprüfungen oder morgendliche Briefings auszuführen.
- [iOS-Apps im Simulator testen](https://code.claude.com/docs/de/desktop-ios-simulator.md): Claude Code Desktop öffnet Ihre App im iOS-Simulator-Bereich, wenn Claude sie erstellt, ausführt oder überprüft. Jede Sitzung hat einen separaten Simulator.

##### Code-Review & CI/CD

- [Sicherheitsprobleme erfassen, während Claude Code schreibt](https://code.claude.com/docs/de/security-guidance.md): Installieren Sie das security-guidance-Plugin, damit Claude seine eigenen Code-Änderungen auf Sicherheitslücken überprüft und diese in derselben Sitzung behebt.
- [Scannen Sie Ihre Codebasis auf Sicherheitslücken](https://code.claude.com/docs/de/claude-security.md): Installieren Sie das Claude Security Plugin, um Ihre Codebasis in einer Claude Code-Sitzung auf Sicherheitslücken zu scannen und Erkenntnisse in Patches umzuwandeln, die Sie überprüfen und anwenden.
- [Code Review](https://code.claude.com/docs/de/code-review.md): Richten Sie automatisierte PR-Reviews ein, die Logikfehler, Sicherheitslücken und Regressionen durch Multi-Agent-Analyse Ihrer vollständigen Codebasis erkennen
- [Claude Code GitHub Actions](https://code.claude.com/docs/de/github-actions.md): Führen Sie Claude Code in GitHub Actions-Workflows aus, um auf @claude-Erwähnungen zu reagieren, Aufgaben zu automatisieren und Issues in Pull Requests umzuwandeln
- [Claude Code GitHub Actions mit Cloud-Anbietern verwenden](https://code.claude.com/docs/de/github-actions-cloud-providers.md): Führen Sie Claude Code GitHub Actions über Amazon Bedrock, Google Cloud's Agent Platform oder Microsoft Foundry statt über die Claude API aus
- [Claude Code mit GitHub Enterprise Server](https://code.claude.com/docs/de/github-enterprise-server.md): Verbinden Sie Claude Code mit Ihrer selbstgehosteten GitHub Enterprise Server-Instanz für Web-Sitzungen, Code-Review und Plugin-Marktplätze.
- [Claude Code GitLab CI/CD](https://code.claude.com/docs/de/gitlab-ci-cd.md): Erfahren Sie, wie Sie Claude Code in Ihren Entwicklungs-Workflow mit GitLab CI/CD integrieren

### Mit Claude Code erstellen

#### Agenten und parallele Arbeit

- [Agenten parallel ausführen](https://code.claude.com/docs/de/agents.md): Vergleichen Sie die Möglichkeiten, wie Claude Code mehrere Aufgaben gleichzeitig bewältigen kann: Subagenten, Agent-Ansicht, Agent-Teams, dynamische Workflows und Projekte.
- [Benutzerdefinierte Subagenten erstellen](https://code.claude.com/docs/de/sub-agents.md): Erstellen und verwenden Sie spezialisierte KI-Subagenten in Claude Code für aufgabenspezifische Workflows und verbesserte Kontextverwaltung.
- [Mehrere Agenten mit der Agenten-Ansicht verwalten](https://code.claude.com/docs/de/agent-view.md): Versenden und verwalten Sie viele Claude Code-Sitzungen von einem Bildschirm aus. Die Agenten-Ansicht zeigt, was jede Sitzung tut und welche Ihre Eingabe benötigen.
- [Orchestrieren Sie Teams von Claude Code-Sitzungen](https://code.claude.com/docs/de/agent-teams.md): Koordinieren Sie mehrere Claude Code-Instanzen, die zusammen als Team arbeiten, mit gemeinsamen Aufgaben, Messaging zwischen Agenten und zentraler Verwaltung.
- [Nachrichten an Ihre anderen Claude Code-Sitzungen](https://code.claude.com/docs/de/cross-session-messaging.md): Lassen Sie Claude Ihre anderen Claude Code-Sitzungen auf diesem Computer auflisten und anschreiben, und erreichen Sie Ihre Sitzungen auf anderen Computern oder im Web.
- [Orchestrieren Sie Subagenten im großen Maßstab mit dynamischen Workflows](https://code.claude.com/docs/de/workflows.md): Dynamische Workflows orchestrieren viele Subagenten aus einem Skript, das Claude schreibt und das Sie erneut ausführen können. Verwenden Sie sie für Codebase-Audits, große Migrationen und überprüfte Recherchen.
- [Parallele Sitzungen mit Worktrees ausführen](https://code.claude.com/docs/de/worktrees.md): Isolieren Sie parallele Claude Code-Sitzungen in separaten Git-Worktrees, damit Änderungen nicht kollidieren. Behandelt das Flag `--worktree`, Subagent-Isolation, `.worktreeinclude`, Bereinigung und Non-Git-VCS-Hooks.

#### MCP

- [Mit MCP-Servern verbinden](https://code.claude.com/docs/de/mcp-quickstart.md): Fügen Sie einen MCP-Server zu Claude Code hinzu, überprüfen Sie die Verbindung und finden Sie die Konfiguration auf der Festplatte.
- [Claude Code mit Tools über MCP verbinden](https://code.claude.com/docs/de/mcp.md): Erfahren Sie, wie Sie Claude Code mit Ihren Tools über das Model Context Protocol verbinden.

#### Skills

- [Claude mit Skills erweitern](https://code.claude.com/docs/de/skills.md): Erstellen, verwalten und teilen Sie Skills, um die Funktionen von Claude in Claude Code zu erweitern. Umfasst benutzerdefinierte Befehle und gebündelte Skills.

#### Artefakte

- [Sitzungsausgabe als Artefakte freigeben](https://code.claude.com/docs/de/artifacts.md): Artefakte verwandeln die Arbeit von Claude Code in Live-Seiten, die interaktiv sind und auf claude.ai verfügbar sind. Sie können diese privat halten, mit Ihrer Organisation teilen oder über einen öffentlichen Link veröffentlichen.

#### Automatisierung

- [Automatisieren Sie Aktionen mit Hooks](https://code.claude.com/docs/de/hooks-guide.md): Führen Sie Shell-Befehle automatisch aus, wenn Claude Code Dateien bearbeitet, Aufgaben abschließt oder Eingaben benötigt. Formatieren Sie Code, senden Sie Benachrichtigungen, validieren Sie Befehle und erzwingen Sie Projektregeln.
- [Ereignisse mit Kanälen in eine laufende Sitzung übertragen](https://code.claude.com/docs/de/channels.md): Verwenden Sie Kanäle, um Nachrichten, Benachrichtigungen und Webhooks von einem MCP-Server in Ihre Claude Code-Sitzung zu übertragen. Leiten Sie CI-Ergebnisse, Chat-Nachrichten und Überwachungsereignisse weiter, damit Claude reagieren kann, während Sie weg sind.
- [Prompts nach Zeitplan ausführen](https://code.claude.com/docs/de/scheduled-tasks.md): Verwenden Sie /loop und die Cron-Planungstools, um Prompts wiederholt auszuführen, den Status abzurufen oder einmalige Erinnerungen innerhalb einer Claude Code-Sitzung zu setzen.
- [Claude auf ein Ziel hinarbeiten lassen](https://code.claude.com/docs/de/goal.md): Legen Sie mit /goal eine Abschlussbedingung fest und Claude arbeitet über mehrere Turns hinweg daran, bis die Bedingung erfüllt ist, ein Modell sie für unmöglich hält oder ein Fehler, den Sie beheben müssen, das Ziel löscht.
- [Claude Code programmgesteuert ausführen](https://code.claude.com/docs/de/headless.md): Verwenden Sie das Agent SDK, um Claude Code programmgesteuert über die CLI, Python oder TypeScript auszuführen.
- [Sitzungen über Links starten](https://code.claude.com/docs/de/deep-links.md): Öffnen Sie eine Claude Code-Terminalsitzung über eine URL. Betten Sie `claude-cli://`-Links in Runbooks, Warnungen und Dashboards ein, damit ein Klick Claude Code im richtigen Repository mit der richtigen Eingabeaufforderung öffnet.

#### Leitfäden

- [Claude Code in einem Monorepo oder großen Codebase einrichten](https://code.claude.com/docs/de/large-codebases.md): Konfigurieren Sie Claude Code für Monorepos und große Single-Tree-Codebases mit verschachtelten CLAUDE.md-Dateien, Sparse Worktrees, Code Intelligence und Skills pro Paket, damit Claude sich auf den Code konzentriert, an dem Sie arbeiten.

#### Fehlerbehebung

- [Installationsfehler und Anmeldungsprobleme beheben](https://code.claude.com/docs/de/troubleshoot-install.md): Beheben Sie Fehler wie „Befehl nicht gefunden", PATH, Berechtigungen, Netzwerk und Authentifizierungsfehler bei der Installation oder Anmeldung bei Claude Code.
- [Fehlerbehebung](https://code.claude.com/docs/de/troubleshooting.md): Beheben Sie hohe CPU- oder Speichernutzung, Hänger, Auto-Compact-Thrashing und Suchprobleme in Claude Code und finden Sie die richtige Seite für andere Probleme.
- [Konfiguration debuggen](https://code.claude.com/docs/de/debug-your-config.md): Diagnostizieren Sie, warum CLAUDE.md, Einstellungen, Hooks, MCP-Server oder Skills nicht wirksam werden. Verwenden Sie /context, /doctor, /hooks und /mcp, um zu sehen, was tatsächlich geladen wurde.
- [Fehlerreferenz](https://code.claude.com/docs/de/errors.md): Schlagen Sie Claude Code-Laufzeitfehlermeldungen nach und erfahren Sie, was jede bedeutet und wie Sie sie beheben.

### Plugins

#### Plugins

- [Plugins-Übersicht](https://code.claude.com/docs/de/plugins/overview.md): Verstehen Sie, was ein Claude Code-Plugin ist, wann Sie eines statt einer eigenständigen Skill oder eines MCP-Servers benötigen, und welche Seite Sie lesen müssen, um eines zu installieren oder zu erstellen.

#### Plugins verwenden

- [Plugins installieren und verwalten](https://code.claude.com/docs/de/plugins/install.md): Installieren Sie Claude Code-Plugins aus einem Marketplace auf jeder Oberfläche, die Sie verwenden, wählen Sie einen Installationsbereich aus, und aktualisieren oder entfernen Sie sie später.
- [Code-Intelligence-Plugins](https://code.claude.com/docs/de/plugins/code-intelligence.md): Installieren Sie ein Language-Server-Plugin, damit Claude nach Änderungen Typfehler sieht und Code nach Symbol navigiert, und beantworten Sie den LSP-Plugin-Empfehlungsdialog.
- [Plugin-Sicherheit und Vertrauen](https://code.claude.com/docs/de/plugins/security.md): Entscheiden Sie, ob Sie einem Plugin vertrauen, bevor Sie es installieren – von dem, was ein Plugin auf Ihrem Computer tun kann, bis hin zu dessen Überprüfung und Deinstallation.

#### Plugins erstellen

- [Erstellen Sie ein Claude Code-Plugin](https://code.claude.com/docs/de/plugins/create.md): Erstellen Sie Ihr erstes Claude Code-Plugin aus einem leeren Verzeichnis, testen Sie es ohne einen Marketplace und konvertieren Sie ein vorhandenes .claude/-Setup.
- [Komponenten zu einem Plugin hinzufügen](https://code.claude.com/docs/de/plugins/components.md): Fügen Sie Skills, Hooks, MCP-Server und alle anderen Komponententypen zu einem Claude Code-Plugin hinzu, mit einem Beispiel, das für jeden validiert.
- [Plugin-Abhängigkeiten](https://code.claude.com/docs/de/plugins/dependencies.md): Deklarieren Sie die Plugins, von denen Ihr Plugin abhängt, mit Versionsbereichen wie ^1.2, und erfahren Sie, wie Claude Code diese installiert, auflöst und bereinigt.
- [Plugins mit Evals testen](https://code.claude.com/docs/de/plugin-evals.md): Schreiben Sie Eval-Fälle für Ihr Claude Code Plugin, führen Sie sie mit claude plugin eval aus, bewerten Sie die Ergebnisse, vergleichen Sie sie mit einer Baseline ohne Plugin und gaten Sie CI basierend auf dem Score.
- [Ein Plugin veröffentlichen und verteilen](https://code.claude.com/docs/de/plugins/publish.md): Veröffentlichen Sie ein Claude Code Plugin über Ihren eigenen Marketplace oder Anthropics Community Marketplace, mit einer Pre-Release-Checkliste und wie Benutzer Updates erhalten.
- [Kosten und Nutzung von Plugins messen](https://code.claude.com/docs/de/plugins/measure.md): Messen Sie die Token-Kosten eines Claude Code-Plugins, finden Sie heraus, ob es noch verwendet wird, und wählen Sie die Telemetrie-Events für organisationsweite Plugin-Fragen aus.
- [Empfehlen Sie Ihr Plugin über Ihre CLI](https://code.claude.com/docs/de/plugins/cli-hints.md): Fordern Sie Claude Code-Benutzer auf, Ihr offizielles Marketplace-Plugin zu installieren, indem Sie ein claude-code-hint-Tag von Ihrer CLI oder SDK ausgeben.

#### Marketplace ausführen

- [Einen Marketplace erstellen](https://code.claude.com/docs/de/plugins/create-marketplace.md): Erstellen Sie einen Plugin-Marketplace aus einer marketplace.json-Datei und testen Sie ihn lokal, bevor Sie ihn hosten.
- [Ein Marketplace hosten und verwalten](https://code.claude.com/docs/de/plugins/host-marketplace.md): Veröffentlichen Sie einen Plugin-Marketplace, auf den Benutzer zugreifen können, gewähren Sie Zugriff auf einen privaten Marketplace, und geben Sie Updates und Umbenennungen frei, ohne Installationen zu unterbrechen.
- [Plugins für Ihre Organisation empfehlen](https://code.claude.com/docs/de/plugins/relevance.md): Fügen Sie einen Relevanzblock zu Marketplace-Plugin-Einträgen hinzu, damit Claude Code diese vorschlägt, wenn die Arbeit eines Benutzers übereinstimmt, und erlauben Sie den Marketplace in verwalteten Einstellungen.

#### Plugins für Ihre Organisation verwalten

- [Verwalten Sie Claude Code-Plugins für Ihre Organisation](https://code.claude.com/docs/de/plugins/org.md): Kontrollieren Sie, welche Plugins Claude Code auf jedem Computer in Ihrer Organisation installiert und zulässt, durch verwaltete Einstellungen.

#### Fehlerbehebung

- [Plugins fehlerbeheben](https://code.claude.com/docs/de/plugins/troubleshooting.md): Beheben Sie Plugin-Fehler in Claude Code. Finden Sie die genaue Meldung, die Sie gesehen haben, gruppiert nach Phase von der Ausführung von /plugin über die Installation bis zur Organisationsrichtlinie.

#### Referenz

- [Plugin-Manifest-Referenz](https://code.claude.com/docs/de/plugins/manifest-reference.md): Vollständige Referenz für plugin.json: jedes Feld mit seinem Typ und Standard, akzeptierte Pfadformen und die userConfig- und Umgebungsvariablenschemas.
- [Marketplace-Referenz](https://code.claude.com/docs/de/plugins/marketplace-reference.md): Vollständige Referenz für marketplace.json-Felder, Plugin-Einträge und die Plugin- und Marketplace-Quellobjekte mit Angabe ihrer Gültigkeitsbereiche.

### Verwaltung

#### Einrichtung und Zugriff

- [Claude Code für Ihre Organisation einrichten](https://code.claude.com/docs/de/admin-setup.md): Eine Entscheidungskarte für Administratoren, die Claude Code bereitstellen, mit Abdeckung von API-Anbietern, verwalteten Einstellungen, Richtliniendurchsetzung, Nutzungsüberwachung und Datenbehandlung.
- [Erweiterte Einrichtung](https://code.claude.com/docs/de/setup.md): Systemanforderungen, plattformspezifische Installation, Versionsverwaltung und Deinstallation für Claude Code.
- [Authentifizierung](https://code.claude.com/docs/de/authentication.md): Melden Sie sich bei Claude Code an und konfigurieren Sie die Authentifizierung für Einzelpersonen, Teams und Organisationen.
- [Verwaltete Einstellungen bereitstellen](https://code.claude.com/docs/de/managed-settings.md): Stellen Sie verwaltete Einstellungen auf jedem Entwicklerrechner bereit: Bereitstellungsmechanismen pro Betriebssystem, wie Claude Code verwaltete Quellen kombiniert und wie Sie die Durchsetzung überprüfen.
- [Serververwaltete Einstellungen konfigurieren](https://code.claude.com/docs/de/server-managed-settings.md): Konfigurieren Sie Claude Code zentral für Ihre Organisation durch serververwaltete Einstellungen, ohne dass eine Geräteverwaltungsinfrastruktur erforderlich ist.
- [Kontrollieren Sie den MCP-Serverzugriff für Ihre Organisation](https://code.claude.com/docs/de/managed-mcp.md): Beschränken Sie, welche MCP-Server Benutzer hinzufügen oder verbinden können, oder stellen Sie Server für jeden Benutzer bereit, mit verwalteten Konfigurationsdateien, verwalteten Einstellungen, Zulassungslisten und Ablehnungslisten.
- [Auto-Modus konfigurieren](https://code.claude.com/docs/de/auto-mode-config.md): Teilen Sie dem Auto-Modus-Klassifizierer mit, welche Repos, Buckets und Domains Ihre Organisation vertraut. Legen Sie den Umgebungskontext fest, überschreiben Sie die Standard-Block- und Allow-Regeln, und überprüfen Sie Ihre effektive Konfiguration mit den Auto-Modus-CLI-Unterbefehlen.

#### Bereitstellung

- [Übersicht zur Enterprise-Bereitstellung](https://code.claude.com/docs/de/third-party-integrations.md): Erfahren Sie, wie Claude Code mit verschiedenen Drittanbieterdiensten und Infrastrukturen integriert werden kann, um Enterprise-Bereitstellungsanforderungen zu erfüllen.
- [Verfügbarkeit von Funktionen](https://code.claude.com/docs/de/feature-availability.md): Vergleichen Sie, welche Claude Code-Funktionen in Anthropic-Abonnementplänen, der Anthropic Console, Amazon Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform und Microsoft Foundry verfügbar sind.
- [Claude Code auf Amazon Bedrock](https://code.claude.com/docs/de/amazon-bedrock.md): Erfahren Sie, wie Sie Claude Code über Amazon Bedrock konfigurieren, einschließlich Setup, IAM-Konfiguration und Fehlerbehebung.
- [Claude Code auf Claude Platform on AWS](https://code.claude.com/docs/de/claude-platform-on-aws.md): Konfigurieren Sie Claude Code für die Verwendung der von Anthropic betriebenen Claude API mit AWS-Authentifizierung, IAM-Zugriffskontrolle und AWS Marketplace-Abrechnung.
- [Claude Code auf Google Clouds Agent Platform](https://code.claude.com/docs/de/google-vertex-ai.md): Erfahren Sie, wie Sie Claude Code über Google Clouds Agent Platform konfigurieren, ehemals Vertex AI, einschließlich Setup, IAM-Konfiguration und Fehlerbehebung.
- [Claude Code auf Microsoft Foundry](https://code.claude.com/docs/de/microsoft-foundry.md): Erfahren Sie, wie Sie Claude Code über Microsoft Foundry konfigurieren, einschließlich Setup, Konfiguration und Fehlerbehebung.
- [Enterprise-Netzwerkkonfiguration](https://code.claude.com/docs/de/network-config.md): Konfigurieren Sie Claude Code für Enterprise-Umgebungen mit Proxy-Servern, benutzerdefinierten Zertifizierungsstellen (CA) und gegenseitiger Transport Layer Security (mTLS)-Authentifizierung.
- [Claude Code hinter einem Corporate Launcher ausführen](https://code.claude.com/docs/de/corporate-launcher.md): Leiten Sie die Prozesse, die Claude Code von seiner eigenen Binärdatei aus startet, einschließlich des Hintergrunddienstes und jeder Agent-View-Sitzung, durch einen erforderlichen Launcher mit CLAUDE_CODE_PROCESS_WRAPPER oder der processWrapper-Einstellung.
- [Entwicklungscontainer](https://code.claude.com/docs/de/devcontainer.md): Führen Sie Claude Code in einem Entwicklungscontainer aus, um konsistente, isolierte Umgebungen für Ihr Team zu schaffen.

#### Gateways

- [Claude Code über ein Gateway ausführen](https://code.claude.com/docs/de/gateways.md): Leiten Sie Claude Code über ein selbstgehostetes Gateway für zentralisierte Anmeldedaten, Nutzungsverfolgung und Kostenkontrolle weiter. Behandelt die Architektur, Anthropics Claude-Apps-Gateway und die Verwendung anderer Gateway-Produkte.

##### Claude Apps Gateway

- [Claude-Apps-Gateway für Amazon Bedrock, Claude Platform auf AWS, Google Cloud und Microsoft Foundry](https://code.claude.com/docs/de/claude-apps-gateway.md): Führen Sie Claude Code über Amazon Bedrock, Claude Platform auf AWS, Google Cloud oder Microsoft Foundry hinter einem selbstgehosteten Gateway mit SSO-Anmeldung, Modellzugriff pro Gruppe und OTLP-Telemetrie aus.
- [Claude Apps Gateway-Konfiguration](https://code.claude.com/docs/de/claude-apps-gateway-config.md): Referenz für jede gateway.yaml-Option: Listener und TLS, OIDC, Session, Postgres-Speicher, Amazon Bedrock, Claude Platform auf AWS, Google Cloud's Agent Platform und Microsoft Foundry-Upstreams, Modellrouting, verwaltete Richtlinien und Telemetrie.
- [Ausgabenlimits für Claude-Apps-Gateway](https://code.claude.com/docs/de/claude-apps-gateway-spend-limits.md): Begrenzen Sie die Ausgaben jedes Entwicklers über das Claude-Apps-Gateway pro Tag, Woche oder Monat. Legen Sie Limits mit einer Admin-API fest und das Gateway erzwingt sie live bei jeder Anfrage.
- [Bereitstellung und Betrieb des Claude-Apps-Gateways](https://code.claude.com/docs/de/claude-apps-gateway-deploy.md): Registrieren Sie das Gateway bei Ihrem IdP, erstellen Sie den Container, stellen Sie ihn auf Kubernetes oder Cloud Run bereit, und betreiben Sie ihn: Integritätsprüfungen, Geheimnisrotation, Upgrades und Sicherheit.
- [Claude-Apps-Gateway auf AWS bereitstellen](https://code.claude.com/docs/de/claude-apps-gateway-on-aws.md): Ein praktisches Beispiel für die Ausführung von Claude-Apps-Gateway auf AWS: ECS Fargate oder EKS, Amazon RDS für PostgreSQL, AWS Secrets Manager und IAM-rollenbasierte Authentifizierung bei Amazon Bedrock.
- [Claude-Apps-Gateway auf Google Cloud bereitstellen](https://code.claude.com/docs/de/claude-apps-gateway-on-gcp.md): Ein praktisches Beispiel für die Ausführung von Claude-Apps-Gateway auf Google Cloud: Cloud Run oder GKE, Cloud SQL für PostgreSQL, Secret Manager und Service-Account-Authentifizierung für Google Clouds Agent Platform.

##### Andere Gateways

- [Andere LLM-Gateways](https://code.claude.com/docs/de/llm-gateway.md): Leiten Sie Claude Code über ein LLM-Gateway weiter, das Ihre Organisation bereits betreibt. Behandelt die Verbindung von Claude Code mit einem Gateway, die Bereitstellung für Ihre Organisation und was Claude Code an ein Gateway sendet.
- [Claude Code mit einem LLM-Gateway verbinden](https://code.claude.com/docs/de/llm-gateway-connect.md): Richten Sie Claude Code auf das LLM-Gateway Ihrer Organisation aus. Überprüfen Sie, ob Ihr Administrator es bereits konfiguriert hat, oder legen Sie die Basis-URL und die Anmeldedaten selbst fest, überprüfen Sie dann die Verbindung und beheben Sie Gateway-Fehler.
- [Stellen Sie ein LLM-Gateway für Ihre Organisation bereit](https://code.claude.com/docs/de/llm-gateway-rollout.md): Stellen Sie ein Gateway-Produkt für Claude Code bereit: Konfigurieren Sie es so, dass es das weiterleitet, was Claude Code sendet, geben Sie Entwickleranmeldedaten aus, verteilen Sie die Konfiguration über verwaltete Einstellungen, und überprüfen Sie den Rollout.
- [Claude Code Gateway-Kompatibilitätsleitfaden](https://code.claude.com/docs/de/llm-gateway-protocol.md): Halten Sie ein LLM-Gateway mit Claude Code kompatibel: die Endpunkte, die es aufruft, die Header und Body-Felder, die weitergeleitet werden müssen, und was bricht, wenn sie entfernt werden.

#### Nutzung und Kosten

- [Überwachung](https://code.claude.com/docs/de/monitoring-usage.md): Erfahren Sie, wie Sie OpenTelemetry für Claude Code aktivieren und konfigurieren.
- [Kosten effektiv verwalten](https://code.claude.com/docs/de/costs.md): Verfolgen Sie die Token-Nutzung, legen Sie Ausgabenlimits für Teams fest und reduzieren Sie Claude Code-Kosten durch Kontextverwaltung, Modellauswahl, Einstellungen für erweitertes Denken und Preprocessing-Hooks.
- [Teamnutzung mit Analysen verfolgen](https://code.claude.com/docs/de/analytics.md): Zeigen Sie Claude Code-Nutzungsmetriken an, verfolgen Sie die Einführung und messen Sie die Engineering-Geschwindigkeit im Analytics-Dashboard.

#### Sicherheit und Daten

- [Sicherheit](https://code.claude.com/docs/de/security.md): Erfahren Sie mehr über die Sicherheitsvorkehrungen von Claude Code und Best Practices für sichere Nutzung.
- [Datennutzung](https://code.claude.com/docs/de/data-usage.md): Erfahren Sie mehr über die Datennutzungsrichtlinien von Anthropic für Claude
- [Null-Datenspeicherung](https://code.claude.com/docs/de/zero-data-retention.md): Erfahren Sie mehr über Null-Datenspeicherung (ZDR) für Claude Code, verfügbar für qualifizierte Konten auf Claude for Enterprise, einschließlich Umfang, deaktivierter Funktionen und wie Sie die Aktivierung anfordern.

#### Einführung

- [Kommunikations-Kit](https://code.claude.com/docs/de/communications-kit.md): Startankündigungen, Drip-Campaign-Nachrichten und FAQ-Antworten für die Einführung von Claude Code in Ihrer Entwicklungsorganisation.
- [Champion-Kit](https://code.claude.com/docs/de/champion-kit.md): Ein Leitfaden für Ingenieure, die Claude Code intern fördern: was man teilen sollte, wie man Fragen beantwortet und wie man die Akzeptanz im Team erhöht.

### Konfiguration

#### Einstellungen

- [Einstellungsdateien und Priorität](https://code.claude.com/docs/de/settings.md): Ändern Sie Claude Code-Einstellungen, wählen Sie den Bereich aus, zu dem ein Schlüssel gehört, überprüfen Sie die Änderung, und erfahren Sie, welchen Wert Claude Code verwendet, wenn ein Schlüssel an mehreren Stellen gesetzt ist.
- [Alle Einstellungen](https://code.claude.com/docs/de/settings-reference.md): Vollständige Referenz für jeden Claude Code settings.json-Schlüssel: wo jeder hingehört, sein Typ und Standard, sowie ein einsatzbereites Beispiel, mit einem Index aller Schlüssel.
- [Beispiel-Einstellungsdateien](https://code.claude.com/docs/de/settings-example.md): Realistische settings.json-Dateien für einen Entwickler, ein Team und eine Organisation: Kopieren Sie eine, behalten Sie die gewünschten Schlüssel und ändern Sie die Werte.

#### Berechtigungen und Sandboxing

- [Berechtigungen konfigurieren](https://code.claude.com/docs/de/permissions.md): Kontrollieren Sie, worauf Claude Code zugreifen kann und was es mit granularen Berechtigungsregeln, Modi und verwalteten Richtlinien tun kann.
- [Wählen Sie einen Berechtigungsmodus](https://code.claude.com/docs/de/permission-modes.md): Steuern Sie, ob Claude vor dem Bearbeiten von Dateien oder dem Ausführen von Befehlen fragt. Wechseln Sie Modi mit Shift+Tab in der CLI, dem Modusindikator in VS Code oder dem Moduswahlschalter in Desktop.
- [Konfigurieren Sie das Sandboxed-Bash-Tool](https://code.claude.com/docs/de/sandboxing.md): Erfahren Sie, wie das Sandboxed-Bash-Tool von Claude Code Dateisystem- und Netzwerkisolation für sicherere und autonomere Agent-Ausführung bietet.
- [Wählen Sie eine Sandbox-Umgebung](https://code.claude.com/docs/de/sandbox-environments.md): Vergleichen Sie Claude Code Sandbox-Optionen: das integrierte Bash-Tool mit Sandbox, Sandbox-Runtime, Dev Container, Docker und VMs. Wählen Sie die richtige Isolation für Ihr Bedrohungsmodell.

#### Umgebungen

- [Cloud-Umgebungen konfigurieren](https://code.claude.com/docs/de/cloud-environments.md): Konfigurieren Sie Cloud-Umgebungen für Claude Code Cloud-Sitzungen: Netzwerkzugriffsstufen, Umgebungsvariablen, Setup-Skripte und Umgebungs-Caching.

##### Selbst gehostete Umgebungen

- [Selbst gehostete Umgebungen](https://code.claude.com/docs/de/self-hosted-environments.md): Führen Sie Claude Code Cloud-Sitzungen auf einer Infrastruktur aus, die Sie kontrollieren: Richten Sie eine selbst gehostete Umgebung ein, stellen Sie Runner bereit und leiten Sie Sitzungen zu Ihrem eigenen Compute weiter.
- [Schnellstart für selbstgehostete Umgebungen](https://code.claude.com/docs/de/self-hosted-environments-quickstart.md): Richten Sie Ihre erste selbstgehostete Umgebung ein: Installieren Sie Claude Code, erstellen Sie die Umgebung, starten Sie einen Runner und leiten Sie eine Sitzung dorthin weiter.
- [Selbstgehostete Umgebungen in der Produktion bereitstellen](https://code.claude.com/docs/de/self-hosted-environments-deploy.md): Führen Sie selbstgehostete Runner in der Produktion aus: Sicherheitshärtung, Netzwerk-Egress-Kontrolle, Git-Anmeldedaten, Kubernetes- und Compose-Rezepte und Fehlerbehebung.
- [Sitzungen in selbstgehosteten Umgebungen anpassen](https://code.claude.com/docs/de/self-hosted-environments-configuration.md): Passen Sie selbstgehostete Umgebungssitzungen mit Wrapper-Skripten für Anmeldedaten pro Sitzung, Lifecycle-Hooks und On-Demand-Runner-Spawning an.
- [Self-Hosted-Umgebungen end-to-end testen](https://code.claude.com/docs/de/self-hosted-environments-testing.md): Überprüfen Sie ein selbstgehostetes Runner-Image aus CI: Starten Sie eine Sitzung mit der CLI, lesen Sie Claudes Antworten über einen Stop-Hook und schreiben Sie die vollständige Schleife.
- [Referenz für selbstgehostete Umgebungen](https://code.claude.com/docs/de/self-hosted-environments-reference.md): Vollständige Referenz für den selbstgehosteten Runner und Orchestrator: CLI-Flags, Umgebungsvariablen und Prometheus-Metriken.
- [Sitzungsidentität in selbstgehosteten Umgebungen überprüfen](https://code.claude.com/docs/de/self-hosted-environments-identity.md): Überprüfen Sie das CLAUDE_CODE_SESSION_ACCESS_TOKEN JWT, damit Dienste in Ihrem Netzwerk Anfragen von Sitzungen in Ihrer selbstgehosteten Umgebung vertrauen können.

#### Modell und Antworten

- [Modellkonfiguration](https://code.claude.com/docs/de/model-config.md): Konfigurieren Sie, welches Modell Claude Code verwendet, Aufwandsstufen, erweiterten Kontext und das Auto-Compact-Fenster
- [Beschleunigen Sie Antworten mit dem Schnellmodus](https://code.claude.com/docs/de/fast-mode.md): Erhalten Sie schnellere Opus-Antworten in Claude Code durch Aktivierung des Schnellmodus.
- [Schwierige Entscheidungen mit dem Advisor-Tool eskalieren](https://code.claude.com/docs/de/advisor.md): Kombinieren Sie Ihr Hauptmodell mit einem stärkeren Advisor-Modell, das Claude an wichtigen Momenten während einer Aufgabe konsultiert.
- [Ausgabestile](https://code.claude.com/docs/de/output-styles.md): Ändern Sie Claudes Rolle, Ton und Antwortformat mit einem integrierten Ausgabestil wie „Prägnant" oder „Erklärend", oder schreiben Sie einen benutzerdefinierten Stil.

#### Benutzeroberfläche

- [Konfigurieren Sie Ihr Terminal für Claude Code](https://code.claude.com/docs/de/terminal-config.md): Beheben Sie Shift+Enter für Zeilenumbrüche, erhalten Sie einen Terminal-Gong, wenn Claude fertig ist, konfigurieren Sie tmux, passen Sie das Farbschema an, und aktivieren Sie den Vim-Modus in der Claude Code CLI.
- [Vollbildrendering](https://code.claude.com/docs/de/fullscreen.md): Aktivieren Sie einen sanfteren, flimmerfreien Rendering-Modus mit Mausunterstützung und stabiler Speichernutzung in langen Gesprächen.
- [Claude Code mit einem Bildschirmleser verwenden](https://code.claude.com/docs/de/accessibility.md): Richten Sie Claude Code für Bildschirmleser wie VoiceOver und NVDA ein, sowie Einstellungen für Bildschirmlupe, reduzierte Bewegung und farbenblindfreundliche Designs.
- [Spracherfassung](https://code.claude.com/docs/de/voice-dictation.md): Sprechen Sie Ihre Eingabeaufforderungen in der Claude Code CLI mit Halten-zum-Aufnehmen oder Tippen-zum-Aufnehmen Spracherfassung.
- [Passen Sie Ihre Statuszeile an](https://code.claude.com/docs/de/statusline.md): Konfigurieren Sie eine benutzerdefinierte Statusleiste zur Überwachung der Kontextfensternutzung, Kosten und Git-Status in Claude Code
- [Tastaturkürzel anpassen](https://code.claude.com/docs/de/keybindings.md): Passen Sie Tastaturkürzel in Claude Code mit einer Keybindings-Konfigurationsdatei an.

### Referenz

#### Referenz

- [CLI-Referenz](https://code.claude.com/docs/de/cli-reference.md): Vollständige Referenz für die Claude Code Befehlszeilenschnittstelle, einschließlich Befehle und Flags.
- [Befehle](https://code.claude.com/docs/de/commands.md): Vollständige Referenz für Befehle in Claude Code, einschließlich integrierter Befehle und gebündelter Skills.
- [Umgebungsvariablen](https://code.claude.com/docs/de/env-vars.md): Referenz für Umgebungsvariablen, die das Verhalten von Claude Code steuern.
- [Tools-Referenz](https://code.claude.com/docs/de/tools-reference.md): Vollständige Referenz für die Tools, die Claude Code verwenden kann, einschließlich Berechtigungsanforderungen und Verhalten pro Tool.
- [Interaktiver Modus](https://code.claude.com/docs/de/interactive-mode.md): Vollständige Referenz für Tastaturkürzel, Eingabemodi und interaktive Funktionen in Claude Code-Sitzungen.
- [Checkpointing](https://code.claude.com/docs/de/checkpointing.md): Verfolgen, zurückspulen und fassen Sie Claudes Bearbeitungen und Konversation zusammen, um den Sitzungsstatus zu verwalten.
- [Hooks-Referenz](https://code.claude.com/docs/de/hooks.md): Referenz für Claude Code Hook-Ereignisse, Konfigurationsschema, JSON-Ein-/Ausgabeformate, Exit-Codes, asynchrone Hooks, HTTP-Hooks, Prompt-Hooks und MCP-Tool-Hooks.
- [Channels-Referenz](https://code.claude.com/docs/de/channels-reference.md): Erstellen Sie einen MCP-Server, der Webhooks, Benachrichtigungen und Chat-Nachrichten in eine Claude Code-Sitzung pusht. Referenz für den Channel-Vertrag: Funktionsdeklaration, Benachrichtigungsereignisse, Antwort-Tools, Sender-Gating und Berechtigungsweitergabe.

#### Glossar

- [Glossar](https://code.claude.com/docs/de/glossary.md): Definitionen für Claude Code-Terminologie. Erfahren Sie, was Agentic Loop, Komprimierung, CLAUDE.md, Hooks, Subagenten, MCP und andere Kernkonzepte bedeuten.

### Agent SDK

#### Agent SDK

- [Agent SDK – Übersicht](https://code.claude.com/docs/de/agent-sdk/overview.md): Erstellen Sie produktive KI-Agenten mit Claude Code als Bibliothek
- [Schnellstart](https://code.claude.com/docs/de/agent-sdk/quickstart.md): Erste Schritte mit dem Python- oder TypeScript-Agent-SDK zum Erstellen von KI-Agenten, die autonom funktionieren
- [Migrieren zum Claude Agent SDK](https://code.claude.com/docs/de/agent-sdk/migration-guide.md): Leitfaden für die Migration der Claude Code TypeScript- und Python-SDKs zum Claude Agent SDK
- [Fehlerbehebung im Agent SDK](https://code.claude.com/docs/de/agent-sdk/troubleshooting.md): Beheben Sie Agent SDK-Fehler, wenn die Claude Code CLI nicht startet, der CLI-Prozess beendet wird oder ein erfolgreiches Ergebnis ohne strukturierte Ausgabe ankommt.

#### Agenten erstellen

- [Konfigurieren Sie Ihren Agent](https://code.claude.com/docs/de/agent-sdk/configuration.md): Konfigurieren Sie Agent SDK-Sitzungen: stellen Sie das Optionsobjekt zusammen, legen Sie das Modell, die Umgebung und Limits fest, und finden Sie die Seite jeder Funktionsoption.
- [Beispiele](https://code.claude.com/docs/de/agent-sdk/examples.md): Finden Sie ein vollständiges, ausführbares Agent SDK-Projekt oder ein geführtes Rezept aus dem Claude Cookbook, das zu dem passt, was Sie erstellen möchten.

#### Kernkonzepte

- [So funktioniert die Agent-Schleife](https://code.claude.com/docs/de/agent-sdk/agent-loop.md): Verstehen Sie den Nachrichtenlebenszyklus, die Werkzeugausführung, das Kontextfenster und die Architektur, die Ihre SDK-Agenten antreibt.
- [Claude Code-Funktionen im SDK verwenden](https://code.claude.com/docs/de/agent-sdk/claude-code-features.md): Laden Sie Projektanweisungen, Skills, Hooks und andere Claude Code-Funktionen in Ihre SDK-Agenten.
- [Mit Sitzungen arbeiten](https://code.claude.com/docs/de/agent-sdk/sessions.md): Wie Sitzungen die Gesprächsverlauf des Agenten speichern, und wann Sie continue, resume und fork verwenden, um zu einem früheren Durchlauf zurückzukehren.
- [Sitzungen in externem Speicher persistieren](https://code.claude.com/docs/de/agent-sdk/session-storage.md): Spiegeln Sie Agent SDK-Sitzungstranskripte in Ihren eigenen Objektspeicher, Key-Value-Store oder Ihre Datenbank, damit andere Hosts Ihre Sitzungen fortsetzen können.

#### Eingabe und Ausgabe

- [Streaming-Eingabe](https://code.claude.com/docs/de/agent-sdk/streaming-vs-single-mode.md): Verständnis der zwei Eingabemodi für Claude Agent SDK und wann jeder verwendet wird
- [Genehmigungen und Benutzereingaben verarbeiten](https://code.claude.com/docs/de/agent-sdk/user-input.md): Zeigen Sie Claudes Genehmigungsanfragen und Klärungsfragen den Benutzern an und geben Sie deren Entscheidungen an das SDK zurück.
- [Antworten in Echtzeit streamen](https://code.claude.com/docs/de/agent-sdk/streaming-output.md): Erhalten Sie Echtzeit-Antworten vom Agent SDK, während Text und Tool-Aufrufe gestreamt werden
- [Strukturierte Ausgaben von Agenten abrufen](https://code.claude.com/docs/de/agent-sdk/structured-outputs.md): Validiertes JSON aus Agent-Workflows mit JSON Schema, Zod oder Pydantic zurückgeben. Erhalten Sie typsichere, strukturierte Daten nach Multi-Turn-Tool-Nutzung.

#### Mit Tools erweitern

- [Geben Sie Claude benutzerdefinierte Tools](https://code.claude.com/docs/de/agent-sdk/custom-tools.md): Definieren Sie benutzerdefinierte Tools mit dem In-Process-MCP-Server des Claude Agent SDK, damit Claude Ihre Funktionen aufrufen, Ihre APIs treffen und domänenspezifische Operationen ausführen kann.
- [Mit MCP zu externen Tools verbinden](https://code.claude.com/docs/de/agent-sdk/mcp.md): Konfigurieren Sie MCP-Server, um Ihren Agenten mit externen Tools zu erweitern. Behandelt Transporttypen, Tool-Suche für große Tool-Sets, Authentifizierung und Fehlerbehandlung.
- [Mit Tool-Suche zu vielen Tools skalieren](https://code.claude.com/docs/de/agent-sdk/tool-search.md): Skalieren Sie Ihren Agenten auf Tausende von Tools, indem Sie nur das Nötigste entdecken und bei Bedarf laden.
- [Subagents im SDK](https://code.claude.com/docs/de/agent-sdk/subagents.md): Definieren und rufen Sie Subagents auf, um den Kontext zu isolieren, Aufgaben parallel auszuführen und spezialisierte Anweisungen in Ihren Claude Agent SDK-Anwendungen anzuwenden.

#### Verhalten anpassen

- [Ändern von Systemaufforderungen](https://code.claude.com/docs/de/agent-sdk/modifying-system-prompts.md): Wählen Sie zwischen der `claude_code`-Voreinstellung und einer benutzerdefinierten Systemaufforderung, und passen Sie das Verhalten mit CLAUDE.md, Ausgabestilen, Append oder einer vollständig benutzerdefinierten Aufforderung an.
- [Agent Skills erweitern](https://code.claude.com/docs/de/agent-sdk/skills.md): Steuern Sie, welche Skills Claude in Claude Agent SDK-Sitzungen aufrufen kann, versenden Sie Befehle nach Name und erstellen Sie Skills, die Ihre Sitzungen entdecken
- [Plugins im SDK](https://code.claude.com/docs/de/agent-sdk/plugins.md): Laden Sie benutzerdefinierte Plugins, um Claude Code mit Skills, Agenten, Hooks und MCP-Servern über das Agent SDK zu erweitern

#### Kontrolle und Beobachtbarkeit

- [Berechtigungen konfigurieren](https://code.claude.com/docs/de/agent-sdk/permissions.md): Kontrollieren Sie, wie Ihr Agent Tools mit Berechtigungsmodi, Hooks und deklarativen Allow/Deny-Regeln verwendet.
- [Agentverhalten mit Hooks abfangen und steuern](https://code.claude.com/docs/de/agent-sdk/hooks.md): Fangen Sie Agentverhalten an wichtigen Ausführungspunkten mit Hooks ab und passen Sie es an
- [Dateiänderungen mit Checkpointing rückgängig machen](https://code.claude.com/docs/de/agent-sdk/file-checkpointing.md): Verfolgen Sie Dateiänderungen während Agent-Sitzungen und stellen Sie Dateien in jeden vorherigen Zustand wieder her
- [Kosten und Nutzung verfolgen](https://code.claude.com/docs/de/agent-sdk/cost-tracking.md): Erfahren Sie, wie Sie die Token-Nutzung verfolgen, Kosten schätzen und Prompt Caching mit dem Claude Agent SDK konfigurieren.
- [Observabilität mit OpenTelemetry](https://code.claude.com/docs/de/agent-sdk/observability.md): Exportieren Sie Traces, Metriken und Events aus dem Agent SDK in Ihr Observability-Backend mit OpenTelemetry.
- [Todos verfolgen](https://code.claude.com/docs/de/agent-sdk/todo-tracking.md): Verfolgen Sie Todos in Agent SDK-Sitzungen und rendern Sie Claudes Fortschritt in Ihrer Anwendung aus strukturierten Tool-Aufrufen

#### Bereitstellung

- [Hosting des Agent SDK](https://code.claude.com/docs/de/agent-sdk/hosting.md): Stellen Sie das Agent SDK in der Produktion bereit: Subprocess-Architektur, Sitzungspersistenz, Skalierung, Observability und Multi-Tenant-Isolation für Docker, Kubernetes und Sandbox-Provider.
- [Sichere Bereitstellung von KI-Agenten](https://code.claude.com/docs/de/agent-sdk/secure-deployment.md): Ein Leitfaden zur Sicherung von Claude Code und Agent SDK-Bereitstellungen mit Isolation, Verwaltung von Anmeldedaten und Netzwerkkontrollen

#### SDK-Referenzen

- [Agent SDK Referenz - TypeScript](https://code.claude.com/docs/de/agent-sdk/typescript.md): Vollständige API-Referenz für das TypeScript Agent SDK, einschließlich aller Funktionen, Typen und Schnittstellen.
- [TypeScript SDK V2 Sitzungs-API (entfernt)](https://code.claude.com/docs/de/agent-sdk/typescript-v2-preview.md): Referenz für die entfernte V2 TypeScript Agent SDK Sitzungs-API mit sitzungsbasiertem Send/Stream-Muster für mehrteilige Gespräche.
- [Agent SDK Referenz - Python](https://code.claude.com/docs/de/agent-sdk/python.md): Vollständige API-Referenz für das Python Agent SDK, einschließlich aller Funktionen, Typen und Klassen.

### Neuigkeiten

#### Neuigkeiten

- [Neuigkeiten](https://code.claude.com/docs/de/whats-new/index.md): Eine wöchentliche Zusammenfassung der bemerkenswertesten Claude Code-Funktionen mit Code-Snippets, Demos und Kontext, warum sie wichtig sind.
- [Woche 37 · 7.–11. September 2026](https://code.claude.com/docs/de/whats-new/2026-w37.md): Testen Sie Ihre Plugins mit claude plugin eval und öffnen Sie Claude Code Desktop-Bereiche in eigenen Fenstern.
- [Woche 36 · 31. August – 4. September 2026](https://code.claude.com/docs/de/whats-new/2026-w36.md): Wechseln Sie zu Claude Fable 5.1, lassen Sie die Computernutzung im Hintergrund auf dem Desktop laufen, und beobachten Sie Claudes Änderungen in einem Live-/diff-Panel.
- [Woche 35 · 24.–28. August 2026](https://code.claude.com/docs/de/whats-new/2026-w35.md): Setzen Sie Terminal-Sitzungen in der Claude Code Desktop-App fort, überprüfen Sie Feedback-Berichte, die Claude für Sie entwirft, und starten Sie eine Sitzung im eingeschränkten Modus.
- [Woche 34 · 17.–21. August 2026](https://code.claude.com/docs/de/whats-new/2026-w34.md): Entwerfen Sie bearbeitbare UI-Artboards mit dem /design-Skill, stellen Sie den Concise-Ausgabestil ein, und starten Sie eine Claude Code-Sitzung auf Ihrem Computer von Ihrem Telefon aus.
- [Woche 33 · 10.–14. August 2026](https://code.claude.com/docs/de/whats-new/2026-w33.md): Claude Code Desktop setzt sich nach dem Zurücksetzen eines Nutzungslimits automatisch fort, der Fork-Modus ist standardmäßig aktiviert, und GitLab-Merge-Requests und Marktplätze treten GitHub bei.
- [Woche 32 · 3.–7. August 2026](https://code.claude.com/docs/de/whats-new/2026-w32.md): Claude Code-Sitzungen können sich gegenseitig Nachrichten senden, selbstgehostete Umgebungen führen Cloud-Sitzungen auf Ihrer Infrastruktur aus, und der Auto-Modus wird zum Standard-Berechtigungsmodus.
- [Woche 30 · 20.–24. Juli 2026](https://code.claude.com/docs/de/whats-new/2026-w30.md): Opus 5 wird zum Standard-Opus-Modell, Claude Code Desktop erhält einen iOS-Simulator-Bereich, und das Claude-Sicherheits-Plugin scannt Ihren Code auf Sicherheitslücken.
- [Woche 29 · 13.–17. Juli 2026](https://code.claude.com/docs/de/whats-new/2026-w29.md): Rufen Sie Live-Daten in veröffentlichte Artefakte über MCP-Konnektoren auf, und verwenden Sie Claude Code mit einem Bildschirmleser im neuen Bildschirmleser-Modus.
- [Woche 28 · 6.–10. Juli 2026](https://code.claude.com/docs/de/whats-new/2026-w28.md): Durchsuchen Sie externe Websites über den integrierten Browser der Desktop-App, führen Sie eine vollständige Setup-Überprüfung mit /doctor durch, und nutzen Sie neue Transkriptschutzmaßnahmen im Auto-Modus sowie verbesserte Agent-View-Funktionen.
- [Woche 27 · 29. Juni – 3. Juli 2026](https://code.claude.com/docs/de/whats-new/2026-w27.md): Claude Sonnet 5 wird zum Standard-Modell, Claude in Chrome erreicht allgemeine Verfügbarkeit, Subagenten laufen standardmäßig im Hintergrund, Claude Desktop kommt in Beta auf Linux an, und /radio stimmt sich auf Claude FM ein.
- [Woche 26 · 22.–26. Juni 2026](https://code.claude.com/docs/de/whats-new/2026-w26.md): Authentifizieren Sie MCP-Server von Ihrer Shell mit claude mcp login, erhalten Sie eine Antwort auf die Ausgabe von Shell-Mode-Befehlen mit dem !-Präfix, und setzen Sie ein Gespräch vor /clear mit /rewind fort.
- [Woche 25 · 15.–19. Juni 2026](https://code.claude.com/docs/de/whats-new/2026-w25.md): Veröffentlichen Sie eine Live-Seite, die Sie freigeben können, aus Ihrer Sitzung mit Artifacts, gleichen Sie Tool-Parameter in Deny- und Ask-Regeln ab, und legen Sie jede Einstellung über die Eingabeaufforderung mit /config fest.
- [Woche 24 · 8.–12. Juni 2026](https://code.claude.com/docs/de/whats-new/2026-w24.md): Verschieben Sie eine Sitzung mit /cd in ein neues Verzeichnis, lassen Sie Sub-Agenten ihre eigenen Sub-Agenten spawnen, und beheben Sie eine fehlerhafte Konfiguration mit dem abgesicherten Modus.
- [Woche 23 · 1.–5. Juni 2026](https://code.claude.com/docs/de/whats-new/2026-w23.md): Führen Sie den Auto-Modus auf Amazon Bedrock, Google Cloud's Agent Platform und Microsoft Foundry aus, fordern Sie vor dem Schreiben von Dateien auf, die Code im acceptEdits-Modus ausführen können, listen Sie installierte Plugins mit /plugin list auf, und erfordern Sie einen genehmigten Versionsbere…
- [Woche 22 · 25.–29. Mai 2026](https://code.claude.com/docs/de/whats-new/2026-w22.md): Führen Sie Claude Code auf Claude Opus 4.8 aus, orchestrieren Sie große Aufgaben mit dynamischen Workflows, fangen Sie Sicherheitsprobleme mit dem security-guidance-Plugin auf und nutzen Sie den schnellen Modus auf Opus 4.8 zu einem niedrigeren Preis.
- [Woche 21 · 18.–22. Mai 2026](https://code.claude.com/docs/de/whats-new/2026-w21.md): Nutzen Sie den Auto-Modus im Pro-Plan mit Sonnet 4.6, sehen Sie in /usage, welche Skills, Subagenten und MCP-Server Ihre Plan-Limits antreiben, und überprüfen Sie Unterschiede mit dem neuen /code-review-Befehl.
- [Woche 20 · 11.–15. Mai 2026](https://code.claude.com/docs/de/whats-new/2026-w20.md): Verwalten Sie jede Claude Code-Sitzung von einem Bildschirm aus mit der Agent-Ansicht, halten Sie Claude an der Verfolgung eines Ziels, bis eine Bedingung erfüllt ist, und führen Sie den Schnellmodus standardmäßig auf Opus 4.7 aus.
- [Woche 19 · 4.–8. Mai 2026](https://code.claude.com/docs/de/whats-new/2026-w19.md): Laden Sie Plugins aus .zip-Archiven und URLs, durchsuchen Sie den Befehlsverlauf über alle Projekte hinweg mit Strg+R, erstellen Sie neue Worktrees aus lokalem HEAD oder dem Remote-Standard, und blockieren Sie Aktionen bedingungslos mit Auto-Modus-Hard-Deny-Regeln.
- [Woche 18 · 27. April – 1. Mai 2026](https://code.claude.com/docs/de/whats-new/2026-w18.md): Claude Code unter Windows läuft ohne Git Bash, claude auth login akzeptiert einen eingefügten OAuth-Code, wenn der Browser-Callback localhost nicht erreichen kann, claude project purge bereinigt den lokalen Status pro Projekt, und das Einfügen einer PR-URL in /resume findet die Sitzung, die sie erst…
- [Woche 17 · 20.–24. April 2026](https://code.claude.com/docs/de/whats-new/2026-w17.md): /ultrareview öffnet sich als Forschungsvorschau, automatische Sitzungsübersichten bei Rückkehr zu einem Terminal, benutzerdefinierte Farbthemen, die Sie in Plugins erstellen und bereitstellen können, und ein neu gestaltetes Claude Code im Web.
- [Woche 16 · 13.–17. April 2026](https://code.claude.com/docs/de/whats-new/2026-w16.md): Claude Opus 4.7 mit der neuen xhigh-Anstrengungsstufe, Routinen auf Claude Code im Web, mobile Push-Benachrichtigungen, die Ihr Telefon anpingen, wenn Claude Sie braucht, eine /usage-Aufschlüsselung, die zeigt, was Ihre Limits antreibt, und native Binärdateien ersetzen das gebündelte JavaScript.
- [Woche 15 · 6.–10. April 2026](https://code.claude.com/docs/de/whats-new/2026-w15.md): Ultraplan Cloud-Planung, das Monitor-Tool mit Selbststeuerung /loop, /team-onboarding zum Verpacken Ihres Setups und /autofix-pr von Ihrem Terminal.
- [Woche 14 · 30. März – 3. April 2026](https://code.claude.com/docs/de/whats-new/2026-w14.md): Computernutzung in der CLI, interaktive In-Product-Lektionen, flimmerfreies Rendering, MCP-Ergebnisgröße-Overrides pro Tool und Plugin-Ausführbare auf PATH.
- [Woche 13 · 23.–27. März 2026](https://code.claude.com/docs/de/whats-new/2026-w13.md): Auto-Modus für freihändige Berechtigungen, integrierte Computersteuerung, PR-Auto-Fix in der Cloud, Transkriptsuche und ein PowerShell-Tool für Windows.

### Ressourcen

#### Ressourcen

- [Rechtliche Bestimmungen und Compliance](https://code.claude.com/docs/de/legal-and-compliance.md): Rechtliche Vereinbarungen, Compliance-Zertifizierungen und Sicherheitsinformationen für Claude Code.
