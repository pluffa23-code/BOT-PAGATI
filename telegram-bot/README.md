# Bot Telegram per scontrini e produzione

Il bot funziona nelle chat private di Telegram. Non include un sito, una dashboard web o pagine pubbliche: moduli, riepiloghi, amministrazione e consultazione dei registri si svolgono nel bot.

## Funzioni

- Registrazione guidata degli scontrini: importo, venditore, acquirente, prodotto, quantità e conferma prima del salvataggio.
- Registrazione della produzione: prodotto scelto da pulsanti, quantità, dipendente e conferma.
- Gestione dei prodotti e degli amministratori direttamente in Telegram.
- Dashboard admin con totali e registri completi consultabili a pagine.
- Sessioni salvate nel database: un riavvio non interrompe un modulo in corso.
- Controllo accessi: le chat di gruppo vengono ignorate; solo gli admin vedono la dashboard.

## Avvio con Docker Compose

1. Copia `.env.example` in `.env`.
2. Inserisci `TELEGRAM_BOT_TOKEN` e il tuo ID numerico in `SUPER_ADMIN_TELEGRAM_ID`. Imposta anche una password PostgreSQL robusta.
3. Avvia il bot e il database:

   ```sh
   docker compose up -d --build
   ```

PostgreSQL applica `migrations/001_initial.sql` al primo avvio del volume dati. I dati restano nel volume `telegram_bot_data` anche quando il container viene aggiornato.

## Avvio senza Docker Compose

Serve Node.js 24 o successivo e un database PostgreSQL raggiungibile.

1. Copia `.env.example` in `.env` e configura le variabili.
2. Applica lo schema una sola volta a un database vuoto:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_initial.sql
   ```

3. Installa le dipendenze e avvia:

   ```sh
   npm install --omit=dev
   npm start
   ```

Se stai aggiornando un database già creato con una versione precedente del bot, applica prima `migrations/002_usernames_and_receipt_quantity.sql`.

Il bundle eseguibile è già incluso in `dist/telegram-bot.mjs`; non serve compilare TypeScript sul server.

## Uso in Telegram

- Invia `/start` al bot per aprire il menu.
- `/scontrino` avvia la registrazione di uno scontrino.
- `/produzione` registra una produzione.
- `/id` mostra il tuo ID numerico da condividere con l'amministratore principale per ottenere i permessi admin.
- `/dashboard` apre i riepiloghi e i registri, solo per gli amministratori.
- `/cancel` annulla la registrazione corrente senza salvare.

L'amministratore principale viene caricato da `SUPER_ADMIN_TELEGRAM_ID`. Da Telegram può aggiungere altri admin; gli admin possono aggiungere prodotti e consultare i registri.

Gli archivi admin e i registri mostrano `@username` quando Telegram lo rende disponibile; altrimenti mostrano il nome Telegram o indicano che lo username non è disponibile. L'ID numerico resta utilizzato solo per assegnare i permessi. La rimozione di un prodotto lo nasconde dai nuovi moduli, senza cancellare i registri storici.

## Note operative

- Avvia una sola istanza del bot per token: Telegram non consente più istanze contemporanee in long polling.
- Se il bot aveva già un webhook configurato, rimuovilo prima di avviare il polling, chiamando una volta `deleteWebhook` nell'API Bot di Telegram. Il programma non modifica automaticamente la configurazione del bot.
- Non condividere il token del bot. Non è incluso in questo archivio.
- Il database contiene i registri, gli admin, i prodotti e le sessioni. L'archivio ZIP contiene solo il codice e lo schema iniziale, non i dati.
