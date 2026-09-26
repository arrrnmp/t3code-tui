# Claude Code Docs: Italian

> Official documentation for Claude Code, Anthropic's agentic coding tool available in the terminal, IDE, desktop app, and browser. Covers installation, configuration, skills, subagents, hooks, MCP, the Agent SDK, and reference material.

## Italian

### Guida introduttiva

#### Guida introduttiva

- [Panoramica](https://code.claude.com/docs/it/overview.md): Claude Code è uno strumento di codifica agentivo che legge la tua base di codice, modifica i file, esegue comandi e si integra con i tuoi strumenti di sviluppo. Disponibile nel tuo terminale, IDE, app desktop e browser.
- [Guida rapida](https://code.claude.com/docs/it/quickstart.md): Benvenuto in Claude Code!
- [Changelog](https://code.claude.com/docs/it/changelog.md)

#### Concetti fondamentali

- [Come funziona Claude Code](https://code.claude.com/docs/it/how-claude-code-works.md): Comprendi il ciclo agentico, gli strumenti integrati e come Claude Code interagisce con il tuo progetto.
- [Estendi Claude Code](https://code.claude.com/docs/it/features-overview.md): Comprendi quando utilizzare CLAUDE.md, Skills, subagents, hooks, MCP e plugins.
- [Esplora la directory .claude](https://code.claude.com/docs/it/claude-directory.md): Dove Claude Code legge CLAUDE.md, settings.json, hooks, skills, commands, subagents, workflows, rules e auto memory. Esplora la directory .claude nel tuo progetto e ~/.claude nella tua home directory.
- [Esplora la finestra di contesto](https://code.claude.com/docs/it/context-window.md): Una simulazione interattiva di come la finestra di contesto di Claude Code si riempie durante una sessione. Vedi cosa si carica automaticamente, quanto costa ogni lettura di file e quando si attivano le regole e gli hook.
- [Come Claude Code utilizza il prompt caching](https://code.claude.com/docs/it/prompt-caching.md): Claude Code gestisce il prompt caching automaticamente. Scopri perché un cambio di modello attiva un turno lento senza cache, quanto costa `/compact`, perché le modifiche a CLAUDE.md non si applicano a metà sessione e come controllare il tasso di cache hit.

#### Usa Claude Code

- [Come Claude ricorda il tuo progetto](https://code.claude.com/docs/it/memory.md): Fornisci a Claude istruzioni persistenti con file CLAUDE.md o AGENTS.md e lascia che Claude accumuli apprendimenti automaticamente con la memoria automatica.
- [Gestire le sessioni](https://code.claude.com/docs/it/sessions.md): Assegnare nomi, riprendere, creare rami e passare tra conversazioni di Claude Code. Copre `--continue`, `--resume`, `--from-pr`, il selezionatore `/resume`, la denominazione delle sessioni, l'esportazione dei trascritti e dove vengono archiviati i trascritti.
- [Flussi di lavoro comuni](https://code.claude.com/docs/it/common-workflows.md): Guide passo dopo passo per esplorare basi di codice, correggere bug, effettuare refactoring, testare e altri compiti quotidiani con Claude Code.
- [Libreria di prompt](https://code.claude.com/docs/it/prompt-library.md): Copia e incolla prompt per Claude Code, etichettati per attività e ruolo.
- [Best practices for Claude Code](https://code.claude.com/docs/it/best-practices.md): Suggerimenti e modelli per ottenere il massimo da Claude Code, dalla configurazione dell'ambiente al ridimensionamento tra sessioni parallele.

#### Piattaforme e integrazioni

- [Piattaforme e integrazioni](https://code.claude.com/docs/it/platforms.md): Scegli dove eseguire Claude Code e cosa collegare. Confronta CLI, Desktop, VS Code, JetBrains, web, mobile e integrazioni come Chrome, Slack e CI/CD.
- [Continua le sessioni locali da qualsiasi dispositivo con Remote Control](https://code.claude.com/docs/it/remote-control.md): Continua una sessione locale di Claude Code dal tuo telefono, tablet o da qualsiasi browser utilizzando Remote Control. Funziona con claude.ai/code e l'app Claude per dispositivi mobili.
- [Lascia che Claude coordini il lavoro in corso con Projects](https://code.claude.com/docs/it/claude-projects.md): Fornisci a Claude un corpo di lavoro correlato in una conversazione e lascia che coordini sessioni cloud parallele che condividono repository, istruzioni e memoria.
- [Claude Code su mobile](https://code.claude.com/docs/it/mobile.md): Avvia, monitora e guida i task di Claude Code dal tuo telefono con l'app Claude per iOS e Android.
- [Usa Claude Code con Chrome](https://code.claude.com/docs/it/chrome.md): Connetti Claude Code al tuo browser Chrome per testare app web, eseguire il debug con i log della console, automatizzare la compilazione di moduli ed estrarre dati dalle pagine web.
- [Consenti a Claude di usare il tuo computer dalla CLI](https://code.claude.com/docs/it/computer-use.md): Abilita computer use in Claude Code CLI affinché Claude possa aprire app, fare clic, digitare e vedere il tuo schermo su macOS. Testa app native, esegui il debug di problemi visivi e automatizza strumenti solo GUI senza lasciare il tuo terminale.
- [Usa Claude Code in VS Code](https://code.claude.com/docs/it/vs-code.md): Installa e configura l'estensione Claude Code per VS Code. Ottieni assistenza di codifica con IA con diff inline, @-mention, revisione del piano e scorciatoie da tastiera.
- [JetBrains IDEs](https://code.claude.com/docs/it/jetbrains.md): Usa Claude Code con JetBrains IDEs inclusi IntelliJ, PyCharm, WebStorm e altri
- [Claude Code in Slack](https://code.claude.com/docs/it/slack.md): Delega i compiti di codifica direttamente dal tuo workspace Slack. Anthropic sta ritirando questa versione precedente per i workspace Team ed Enterprise a favore di Claude Tag; rimane il percorso di configurazione per i piani Pro e Max.
- [Claude Tag](https://code.claude.com/docs/it/claude-tag.md): Porta Claude nei canali Slack del tuo team con Claude Tag e trova la documentazione di configurazione e utilizzo su claude.com.

##### Claude Code nel cloud

- [Iniziare con Claude Code nel cloud](https://code.claude.com/docs/it/web-quickstart.md): Esegui Claude Code nel cloud dal tuo browser o telefono. Connetti un repository GitHub, invia un'attività e rivedi la PR senza configurazione locale.
- [Usa Claude Code nel cloud](https://code.claude.com/docs/it/claude-code-on-the-web.md): Esegui sessioni Claude Code nel cloud dal tuo browser, telefono, app desktop o terminale, spostale con --cloud e --teleport, e correggi automaticamente le pull request.
- [Automatizzare il lavoro con le routine](https://code.claude.com/docs/it/routines.md): Metti Claude Code in modalità automatica. Definisci routine che vengono eseguite secondo una pianificazione, attivate da chiamate API o che reagiscono agli eventi di GitHub dall'infrastruttura cloud gestita da Anthropic.
- [Trova bug con ultrareview](https://code.claude.com/docs/it/ultrareview.md): Esegui una revisione del codice profonda e multi-agente nel cloud con /code-review ultra per trovare e verificare i bug prima di eseguire il merge.

##### Claude Code sul desktop

- [Iniziare con l'app desktop](https://code.claude.com/docs/it/desktop-quickstart.md): Installa Claude Code su desktop e avvia la tua prima sessione di codifica
- [Applicazione desktop](https://code.claude.com/docs/it/desktop.md): Sfrutta al massimo Claude Code Desktop: sessioni parallele con isolamento Git, layout dei pannelli drag-and-drop, terminale integrato e editor di file, chat laterali, utilizzo del computer, Dispatch sessioni dal tuo telefono, revisione visiva dei diff, anteprime delle app, monitoraggio dei PR, conne…
- [Claude Desktop su Linux (beta)](https://code.claude.com/docs/it/desktop-linux.md): Installa e aggiorna l'app desktop di Claude su Ubuntu e Debian
- [Claude Code Desktop in WSL](https://code.claude.com/docs/it/desktop-wsl.md): Esegui sessioni Code all'interno di una distribuzione WSL 2 su Windows
- [Pianificare attività ricorrenti in Claude Code Desktop](https://code.claude.com/docs/it/desktop-scheduled-tasks.md): Configura attività pianificate in Claude Code Desktop per eseguire Claude automaticamente su base ricorrente per revisioni del codice giornaliere, audit delle dipendenze o briefing mattutini.
- [Testare app iOS nel simulatore](https://code.claude.com/docs/it/desktop-ios-simulator.md): Claude Code Desktop apre la tua app nel riquadro iOS Simulator quando Claude la compila, esegue o la verifica, con un simulatore separato per ogni sessione.

##### Revisione del codice e CI/CD

- [Rileva problemi di sicurezza mentre Claude scrive il codice](https://code.claude.com/docs/it/security-guidance.md): Installa il plugin security-guidance per far sì che Claude riveda le proprie modifiche al codice per individuare vulnerabilità e correggerle nella stessa sessione.
- [Scansiona il tuo codebase per le vulnerabilità](https://code.claude.com/docs/it/claude-security.md): Installa il plugin Claude Security per scansionare il tuo codebase alla ricerca di vulnerabilità in una sessione Claude Code e trasforma i risultati in patch che esamini e applichi.
- [Code Review](https://code.claude.com/docs/it/code-review.md): Configura revisioni automatiche dei PR che rilevano errori logici, vulnerabilità di sicurezza e regressioni utilizzando l'analisi multi-agente dell'intero codebase
- [Claude Code GitHub Actions](https://code.claude.com/docs/it/github-actions.md): Esegui Claude Code nei flussi di lavoro di GitHub Actions per rispondere alle menzioni @claude, automatizzare attività e trasformare issue in pull request
- [Usa Claude Code GitHub Actions con i provider cloud](https://code.claude.com/docs/it/github-actions-cloud-providers.md): Esegui Claude Code GitHub Actions tramite Amazon Bedrock, Google Cloud's Agent Platform o Microsoft Foundry invece dell'API Claude
- [Claude Code con GitHub Enterprise Server](https://code.claude.com/docs/it/github-enterprise-server.md): Connetti Claude Code alla tua istanza GitHub Enterprise Server auto-ospitata per sessioni cloud, revisione del codice e marketplace di plugin.
- [Claude Code GitLab CI/CD](https://code.claude.com/docs/it/gitlab-ci-cd.md): Scopri come integrare Claude Code nel tuo flusso di lavoro di sviluppo con GitLab CI/CD

### Crea con Claude Code

#### Agenti e lavoro parallelo

- [Eseguire agenti in parallelo](https://code.claude.com/docs/it/agents.md): Confronta i modi in cui Claude Code può affrontare più attività contemporaneamente: subagenti, visualizzazione agenti, team di agenti, flussi di lavoro dinamici e progetti.
- [Creare subagent personalizzati](https://code.claude.com/docs/it/sub-agents.md): Creare e utilizzare subagent AI specializzati in Claude Code per flussi di lavoro specifici di attività e una migliore gestione del contesto.
- [Gestire più agenti con agent view](https://code.claude.com/docs/it/agent-view.md): Invia e gestisci molte sessioni di Claude Code da una sola schermata. Agent view mostra cosa sta facendo ogni sessione e quali hanno bisogno del tuo input.
- [Orchestrare team di sessioni Claude Code](https://code.claude.com/docs/it/agent-teams.md): Coordinare più istanze di Claude Code che lavorano insieme come un team, con attività condivise, messaggistica tra agenti e gestione centralizzata.
- [Messaggi tra le tue altre sessioni di Claude Code](https://code.claude.com/docs/it/cross-session-messaging.md): Consenti a Claude di elencare e inviare messaggi alle tue altre sessioni di Claude Code su questa macchina, e raggiungi le tue sessioni su altre macchine o nel cloud.
- [Orchestrare subagenti su larga scala con flussi di lavoro dinamici](https://code.claude.com/docs/it/workflows.md): I flussi di lavoro dinamici orchestrano molti subagenti da uno script che Claude scrive e che puoi rieseguire. Usali per audit di codebase, migrazioni su larga scala e ricerche con verifica incrociata.
- [Eseguire sessioni parallele con worktrees](https://code.claude.com/docs/it/worktrees.md): Isolare sessioni parallele di Claude Code in worktrees git separati in modo che i cambiamenti non si scontrino. Copre il flag `--worktree`, l'isolamento dei subagent, `.worktreeinclude`, la pulizia e gli hook VCS non-git.

#### MCP

- [Connettere i server MCP](https://code.claude.com/docs/it/mcp-quickstart.md): Aggiungere un server MCP a Claude Code, verificare la connessione e trovare la configurazione su disco.
- [Connetti Claude Code ai tuoi strumenti tramite MCP](https://code.claude.com/docs/it/mcp.md): Scopri come connettere Claude Code ai tuoi strumenti con il Model Context Protocol.

#### Skills

- [Estendi Claude con skills](https://code.claude.com/docs/it/skills.md): Crea, gestisci e condividi skills per estendere le capacità di Claude in Claude Code. Include comandi personalizzati e skills raggruppate.

#### Artefatti

- [Condividi l'output della sessione come artifact](https://code.claude.com/docs/it/artifacts.md): Gli artifact trasformano il lavoro di Claude Code in pagine live e interattive su claude.ai che puoi mantenere private, condividere con la tua organizzazione o pubblicare con un link pubblico.

#### Automazione

- [Automatizzare le azioni con hooks](https://code.claude.com/docs/it/hooks-guide.md): Esegui comandi shell automaticamente quando Claude Code modifica file, completa attività o ha bisogno di input. Formatta il codice, invia notifiche, convalida comandi e applica le regole del progetto.
- [Invia eventi in una sessione in esecuzione con i canali](https://code.claude.com/docs/it/channels.md): Utilizza i canali per inviare messaggi, avvisi e webhook nella tua sessione Claude Code da un server MCP. Inoltra i risultati CI, i messaggi di chat e gli eventi di monitoraggio in modo che Claude possa reagire mentre sei assente.
- [Eseguire prompt in base a una pianificazione](https://code.claude.com/docs/it/scheduled-tasks.md): Utilizzare /loop e gli strumenti di pianificazione cron per eseguire prompt ripetutamente, eseguire il polling dello stato o impostare promemoria una tantum all'interno di una sessione Claude Code.
- [Mantenere Claude al lavoro verso un obiettivo](https://code.claude.com/docs/it/goal.md): Imposta una condizione di completamento con /goal e Claude continua a lavorare finché non è soddisfatta, un modello la giudica impossibile, o un errore che Lei deve correggere cancella l'obiettivo.
- [Eseguire Claude Code a livello programmatico](https://code.claude.com/docs/it/headless.md): Utilizza l'Agent SDK per eseguire Claude Code a livello programmatico dalla CLI, Python o TypeScript.
- [Avviare sessioni dai link](https://code.claude.com/docs/it/deep-links.md): Apri una sessione di terminale Claude Code da un URL. Incorpora link `claude-cli://` in runbook, avvisi e dashboard in modo che un clic apra Claude Code nel repository corretto con il prompt corretto.

#### Guide

- [Configurare Claude Code in un monorepo o in un codebase di grandi dimensioni](https://code.claude.com/docs/it/large-codebases.md): Configura Claude Code per monorepo e codebase a singolo albero di grandi dimensioni con file CLAUDE.md annidati, worktree sparse, code intelligence e skills per pacchetto in modo che Claude rimanga focalizzato sul codice su cui stai lavorando.

#### Risoluzione dei problemi

- [Risolvi i problemi di installazione e accesso](https://code.claude.com/docs/it/troubleshoot-install.md): Correggi gli errori di comando non trovato, PATH, permessi, rete e autenticazione durante l'installazione o l'accesso a Claude Code.
- [Troubleshooting](https://code.claude.com/docs/it/troubleshooting.md): Risolvi i problemi di utilizzo elevato di CPU o memoria, blocchi, thrashing auto-compact e problemi di ricerca in Claude Code, e trova la pagina giusta per altri problemi.
- [Esegui il debug della tua configurazione](https://code.claude.com/docs/it/debug-your-config.md): Diagnostica perché CLAUDE.md, impostazioni, hooks, server MCP o skills non hanno effetto. Usa /context, /doctor, /hooks e /mcp per vedere cosa è stato effettivamente caricato.
- [Riferimento degli errori](https://code.claude.com/docs/it/errors.md): Consulta i messaggi di errore runtime di Claude Code con il significato di ciascuno e come risolverli.

### Plugin

#### Plugin

- [Panoramica dei plugin](https://code.claude.com/docs/it/plugins/overview.md): Comprendi cos'è un plugin Claude Code, quando ne hai bisogno invece di una skill autonoma o di un server MCP, e quale pagina leggere per installarne uno o crearne uno.

#### Usa i plugin

- [Installare e gestire i plugin](https://code.claude.com/docs/it/plugins/install.md): Installare i plugin di Claude Code da un marketplace su qualsiasi superficie che utilizzi, scegliere un ambito di installazione e aggiornarli o rimuoverli in seguito.
- [Code intelligence plugins](https://code.claude.com/docs/it/plugins/code-intelligence.md): Installa un plugin di language server in modo che Claude veda gli errori di tipo dopo le modifiche e navighi il codice per simbolo, e rispondi alla finestra di dialogo di raccomandazione del plugin LSP.
- [Sicurezza e affidabilità dei plugin](https://code.claude.com/docs/it/plugins/security.md): Decidi se fidarti di un plugin prima di installarlo, da ciò che un plugin può fare sulla tua macchina a come esaminarlo e rimuoverlo.

#### Crea plugin

- [Creare un plugin Claude Code](https://code.claude.com/docs/it/plugins/create.md): Crea il tuo primo plugin Claude Code da una directory vuota, testalo senza un marketplace e converti una configurazione .claude/ esistente.
- [Aggiungi componenti a un plugin](https://code.claude.com/docs/it/plugins/components.md): Aggiungi skills, hooks, server MCP e ogni altro tipo di componente a un plugin Claude Code, con un esempio che convalida per ciascuno.
- [Dipendenze dei plugin](https://code.claude.com/docs/it/plugins/dependencies.md): Dichiara i plugin da cui il tuo plugin dipende, con intervalli di versione come ^1.2, e scopri come Claude Code installa, risolve e elimina le dipendenze.
- [Testare i plugin con evals](https://code.claude.com/docs/it/plugin-evals.md): Scrivi casi di eval per il tuo plugin Claude Code, eseguili con claude plugin eval, valuta i risultati, confrontali con una baseline senza plugin e blocca la CI in base al punteggio.
- [Pubblica e distribuisci un plugin](https://code.claude.com/docs/it/plugins/publish.md): Pubblica un plugin Claude Code attraverso il tuo marketplace personale o il marketplace della comunità di Anthropic, con una checklist di pre-rilascio e come gli utenti ricevono gli aggiornamenti.
- [Misurare il costo e l'utilizzo dei plugin](https://code.claude.com/docs/it/plugins/measure.md): Misurare il costo in token di un plugin Claude Code, scoprire se le persone lo usano ancora e scegliere gli eventi di telemetria per domande sui plugin a livello organizzativo.
- [Consiglia il tuo plugin dalla tua CLI](https://code.claude.com/docs/it/plugins/cli-hints.md): Invita gli utenti di Claude Code a installare il tuo plugin del marketplace ufficiale emettendo un tag claude-code-hint dalla tua CLI o SDK.

#### Eseguire un marketplace

- [Creare un marketplace](https://code.claude.com/docs/it/plugins/create-marketplace.md): Crea un marketplace di plugin da un file marketplace.json e testalo localmente prima di ospitarlo.
- [Ospitare e mantenere un marketplace](https://code.claude.com/docs/it/plugins/host-marketplace.md): Pubblica un marketplace di plugin dove gli utenti possono raggiungerlo, concedi accesso a uno privato e rilascia aggiornamenti e ridenominazioni senza interrompere le installazioni.
- [Consigliare plugin per la tua organizzazione](https://code.claude.com/docs/it/plugins/relevance.md): Aggiungi un blocco di rilevanza alle voci dei plugin del marketplace in modo che Claude Code li suggerisca quando il lavoro di un utente corrisponde, e inserisci il marketplace nella whitelist nelle impostazioni gestite.

#### Gestisci i plugin per la tua organizzazione

- [Gestire i plugin Claude Code per la tua organizzazione](https://code.claude.com/docs/it/plugins/org.md): Controlla quali plugin Claude Code installa e consente su ogni macchina della tua organizzazione attraverso impostazioni gestite.

#### Risoluzione dei problemi

- [Risolvere i problemi dei plugin](https://code.claude.com/docs/it/plugins/troubleshooting.md): Correggi gli errori dei plugin in Claude Code. Trova il messaggio esatto che hai visto, raggruppato per fase da dove /plugin viene eseguito fino all'installazione e alla politica organizzativa.
- [Riferimento al caricamento dei plugin](https://code.claude.com/docs/it/plugins/loading.md): Traccia da dove Claude Code carica ogni plugin, quale file di impostazioni decide se caricarlo e perché un aggiornamento non ha cambiato nulla.

#### Riferimento

- [Riferimento del manifest del plugin](https://code.claude.com/docs/it/plugins/manifest-reference.md): Riferimento completo per plugin.json: ogni campo con il suo tipo e valore predefinito, forme di percorso accettate, e gli schemi userConfig e variabili di ambiente.
- [Marketplace reference](https://code.claude.com/docs/it/plugins/marketplace-reference.md): Riferimento completo per i campi marketplace.json, le voci dei plugin e gli oggetti sorgente del plugin e del marketplace, con indicazione di dove ciascuno è valido.
- [Riferimento comandi plugin](https://code.claude.com/docs/it/plugins/cli-reference.md): Riferimento completo per i comandi shell del plugin claude, /plugin e /reload-plugins in una sessione, e i flag che caricano un plugin per una sola sessione.

### Amministrazione

#### Configurazione e accesso

- [Configurare Claude Code per la tua organizzazione](https://code.claude.com/docs/it/admin-setup.md): Una mappa decisionale per gli amministratori che distribuiscono Claude Code, che copre i provider API, le impostazioni gestite, l'applicazione delle policy, il monitoraggio dell'utilizzo e la gestione dei dati.
- [Configurazione avanzata](https://code.claude.com/docs/it/setup.md): Requisiti di sistema, installazione specifica per piattaforma, gestione delle versioni e disinstallazione per Claude Code.
- [Autenticazione](https://code.claude.com/docs/it/authentication.md): Accedi a Claude Code e configura l'autenticazione per singoli utenti, team e organizzazioni.
- [Distribuire impostazioni gestite](https://code.claude.com/docs/it/managed-settings.md): Distribuire impostazioni gestite su ogni macchina dello sviluppatore: meccanismi di consegna per sistema operativo, come Claude Code combina le fonti gestite e come verificare l'applicazione.
- [Configurare le impostazioni gestite dal server](https://code.claude.com/docs/it/server-managed-settings.md): Configurare centralmente Claude Code per la vostra organizzazione tramite impostazioni consegnate dal server, senza richiedere infrastrutture di gestione dei dispositivi.
- [Controllare l'accesso ai server MCP per la vostra organizzazione](https://code.claude.com/docs/it/managed-mcp.md): Limitare quali server MCP gli utenti possono aggiungere o connettere, o fornire server a ogni utente, con file di configurazione gestiti, impostazioni gestite, allowlist e denylists.
- [Configurare la modalità auto](https://code.claude.com/docs/it/auto-mode-config.md): Comunica al classificatore della modalità auto quali repository, bucket e domini la tua organizzazione ritiene affidabili. Imposta il contesto dell'ambiente, sostituisci le regole di blocco e autorizzazione predefinite e ispeziona la tua configurazione effettiva con i sottocomandi CLI della modalità…

#### Distribuzione

- [Panoramica della distribuzione aziendale](https://code.claude.com/docs/it/third-party-integrations.md): Scopri come Claude Code può integrarsi con vari servizi di terze parti e infrastrutture per soddisfare i requisiti di distribuzione aziendale.
- [Disponibilità delle funzionalità](https://code.claude.com/docs/it/feature-availability.md): Confronta quali funzionalità di Claude Code sono disponibili nei piani di abbonamento Anthropic, nella Console Anthropic, in Amazon Bedrock, su Claude Platform on AWS, in Google Cloud's Agent Platform e in Microsoft Foundry.
- [Claude Code su Amazon Bedrock](https://code.claude.com/docs/it/amazon-bedrock.md): Scopri come configurare Claude Code tramite Amazon Bedrock, inclusa la configurazione, la configurazione IAM e la risoluzione dei problemi.
- [Claude Code su Claude Platform on AWS](https://code.claude.com/docs/it/claude-platform-on-aws.md): Configura Claude Code per utilizzare l'API Claude gestita da Anthropic con autenticazione AWS, controllo dell'accesso IAM e fatturazione tramite AWS Marketplace.
- [Claude Code su Google Cloud's Agent Platform](https://code.claude.com/docs/it/google-vertex-ai.md): Scopri come configurare Claude Code tramite Google Cloud's Agent Platform, precedentemente Vertex AI, inclusa la configurazione, la configurazione IAM e la risoluzione dei problemi.
- [Claude Code su Microsoft Foundry](https://code.claude.com/docs/it/microsoft-foundry.md): Scopri come configurare Claude Code tramite Microsoft Foundry, inclusi setup, configurazione e risoluzione dei problemi.
- [Configurazione di rete aziendale](https://code.claude.com/docs/it/network-config.md): Configurare Claude Code per ambienti aziendali con server proxy, Autorità di Certificazione (CA) personalizzate e autenticazione Transport Layer Security (mTLS) reciproca.
- [Eseguire Claude Code dietro un launcher aziendale](https://code.claude.com/docs/it/corporate-launcher.md): Instradare i processi che Claude Code avvia dal suo binario, incluso il servizio in background e ogni sessione di agent view, attraverso un launcher obbligatorio con CLAUDE_CODE_PROCESS_WRAPPER o l'impostazione processWrapper.
- [Contenitori di sviluppo](https://code.claude.com/docs/it/devcontainer.md): Esegui Claude Code all'interno di un contenitore di sviluppo per ambienti coerenti e isolati in tutto il tuo team.

#### Gateway

- [Eseguire Claude Code attraverso un gateway](https://code.claude.com/docs/it/gateways.md): Instrada Claude Code attraverso un gateway auto-ospitato per credenziali centralizzate, tracciamento dell'utilizzo e controlli dei costi. Copre l'architettura, il gateway delle app Claude di Anthropic e l'utilizzo di altri prodotti gateway.

##### Gateway app Claude

- [Gateway di app Claude per Amazon Bedrock, Claude Platform su AWS, Google Cloud e Microsoft Foundry](https://code.claude.com/docs/it/claude-apps-gateway.md): Esegui Claude Code attraverso Amazon Bedrock, Claude Platform su AWS, Google Cloud o Microsoft Foundry dietro un gateway auto-ospitato con accesso SSO, accesso ai modelli per gruppo e telemetria OTLP.
- [Configurazione del gateway delle app Claude](https://code.claude.com/docs/it/claude-apps-gateway-config.md): Riferimento per ogni opzione di gateway.yaml: listener e TLS, OIDC, sessione, archivio Postgres, upstream Amazon Bedrock, Claude Platform su AWS, Agent Platform di Google Cloud e Microsoft Foundry, routing dei modelli, criteri gestiti e telemetria.
- [Limiti di spesa del gateway delle app Claude](https://code.claude.com/docs/it/claude-apps-gateway-spend-limits.md): Limita la spesa di ogni sviluppatore attraverso il gateway delle app Claude per giorno, settimana o mese. Imposta i limiti con un'API Admin e il gateway li applica in tempo reale su ogni richiesta.
- [Distribuzione e operazioni del gateway delle app Claude](https://code.claude.com/docs/it/claude-apps-gateway-deploy.md): Registrare il gateway con il vostro IdP, costruire il container, distribuire su Kubernetes o Cloud Run, e gestirlo: controlli di integrità, rotazione dei segreti, aggiornamenti e sicurezza.
- [Distribuire il gateway delle app Claude su AWS](https://code.claude.com/docs/it/claude-apps-gateway-on-aws.md): Un esempio pratico di esecuzione del gateway delle app Claude su AWS: ECS Fargate o EKS, Amazon RDS per PostgreSQL, AWS Secrets Manager e autenticazione basata su ruoli IAM ad Amazon Bedrock.
- [Distribuire il gateway delle app Claude su Google Cloud](https://code.claude.com/docs/it/claude-apps-gateway-on-gcp.md): Un esempio pratico di esecuzione del gateway delle app Claude su Google Cloud: Cloud Run o GKE, Cloud SQL per PostgreSQL, Secret Manager e autenticazione tramite account di servizio verso Agent Platform di Google Cloud.

##### Altri gateway

- [Gateway LLM altri](https://code.claude.com/docs/it/llm-gateway.md): Instrada Claude Code attraverso un gateway LLM che la tua organizzazione già esegue. Copre il collegamento di Claude Code a un gateway, il rollout per la tua organizzazione e cosa Claude Code invia a un gateway.
- [Connetti Claude Code a un gateway LLM](https://code.claude.com/docs/it/llm-gateway-connect.md): Indirizza Claude Code al gateway LLM della tua organizzazione. Verifica se il tuo amministratore lo ha già configurato, oppure imposta l'URL di base e le credenziali da solo, quindi verifica la connessione e risolvi gli errori del gateway.
- [Distribuire un gateway LLM per la vostra organizzazione](https://code.claude.com/docs/it/llm-gateway-rollout.md): Distribuire un prodotto gateway per Claude Code: configurarlo per inoltrare ciò che Claude Code invia, emettere credenziali per sviluppatori, distribuire la configurazione tramite impostazioni gestite e verificare la distribuzione.
- [Guida di compatibilità del gateway Claude Code](https://code.claude.com/docs/it/llm-gateway-protocol.md): Mantieni un gateway LLM compatibile con Claude Code: gli endpoint che chiama, le intestazioni e i campi del corpo da inoltrare, e cosa si interrompe quando vengono rimossi.

#### Utilizzo e costi

- [Monitoraggio](https://code.claude.com/docs/it/monitoring-usage.md): Scopri come abilitare e configurare OpenTelemetry per Claude Code.
- [Gestisci i costi in modo efficace](https://code.claude.com/docs/it/costs.md): Traccia l'utilizzo dei token, imposta i limiti di spesa del team e riduci i costi di Claude Code con la gestione del contesto, la selezione del modello, le impostazioni del pensiero esteso e gli hook di pre-elaborazione.
- [Traccia l'utilizzo del team con l'analittica](https://code.claude.com/docs/it/analytics.md): Visualizza le metriche di utilizzo di Claude Code, traccia l'adozione e misura la velocità di ingegneria nel dashboard di analittica.

#### Sicurezza e dati

- [Sicurezza](https://code.claude.com/docs/it/security.md): Scopri le misure di sicurezza di Claude Code e le migliori pratiche per un utilizzo sicuro.
- [Utilizzo dei dati](https://code.claude.com/docs/it/data-usage.md): Scopri le politiche di utilizzo dei dati di Anthropic per Claude
- [Zero data retention](https://code.claude.com/docs/it/zero-data-retention.md): Scopri Zero Data Retention (ZDR) per Claude Code, disponibile per account qualificati su Claude for Enterprise, inclusi ambito, funzionalità disabilitate e come richiedere l'abilitazione.

#### Adozione

- [Kit di comunicazione](https://code.claude.com/docs/it/communications-kit.md): Annunci di lancio, messaggi di campagna a goccia e risposte FAQ per il rollout di Claude Code nella vostra organizzazione di ingegneria.
- [Champion kit](https://code.claude.com/docs/it/champion-kit.md): Una guida pratica per gli ingegneri che promuovono Claude Code internamente: cosa condividere, come rispondere alle domande e come aumentare l'adozione nel tuo team.

### Configurazione

#### Impostazioni

- [File di impostazioni e precedenza](https://code.claude.com/docs/it/settings.md): Modifica le impostazioni di Claude Code, scegli l'ambito a cui appartiene una chiave, verifica la modifica e scopri quale valore Claude Code utilizza quando una chiave è impostata in più posizioni.
- [Tutte le impostazioni](https://code.claude.com/docs/it/settings-reference.md): Riferimento completo per ogni chiave settings.json di Claude Code: dove va ciascuna, il suo tipo e valore predefinito, e un esempio pronto da incollare, con un indice di ogni chiave.
- [File di impostazioni di esempio](https://code.claude.com/docs/it/settings-example.md): File settings.json realistici per uno sviluppatore, un team e un'organizzazione: copia uno, mantieni le chiavi che desideri e modifica i valori.

#### Autorizzazioni e sandboxing

- [Configurare le autorizzazioni](https://code.claude.com/docs/it/permissions.md): Controlla cosa Claude Code può accedere e fare con regole di autorizzazione granulari, modalità e criteri gestiti.
- [Scegli una modalità di autorizzazione](https://code.claude.com/docs/it/permission-modes.md): Controlla se Claude chiede prima di agire. Cambia le modalità di autorizzazione con Shift+Tab nella CLI, l'indicatore di modalità in VS Code, o il selettore di modalità in Desktop.
- [Configura lo strumento Bash in sandbox](https://code.claude.com/docs/it/sandboxing.md): Scopri come lo strumento Bash in sandbox di Claude Code fornisce isolamento del filesystem e della rete per un'esecuzione dell'agente più sicura e autonoma.
- [Scegliere un ambiente sandbox](https://code.claude.com/docs/it/sandbox-environments.md): Confronta le opzioni di sandbox di Claude Code: lo strumento Bash sandboxed integrato, il runtime sandbox, i dev container, Docker e le VM. Scegli l'isolamento giusto per il tuo modello di minaccia.

#### Ambienti

- [Configurare ambienti cloud](https://code.claude.com/docs/it/cloud-environments.md): Configurare ambienti cloud per le sessioni cloud di Claude Code: livelli di accesso di rete, variabili di ambiente, script di configurazione e caching dell'ambiente.

##### Ambienti self-hosted

- [Ambienti self-hosted](https://code.claude.com/docs/it/self-hosted-environments.md): Esegui sessioni cloud di Claude Code su infrastrutture che controlli: configura un ambiente self-hosted, distribuisci runner e instrada le sessioni al tuo calcolo.
- [Guida rapida agli ambienti self-hosted](https://code.claude.com/docs/it/self-hosted-environments-quickstart.md): Configura il tuo primo ambiente self-hosted: installa Claude Code, crea l'ambiente, avvia un runner e indirizza una sessione ad esso.
- [Distribuisci ambienti self-hosted in produzione](https://code.claude.com/docs/it/self-hosted-environments-deploy.md): Esegui runner self-hosted in produzione: hardening della sicurezza, controllo dell'egress di rete, credenziali git, ricette Kubernetes e Compose, e risoluzione dei problemi.
- [Personalizzare le sessioni negli ambienti self-hosted](https://code.claude.com/docs/it/self-hosted-environments-configuration.md): Personalizzare le sessioni degli ambienti self-hosted con script wrapper per credenziali per sessione, hook del ciclo di vita e spawning di runner su richiesta.
- [Testare gli ambienti self-hosted end to end](https://code.claude.com/docs/it/self-hosted-environments-testing.md): Verificare un'immagine di runner self-hosted da CI: inviare una sessione con la CLI, leggere le risposte di Claude attraverso un hook Stop e scrivere lo script del ciclo completo.
- [Riferimento per ambienti self-hosted](https://code.claude.com/docs/it/self-hosted-environments-reference.md): Riferimento completo per il runner self-hosted e l'orchestrator: flag CLI, variabili d'ambiente e metriche Prometheus.
- [Verificare l'identità della sessione negli ambienti self-hosted](https://code.claude.com/docs/it/self-hosted-environments-identity.md): Verificare il JWT CLAUDE_CODE_SESSION_ACCESS_TOKEN in modo che i servizi sulla vostra rete possano fidarsi delle richieste provenienti da sessioni nel vostro ambiente self-hosted.

#### Modello e risposte

- [Configurazione del modello](https://code.claude.com/docs/it/model-config.md): Configurare quale modello Claude Code utilizza, livelli di impegno, contesto esteso e la finestra di auto-compattazione
- [Accelera le risposte con la modalità veloce](https://code.claude.com/docs/it/fast-mode.md): Ottieni risposte più veloci di Opus in Claude Code attivando la modalità veloce.
- [Escalate hard decisions with the advisor tool](https://code.claude.com/docs/it/advisor.md): Abbina il tuo modello principale con un modello advisor più potente che Claude consulta nei momenti chiave durante un'attività.
- [Output styles](https://code.claude.com/docs/it/output-styles.md): Cambia il ruolo, il tono e il formato di risposta di Claude Code con uno stile di output integrato come Concise o Explanatory, oppure scrivi uno stile personalizzato.

#### Interfaccia

- [Configura il tuo terminale per Claude Code](https://code.claude.com/docs/it/terminal-config.md): Correggi Shift+Invio per le nuove righe, ricevi un segnale acustico del terminale quando Claude termina, configura tmux, abbina il tema dei colori e abilita la modalità Vim nella CLI di Claude Code.
- [Rendering a schermo intero](https://code.claude.com/docs/it/fullscreen.md): Abilita una modalità di rendering più fluida e senza sfarfallio con supporto del mouse e utilizzo stabile della memoria nelle conversazioni lunghe.
- [Usa Claude Code con un lettore di schermo](https://code.claude.com/docs/it/accessibility.md): Configura Claude Code per lettori di schermo come VoiceOver e NVDA, oltre alle impostazioni per ingranditori dello schermo, movimento ridotto e temi adatti ai daltonici.
- [Dettatura vocale](https://code.claude.com/docs/it/voice-dictation.md): Pronuncia i tuoi prompt nella CLI di Claude Code con dettatura vocale a pressione prolungata o a tocco.
- [Personalizza la tua barra di stato](https://code.claude.com/docs/it/statusline.md): Configura una barra di stato personalizzata per monitorare l'utilizzo della finestra di contesto, i costi e lo stato git in Claude Code
- [Personalizzare le scorciatoie da tastiera](https://code.claude.com/docs/it/keybindings.md): Personalizzare le scorciatoie da tastiera in Claude Code con un file di configurazione keybindings.

### Riferimento

#### Riferimento

- [Riferimento CLI](https://code.claude.com/docs/it/cli-reference.md): Riferimento completo per l'interfaccia da riga di comando di Claude Code, inclusi comandi e flag.
- [Commands](https://code.claude.com/docs/it/commands.md): Riferimento completo per i comandi disponibili in Claude Code, inclusi i comandi integrati e le skills in bundle.
- [Variabili d'ambiente](https://code.claude.com/docs/it/env-vars.md): Riferimento per le variabili d'ambiente che controllano il comportamento di Claude Code.
- [Riferimento degli strumenti](https://code.claude.com/docs/it/tools-reference.md): Riferimento completo per gli strumenti che Claude Code può utilizzare, inclusi i requisiti di autorizzazione e il comportamento per strumento.
- [Modalità interattiva](https://code.claude.com/docs/it/interactive-mode.md): Riferimento completo per le scorciatoie da tastiera, le modalità di input e le funzioni interattive nelle sessioni di Claude Code.
- [Checkpointing](https://code.claude.com/docs/it/checkpointing.md): Traccia, riavvolgi e riassumi le modifiche e la conversazione di Claude per gestire lo stato della sessione.
- [Riferimento dei hooks](https://code.claude.com/docs/it/hooks.md): Riferimento per gli eventi dei hook di Claude Code, schema di configurazione, formati JSON di input/output, codici di uscita, hook asincroni, hook HTTP, hook di prompt e hook degli strumenti MCP.
- [Riferimento dei canali](https://code.claude.com/docs/it/channels-reference.md): Crea un server MCP che invia webhook, avvisi e messaggi di chat in una sessione di Claude Code. Riferimento per il contratto del canale: dichiarazione di capacità, eventi di notifica, strumenti di risposta, gating del mittente e inoltro delle autorizzazioni.

#### Glossario

- [Glossario](https://code.claude.com/docs/it/glossary.md): Definizioni della terminologia di Claude Code. Scopri cosa significano agentic loop, compaction, CLAUDE.md, hooks, subagents, MCP e altri concetti fondamentali.

### Agent SDK

#### Agent SDK

- [Panoramica dell'Agent SDK](https://code.claude.com/docs/it/agent-sdk/overview.md): Costruisci agenti AI di produzione con Claude Code come libreria
- [Guida rapida](https://code.claude.com/docs/it/agent-sdk/quickstart.md): Inizia con l'Agent SDK per Python o TypeScript per creare agenti AI che funzionano autonomamente
- [Migrazione a Claude Agent SDK](https://code.claude.com/docs/it/agent-sdk/migration-guide.md): Guida per la migrazione dei Claude Code SDK TypeScript e Python a Claude Agent SDK
- [Risolvere i problemi dell'Agent SDK](https://code.claude.com/docs/it/agent-sdk/troubleshooting.md): Correggi gli errori dell'Agent SDK quando la CLI di Claude Code non si avvia, il processo CLI esce, o un risultato riuscito arriva senza output strutturato.

#### Creare agenti

- [Configura il tuo agente](https://code.claude.com/docs/it/agent-sdk/configuration.md): Configura le sessioni dell'Agent SDK: componi l'oggetto options, imposta il modello, l'ambiente e i limiti, e trova la pagina di ogni opzione di funzionalità.
- [Esempi](https://code.claude.com/docs/it/agent-sdk/examples.md): Trova un progetto Agent SDK completo e eseguibile o una ricetta guidata nel Claude Cookbook che corrisponda a ciò che desideri costruire.

#### Concetti fondamentali

- [Come funziona il ciclo dell'agente](https://code.claude.com/docs/it/agent-sdk/agent-loop.md): Comprendere il ciclo di vita dei messaggi, l'esecuzione degli strumenti, la finestra di contesto e l'architettura che alimentano gli agenti SDK.
- [Usa le funzionalità di Claude Code nell'SDK](https://code.claude.com/docs/it/agent-sdk/claude-code-features.md): Carica le istruzioni del progetto, le skills, gli hooks e altre funzionalità di Claude Code nei tuoi agenti SDK.
- [Lavorare con le sessioni](https://code.claude.com/docs/it/agent-sdk/sessions.md): Come le sessioni mantengono la cronologia della conversazione dell'agente, e quando utilizzare continue, resume e fork per tornare a un'esecuzione precedente.
- [Persistere le sessioni nell'archiviazione esterna](https://code.claude.com/docs/it/agent-sdk/session-storage.md): Eseguire il mirroring dei trascritti di sessione Agent SDK nel vostro object store, key-value store o database in modo che altri host possano riprendere le vostre sessioni.

#### Input e output

- [Streaming Input](https://code.claude.com/docs/it/agent-sdk/streaming-vs-single-mode.md): Comprensione delle due modalità di input per Claude Agent SDK e quando utilizzare ciascuna
- [Gestire approvazioni e input dell'utente](https://code.claude.com/docs/it/agent-sdk/user-input.md): Presenta le richieste di approvazione e le domande di chiarimento di Claude agli utenti, quindi restituisci le loro decisioni all'SDK.
- [Trasmettere risposte in tempo reale](https://code.claude.com/docs/it/agent-sdk/streaming-output.md): Ricevere risposte in tempo reale dall'Agent SDK mentre il testo e le chiamate di strumenti vengono trasmessi
- [Ottenere output strutturati dagli agenti](https://code.claude.com/docs/it/agent-sdk/structured-outputs.md): Restituire JSON convalidato dai flussi di lavoro degli agenti utilizzando JSON Schema, Zod o Pydantic. Ottenere dati strutturati e type-safe dopo l'uso di strumenti multi-turno.

#### Estendi con strumenti

- [Fornisci a Claude strumenti personalizzati](https://code.claude.com/docs/it/agent-sdk/custom-tools.md): Definisci strumenti personalizzati con il server MCP in-process dell'Agent SDK di Claude in modo che Claude possa chiamare le tue funzioni, accedere alle tue API ed eseguire operazioni specifiche del dominio.
- [Connettiti a strumenti esterni con MCP](https://code.claude.com/docs/it/agent-sdk/mcp.md): Configura i server MCP per estendere il tuo agente con strumenti esterni. Copre i tipi di trasporto, la ricerca di strumenti per set di strumenti di grandi dimensioni, l'autenticazione e la gestione degli errori.
- [Scalare a molti strumenti con la ricerca di strumenti](https://code.claude.com/docs/it/agent-sdk/tool-search.md): Scalare il vostro agente a migliaia di strumenti scoprendo e caricando solo ciò che è necessario, su richiesta.
- [Subagents nell'SDK](https://code.claude.com/docs/it/agent-sdk/subagents.md): Definisci e richiama subagenti per isolare il contesto, eseguire attività in parallelo e applicare istruzioni specializzate nelle tue applicazioni Claude Agent SDK.

#### Personalizza il comportamento

- [Modifica dei system prompt](https://code.claude.com/docs/it/agent-sdk/modifying-system-prompts.md): Scegli tra il preset `claude_code` e un system prompt personalizzato, e personalizza il comportamento con CLAUDE.md, stili di output, append, o un prompt completamente personalizzato.
- [Estendi gli agenti con skills](https://code.claude.com/docs/it/agent-sdk/skills.md): Controlla quali skills Claude può invocare nelle sessioni dell'Agent SDK, invia comandi per nome e crea skills che le tue sessioni scoprono
- [Plugin nell'SDK](https://code.claude.com/docs/it/agent-sdk/plugins.md): Carica plugin personalizzati per estendere Claude Code con skills, agenti, hooks e server MCP tramite l'Agent SDK

#### Controllo e osservabilità

- [Configurare i permessi](https://code.claude.com/docs/it/agent-sdk/permissions.md): Controlla come il tuo agente utilizza gli strumenti con modalità di permesso, hook e regole dichiarative di consentimento/negazione.
- [Intercettare e controllare il comportamento dell'agente con hooks](https://code.claude.com/docs/it/agent-sdk/hooks.md): Intercettare e personalizzare il comportamento dell'agente nei punti chiave di esecuzione con hooks
- [Ripristina le modifiche ai file con checkpointing](https://code.claude.com/docs/it/agent-sdk/file-checkpointing.md): Traccia le modifiche ai file durante le sessioni dell'agente e ripristina i file a qualsiasi stato precedente
- [Tracciare costi e utilizzo](https://code.claude.com/docs/it/agent-sdk/cost-tracking.md): Scopri come tracciare l'utilizzo dei token, stimare i costi e configurare la memorizzazione nella cache dei prompt con Claude Agent SDK.
- [Osservabilità con OpenTelemetry](https://code.claude.com/docs/it/agent-sdk/observability.md): Esporta tracce, metriche ed eventi dall'Agent SDK al tuo backend di osservabilità utilizzando OpenTelemetry.
- [Traccia todo](https://code.claude.com/docs/it/agent-sdk/todo-tracking.md): Traccia i todo nelle sessioni di Agent SDK e visualizza i progressi di Claude nella tua applicazione da chiamate di strumenti strutturate

#### Distribuzione

- [Hosting dell'Agent SDK](https://code.claude.com/docs/it/agent-sdk/hosting.md): Distribuisci l'Agent SDK in produzione: architettura subprocess, persistenza della sessione, scalabilità, osservabilità e isolamento multi-tenant per Docker, Kubernetes e provider sandbox.
- [Distribuzione sicura di agenti AI](https://code.claude.com/docs/it/agent-sdk/secure-deployment.md): Una guida per proteggere le distribuzioni di Claude Code e Agent SDK con isolamento, gestione delle credenziali e controlli di rete

#### Riferimenti SDK

- [Riferimento Agent SDK - TypeScript](https://code.claude.com/docs/it/agent-sdk/typescript.md): Riferimento API completo per l'Agent SDK TypeScript, incluse tutte le funzioni, i tipi e le interfacce.
- [API sessione TypeScript SDK V2 (rimosso)](https://code.claude.com/docs/it/agent-sdk/typescript-v2-preview.md): Riferimento per l'API sessione rimosso V2 TypeScript Agent SDK, con pattern send/stream basati su sessione per conversazioni multi-turno.
- [Riferimento SDK Agent - Python](https://code.claude.com/docs/it/agent-sdk/python.md): Riferimento API completo per Python Agent SDK, incluse tutte le funzioni, i tipi e le classi.

### Novità

#### Novità

- [Novità](https://code.claude.com/docs/it/whats-new/index.md): Un digest settimanale delle notevoli funzionalità di Claude Code, con frammenti di codice, demo e contesto su perché sono importanti.
- [Settimana 37 · 7–11 settembre 2026](https://code.claude.com/docs/it/whats-new/2026-w37.md): Testate i vostri plugin con claude plugin eval e staccate i riquadri di Claude Code Desktop in finestre separate.
- [Settimana 36 · 31 agosto – 4 settembre 2026](https://code.claude.com/docs/it/whats-new/2026-w36.md): Passa a Claude Fable 5.1, lascia che l'uso del computer funzioni in background su Desktop e guarda gli editing di Claude in un pannello /diff dal vivo.
- [Settimana 35 · 24–28 agosto 2026](https://code.claude.com/docs/it/whats-new/2026-w35.md): Riprendere le sessioni di terminale nell'app Claude Code Desktop, esaminare i rapporti di feedback che Claude redige per voi e avviare una sessione in modalità limitata.
- [Settimana 34 · 17–21 agosto 2026](https://code.claude.com/docs/it/whats-new/2026-w34.md): Crea artboard UI modificabili con la skill /design, imposta lo stile di output Concise e avvia una sessione Claude Code sulla tua macchina dal tuo telefono.
- [Settimana 33 · 10–14 agosto 2026](https://code.claude.com/docs/it/whats-new/2026-w33.md): Claude Code Desktop continua automaticamente dopo il ripristino di un limite di utilizzo, la modalità fork è attivata per impostazione predefinita e le richieste di merge GitLab e i marketplace si uniscono a GitHub.
- [Settimana 32 · 3–7 agosto 2026](https://code.claude.com/docs/it/whats-new/2026-w32.md): Le sessioni di Claude Code si messaggiano tra loro, gli ambienti self-hosted eseguono sessioni cloud sulla vostra infrastruttura, e la modalità auto diventa la modalità di autorizzazione predefinita.
- [Settimana 30 · 20–24 luglio 2026](https://code.claude.com/docs/it/whats-new/2026-w30.md): Opus 5 diventa il modello Opus predefinito, Claude Code Desktop aggiunge un riquadro iOS Simulator, e il plugin Claude Security esegue la scansione del codice per individuare vulnerabilità.
- [Settimana 29 · 13–17 luglio 2026](https://code.claude.com/docs/it/whats-new/2026-w29.md): Estrai dati live negli artifact pubblicati tramite connettori MCP e utilizza Claude Code con un lettore di schermo nella nuova modalità screen reader.
- [Settimana 28 · 6–10 luglio 2026](https://code.claude.com/docs/it/whats-new/2026-w28.md): Sfoglia siti esterni dal browser integrato dell'app Desktop, esegui un controllo completo della configurazione con /doctor e scopri le protezioni dei transcript in modalità automatica e gli aggiornamenti della visualizzazione degli agenti.
- [Settimana 27 · 29 giugno – 3 luglio 2026](https://code.claude.com/docs/it/whats-new/2026-w27.md): Claude Sonnet 5 diventa il modello predefinito, Claude in Chrome raggiunge la disponibilità generale, i subagent vengono eseguiti in background per impostazione predefinita, Claude Desktop arriva su Linux in versione beta, e /radio si sintonizza su Claude FM.
- [Settimana 26 · 22–26 giugno 2026](https://code.claude.com/docs/it/whats-new/2026-w26.md): Autenticate i server MCP dalla shell con claude mcp login, ottenete una risposta all'output del comando della modalità shell con il prefisso !, e riprendete una conversazione da prima di /clear con /rewind.
- [Settimana 25 · 15–19 giugno 2026](https://code.claude.com/docs/it/whats-new/2026-w25.md): Pubblica una pagina live e condivisibile dalla tua sessione con Artifacts, abbina i parametri degli strumenti nelle regole di negazione e richiesta, e imposta qualsiasi impostazione dal prompt con /config.
- [Settimana 24 · 8–12 giugno 2026](https://code.claude.com/docs/it/whats-new/2026-w24.md): Sposta una sessione in una nuova directory con /cd, consenti ai sub-agent di generare i propri sub-agent e risolvi i problemi di una configurazione non funzionante con la modalità sicura.
- [Settimana 23 · 1–5 giugno 2026](https://code.claude.com/docs/it/whats-new/2026-w23.md): Esegui la modalità auto su Amazon Bedrock, Google Cloud's Agent Platform e Microsoft Foundry, richiedi conferma prima di scrivere file che possono eseguire codice in modalità acceptEdits, elenca i plugin installati con /plugin list e richiedi un intervallo di versione approvato per le distribuzioni…
- [Settimana 22 · 25–29 maggio 2026](https://code.claude.com/docs/it/whats-new/2026-w22.md): Esegui Claude Code su Claude Opus 4.8, orchestrate attività di grandi dimensioni con flussi di lavoro dinamici, rileva i problemi di sicurezza con il plugin security-guidance e utilizza la modalità veloce su Opus 4.8 a un prezzo inferiore.
- [Settimana 21 · 18–22 maggio 2026](https://code.claude.com/docs/it/whats-new/2026-w21.md): Utilizza la modalità auto nel piano Pro e con Sonnet 4.6, visualizza quali skills, subagents e server MCP determinano i limiti del vostro piano in /usage, e rivedi i diff con il nuovo comando /code-review.
- [Settimana 20 · 11–15 maggio 2026](https://code.claude.com/docs/it/whats-new/2026-w20.md): Gestisci ogni sessione di Claude Code da una sola schermata con la visualizzazione agente, mantieni Claude al lavoro verso un obiettivo finché non si verifica una condizione, ed esegui la modalità veloce su Opus 4.7 per impostazione predefinita.
- [Settimana 19 · 4–8 maggio 2026](https://code.claude.com/docs/it/whats-new/2026-w19.md): Carica i plugin da archivi .zip e URL, cerca la cronologia dei comandi in tutti i progetti con Ctrl+R, crea nuovi worktrees dal HEAD locale o dal ramo predefinito remoto, e blocca le azioni in modo incondizionato con le regole di hard deny in modalità auto.
- [Settimana 18 · 27 aprile – 1 maggio 2026](https://code.claude.com/docs/it/whats-new/2026-w18.md): Claude Code su Windows funziona senza Git Bash, claude auth login accetta un codice OAuth incollato quando il callback del browser non può raggiungere localhost, claude project purge pulisce lo stato locale per progetto, e incollare un URL di PR in /resume trova la sessione che l'ha creata.
- [Settimana 17 · 20–24 aprile 2026](https://code.claude.com/docs/it/whats-new/2026-w17.md): /ultrareview si apre come anteprima di ricerca, riepiloghi automatici della sessione quando tornate a un terminale, temi di colore personalizzati che potete creare e distribuire nei plugin, e un Claude Code riprogettato sul web.
- [Settimana 16 · 13–17 aprile 2026](https://code.claude.com/docs/it/whats-new/2026-w16.md): Claude Opus 4.7 con il nuovo livello di sforzo xhigh, Routines su Claude Code sul web, notifiche push mobili che avvisano il vostro telefono quando Claude ha bisogno di voi, un breakdown di /usage che mostra cosa sta guidando i vostri limiti, e binari nativi che sostituiscono il JavaScript raggruppa…
- [Settimana 15 · 6–10 aprile 2026](https://code.claude.com/docs/it/whats-new/2026-w15.md): Pianificazione cloud Ultraplan, lo strumento Monitor con /loop auto-paced, /team-onboarding per confezionare la vostra configurazione, e /autofix-pr dal vostro terminale.
- [Settimana 14 · 30 marzo – 3 aprile 2026](https://code.claude.com/docs/it/whats-new/2026-w14.md): Computer use nella CLI, lezioni interattive nel prodotto, rendering senza sfarfallio, override della dimensione dei risultati MCP per strumento e eseguibili plugin su PATH.
- [Settimana 13 · 23–27 marzo 2026](https://code.claude.com/docs/it/whats-new/2026-w13.md): Modalità auto per permessi senza intervento, computer use integrato, auto-fix PR nel cloud, ricerca trascrizioni e uno strumento PowerShell per Windows.

### Risorse

#### Risorse

- [Aspetti legali e conformità](https://code.claude.com/docs/it/legal-and-compliance.md): Accordi legali, certificazioni di conformità e informazioni sulla sicurezza per Claude Code.
