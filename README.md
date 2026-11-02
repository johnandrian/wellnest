# Wellnest — AI health assistant (CalHacks2026)

Chat in the app (web + iOS + Android, Expo) or text the Telegram bot, by typing or by voice. See `plan2.md`.

## Layout
- `App.tsx`, `src/` — Expo app: sign-in, chat, settings (language, notifications, "Text me on Telegram").
  - `health.ios.ts` + `useHealthSync.ts` + `HealthSettings.tsx` — Apple Health on iPhone (see below); `health.ts` is the web/Android stand-in.
  - `VisitPanel.tsx` + `printable.ts` — the doctor-visit summary panel (clipboard button), with share / print-to-PDF.
  - `RemindersPanel.tsx` — medication reminders (pill button); reminder messages in the chat get Taken / Skip buttons.
  - `photo.ts` — pick or take a photo, shrink it to 1600px, upload it to Convex file storage.
  - `AboutPanel.tsx` — "What Wellnest knows about me" (Settings): saved facts, stored data, sharing, export, delete.
  - `i18n.ts` — the chat screen's words in English, Spanish and Greek.
  - `useVoice.ts` — the mic: Cartesia STT → send; replies to spoken questions → Cartesia TTS. `speaker.web.ts` / `speaker.ts` — streaming playback on web / iOS + Android (see Voice below).
- `convex/` — backend.
  - `pipeline.ts` — shared pipeline: Jina embed → vector search memory → Cortex triage → Cortex core model + tools → reply.
  - `chat.ts` — app API. `telegram.ts` + `http.ts` — Telegram webhook, account linking and voice notes.
  - `voice.ts` — Cartesia tokens for the app, and `/tts` (a streamed MP3 of a reply, for iOS/Android).
  - `lib/` — Cortex, Jina, Telegram, Cartesia (`cartesia.ts`) clients, `speech.ts` (Markdown → speakable text), and model tools (`web_search`, `read_page`, `bio_research`).
  - `creao.ts` + `lib/creao.ts` — detailed symptom analysis by the CREAO agent (see below).
  - `shop.ts` + `lib/shopping/` — Health Supply Shopper: Amazon and Walmart links for OTC health supplies (see below).
  - `health.ts` + `lib/health.ts` — Apple Health daily summaries: sync API, `get_health_data` text, CREAO fields.
  - `visit.ts` + `lib/visit.ts` — doctor-visit summaries (see below).
  - `reminders.ts` + `lib/reminders.ts` — medication reminders: schedules in the user's time zone, dose history (see below).
  - `me.ts` — saved facts (`remember_fact` / `forget_fact`), the data overview, JSON export and deletion (see below).
  - `lib/language.ts` — reply/voice languages (English, Spanish, Greek) and the fixed messages in each.
  - `lib/jev.ts` — routes each message: shopping, symptom analyzer, or regular.
- `creao/` — the CREAO agent bundle: `SKILL.md` (its program), `config.yaml` (form fields, memory), `README.md`.

## Live
- **Web app:** https://merry-capybara-181.convex.site (Expo web build served by Convex static hosting, on the dev deployment). Redeploy with `npm run deploy:web`.
- **Telegram:** [@calhacks2026_bot](https://t.me/calhacks2026_bot).

## Run
```bash
npm install
npx convex dev          # backend (writes EXPO_PUBLIC_CONVEX_URL to .env.local)
npx expo start --web    # or press i / a for iOS / Android
```
Voice recording needs a development build on native (`npx expo run:ios`), not Expo Go.

## Convex env vars (`npx convex env set NAME value`)
| Var | What |
|---|---|
| `SNOWFLAKE_ACCOUNT_URL` | `https://<account-identifier>.snowflakecomputing.com` |
| `SNOWFLAKE_PAT` | Snowflake programmatic access token |
| `CORTEX_SHOPPER_MODEL` / `CORTEX_CORE_MODEL` | optional, default `claude-haiku-4-5` / `openai-gpt-5.4` (core must be a Claude/OpenAI model for tools) |
| `CORTEX_VISION_MODEL` | optional; the model for turns with a photo (must accept images; default: the core model) |
| `JINA_API_KEY` | embeddings, search, reader |
| `CARTESIA_API_KEY` | voice (the app's mic and Telegram voice notes); optional `CARTESIA_VOICE_ID` (default: the Sonic voice `db6b0ed5-…`), and `CARTESIA_VOICE_ID_ES` / `CARTESIA_VOICE_ID_EL` for a different voice in Spanish / Greek |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | bot |
| `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` | Convex Auth (`npx @convex-dev/auth` sets these) |
| `CREAO_API_KEY` | `capi_...` key from the CREAO agent's page on agent.creao.ai |
| `CREAO_WEBHOOK_SECRET` | any long random string; goes in the webhook URL so only CREAO's callbacks are accepted |
| `CREAO_APP_ID` | optional, defaults to the Symptom & Biosensor Health Analyzer (`4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c`) |
| `JEV_API_KEY` | TypeSafe Jev key; routes each message (optional `JEV_MODEL`, default `jev-latest`) |
| `CORTEX_SHOPPER_MODEL` | optional; the Snowflake model that reads shopping requests (default: the triage model) |

## Apple Health
The iPhone app reads **daily summaries** from HealthKit and syncs them to `healthDays` (one row per user per local day): steps, active energy, resting heart rate, HRV (SDNN), sleep (asleep time, overlapping watch/phone logs merged), breathing rate, SpO2, sleeping wrist temperature, weight, and menstrual flow. Raw samples never leave the phone. Cycle apps like Flo, Clue and the Health app itself write flow logs to Apple Health, so period data comes along without a Flo integration; Garmin, Oura and Whoop also copy much of their data there.
- **Sync:** Settings → Apple Health → Connect asks iOS for read access and sends the last 90 days. After that the app re-syncs when opened or brought back (at most every 30 minutes): the days since the last sync plus two before, because watch data arrives late.
- **Model:** once connected, the core model gets a `get_health_data` tool (1-90 days). It returns averages, the last 3 days compared to the days before, cycle facts (period starts, cycle day, average length), and one line per day.
- **CREAO:** summaries go to a symptom analysis only if the user turns on "Include in symptom analyses". Then empty `biosensor_data`, `cycle_data` and `last_period_start` fields are filled from the last 14 days (vitals) and 90 days (cycle).
- **Disconnect:** removes the link and deletes every synced day. Web and Android show the status and can disconnect, but can't connect (HealthKit exists only on iPhone).
- **Building:** HealthKit doesn't work in Expo Go. Build a development client with EAS (`eas.json` is set up; needs an Apple Developer account): `npx eas-cli build --profile development --platform ios`, install it on the iPhone, then `npx expo start --dev-client`. The bundle id is `health.talktothebeak.wellnest` (`app.json`); change it if you prefer another.

### Android: Health Connect
On Android the same sync reads **Health Connect** (`src/health.android.ts`), where Samsung Health, Fitbit, Garmin, Oura, Google Fit and cycle apps write their data: steps, active calories, resting heart rate, HRV (RMSSD here; iPhone gives SDNN), sleep sessions minus awake stages, breathing rate, SpO2, weight and menstrual flow. There's no wrist temperature on Android. Rows and the link record `source: "health_connect"`. It needs the Health Connect app (built in from Android 14), a development build, the read permissions listed in `app.json`, and `minSdkVersion` 26 (set with `expo-build-properties`).

## Doctor-visit summary
A one-page Markdown summary to bring to an appointment: reason, main concerns, a dated timeline, symptoms (onset, frequency, severity, triggers, what helps), medications, notable Apple Health trends, earlier CREAO analyses (labelled AI-generated) and questions to ask. The core model writes it in the patient's voice from **only** the material it's given: the chat for the chosen period (14, 30 or 90 days; store-link messages and anything hidden by Clear chat are left out), completed CREAO reports, Apple Health summaries if connected, and the user's medications.
- **App:** the clipboard button opens the panel: optional reason, period, "Write my summary". The result can be shared (iOS/Android share sheet), printed or saved as PDF (web opens a print-ready page), copied, regenerated or deleted. Only the latest one is shown.
- **Chat:** "prepare me for my doctor's appointment" makes the model call `prepare_visit_summary`. In the app a note says it's ready; on Telegram the summary itself is sent.
- **Limits:** one at a time, 5 a day.

## Medication reminders
Each due dose posts a reminder message in the app chat ("💊 Time for your **Ibuprofen** (400 mg). Due 8:00 PM.") with **Taken** / **Skip** buttons; answers go to `doseLogs` and can be changed. Reminders aren't embedded for memory and aren't read aloud. They're in-app only, not sent on Telegram.
- **Schedules:** daily at set local times (up to 8), or every N hours (1-72) from the first dose; optionally for a course of N days (a dose due at the very end isn't sent). Up to 20 active reminders.
- **Time zones:** the app reports the device's IANA zone (`chat.setTimeZone`) on start; daily times follow it across daylight saving. Until the app has been opened, times are UTC (the model says so). A fixed UTC offset is the fallback if the runtime can't resolve the zone.
- **Scheduling:** one scheduled function per reminder (`fire`), which posts the message and schedules the next dose. Stopping cancels it; stale jobs are ignored.
- **Chat:** "remind me to take ibuprofen 400 mg every 6 hours for 3 days" → `set_medication_reminder`; "stop my ibuprofen reminders" → `cancel_medication_reminder`. The model sees the user's current reminders, and visit summaries get them with the last 30 days of Taken / Skip.

## Photos
Ask about a photo: a pill bottle, a prescription label, lab results, a rash or a wound.
- **App:** the camera button picks from the library (web) or takes / picks a photo (iOS/Android). It's shrunk to at most 1600px, uploaded to Convex file storage with a one-time upload URL, claimed by the uploader (`chat.claimUpload`), then sent with the message; `send` only accepts the sender's own unused upload of an image under 8 MB. The chat shows the photo in the bubble.
- **Telegram:** photos (the largest size up to 1600px) and images sent as files, with the caption as the question. They're stored the same way, so the app shows them too. Over 8 MB or over the daily limit is refused before downloading.
- **Model:** the photo goes to Cortex as an image content part (a base64 data URL) with that turn only, using `CORTEX_VISION_MODEL` (default: the core model). The system prompt asks it to read labels exactly and say when text is unreadable, to describe skin/wound photos without diagnosing and list what would make them urgent, and never to identify people. Later turns see "[sent a photo]" in the history, not the image.

## What Wellnest knows about me
Settings → **What Wellnest knows about me** shows, in one place:
- **Saved facts:** lasting health facts (allergies, conditions, regular medications...) that go into the system prompt on every turn and into visit summaries. The model saves them with `remember_fact` and removes them with `forget_fact` ("I'm not allergic to penicillin after all"); the user can add, edit and remove them. Up to 50, each labelled "saved by Wellnest" or "added by you".
- **Profile and what's stored:** email, location, time zone, voice and Telegram status, and counts of messages (with the date of the first), photos, symptom analyses, Apple Health days, reminders and Taken / Skip answers, and visit summaries. Counts above 200 show as "200+".
- **Who sees what:** which outside services get which data (Snowflake Cortex, Jina, Cartesia, Jev, CREAO, Telegram).
- **Export:** everything as JSON (messages without embeddings; photos listed by storage id). Web downloads a file; iOS/Android open the share sheet.
- **Delete:** per category (messages with their photos and analyses; Apple Health; reminders, with their scheduled jobs cancelled; visit summaries; saved facts) or **everything**, which also deletes the auth sessions, accounts and the user, then signs out. Rows are deleted in batches of 200 by a self-rescheduling mutation. Clear chat still only hides messages; this is where they're actually deleted.

## Languages
Wellnest speaks **English, Spanish and Greek**. The user picks one in Settings, or on Telegram with `/language en|es|el`; a new Telegram user starts in their Telegram app's language if it's one of these.
- **Replies:** the core model is told to answer in that language unless the user writes in another one, using everyday words plus the common name of medical terms.
- **Voice:** Cartesia STT (ink-whisper) and Sonic TTS get the language: the app's token carries it (`voice.token`), and `/tts` and Telegram voice notes read it from the user. One Sonic voice speaks all three unless `CARTESIA_VOICE_ID_ES` / `_EL` is set. Cut-short speech ends with "the rest is in the text" in that language.
- **Also translated:** medication reminder messages (local time format), visit summaries (written in that language), the daily-limit and error replies, and the chat screen itself (welcome, starter questions, placeholders, Taken / Skip). The panels and Settings are still English.

## Push notifications
iOS and Android get push notifications (Expo push) for **medication reminders** (with Taken / Skip buttons right on the notification) and **telehealth appointment updates**. Each kind can be turned off in Settings.
- **Setup:** push needs a development or store build with an EAS project id (`npx eas-cli init` writes it to `app.json`). Optional `EXPO_ACCESS_TOKEN` on the Convex deployment if you turn on Expo's enhanced push security. Web has no push; reminders still show in the chat.
- **Devices:** each phone registers its token in `pushTokens` (up to 10 per user; a phone that signs in to another account moves to it). Signing out removes it; tokens Expo reports as `DeviceNotRegistered` are dropped.

## Symptom journal
When someone tells Wellnest how a symptom is ("my headache's a 6 today", "cramps were bad yesterday"), the model logs it with `log_symptom`: one entry per symptom per local day (a second report that day updates it), severity 0-10, an optional note. The **Health tools** button (pulse icon) opens tabs for the Journal, Reminders and the Visit summary.
- **Journal tab:** a severity bar chart per symptom for 14, 30 or 90 days, with Apple Health sleep (dark when under 6 h) and period days underneath; per-symptom summaries (days logged, average, latest, getting better or worse); and patterns such as "Headache averaged 7/10 on days with under 6 h of sleep vs 3/10 otherwise", shown only with at least 3 days on each side and a 1.5-point gap, and labelled as associations, not causes. Entries can be added or removed by hand.
- **Model and summaries:** `get_symptom_journal` gives the model the same summaries, patterns and entries; visit summaries include them. The journal can be deleted from "What Wellnest knows about me".

## Proactive check-ins
An hourly cron (`checkins.scan`) looks at each Apple Health user whose local time is 9 AM and compares their last few days with their own previous two weeks. If something changed, Wellnest posts one gentle question in the chat, never a diagnosis, for example: resting heart rate and wrist temperature up together ("your body may be fighting something off"), a temperature or breathing-rate jump, lower blood oxygen (flagged urgent), a heart rate rise, three short nights, an HRV drop, or much less activity. At most one check-in a day, the same kind at most every 3 days, only with at least 5 days of history and data from yesterday or today. Replies go through the normal chat, so symptoms get logged in the journal. Settings has a switch to turn check-ins off; they don't send push notifications.

## Telehealth video visits
When something needs a clinician but isn't an emergency (likely needs a prescription or test, symptoms lasting too long, a question for a prescriber, or the user asks), the model calls `suggest_telehealth`, or the user taps **Find a video visit** in the Care tab. Wellnest finds three times from the provider and posts them in the chat as buttons, with a push notification. **Nothing is booked until the user taps a time and confirms**; the confirm dialog says what's shared (the reason, plus today's visit summary if they made one). After booking: a push, a **Join** button in the chat and Care tab, a push 15 minutes before (tapping it opens the visit link), and **Cancel visit** (cancels with the provider; if that fails it stays booked and says so).
- **Never for emergencies:** when triage flags a message as urgent, the tool isn't offered and a call is refused; the model sends people to 911 / the ER with `find_care`.
- **Limits:** one open request at a time, 3 a day; offered times expire after 2 hours.
- **Providers** (`convex/lib/telehealth.ts`): there's no public booking API across telehealth companies (Teladoc, Amwell, Sesame and others offer partner APIs that need an agreement), so providers sit behind a small interface. `TELEHEALTH_PROVIDER=test` (the default) makes up times and bookings, labelled "Test provider: nothing real is booked". `TELEHEALTH_PROVIDER=http` talks to any service that speaks this contract, such as a partner API or a thin proxy in front of one: `GET /slots`, `POST /bookings`, `DELETE /bookings/{id}`, with `TELEHEALTH_API_URL`, `TELEHEALTH_API_KEY` and an optional `TELEHEALTH_PROVIDER_NAME`.

## Find care nearby
The **Care** tab (Health tools) lists the nearest urgent care, ERs, pharmacies or doctors with distance, address, hours (open 24/7 called out), a **Call** button and **Directions** (opens Google Maps or the phone's maps app), above a big "Call 911" button (112 in Greek). It searches around the phone's current location when "Use my current location" is ticked (expo-location, asked only then), otherwise around the saved location, which is geocoded once and kept on the user (`users.locationPoint`) until it changes.
- **Data:** OpenStreetMap, free and keyless: Nominatim for geocoding, Overpass for places (`convex/lib/places.ts`), with a descriptive User-Agent. Coverage and hours vary by area, so the app says to call first.
- **Model:** `find_care` gives the same list as Markdown with `tel:` call links and directions links. Urgent messages are told to call it (ER for anything life-threatening, otherwise urgent care) instead of searching the web. The app's Markdown opens `tel:` links; Telegram shows the number as text.

## Routing (Jev)
Before the model runs, `convex/lib/jev.ts` asks Jev yes/no questions about the message (plus the assistant's previous message):
- **Shopping (proactive):** a period, headache, allergies, low diabetes supplies, post-surgery... The shopper picks the approved items and its store links are shown under the reply. Nothing is bought: the user checks out themselves. Skipped for emergencies.
- **Symptom analyzer:** only with the user's OK. If they want to know what's causing their symptoms, the model offers the CREAO analysis; `analyze_symptoms` is only given to the model once they ask for it outright or say yes (offer lasts 30 minutes).
- **Regular:** everything else goes to the assistant as before. If Jev is down, everything takes this path.

## CREAO symptom analysis
**Agent:** Symptom & Biosensor Health Analyzer, agent ID `4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c`, built on agent.creao.ai (bundle in `creao/`).
**Try the agent:** https://agent.creao.ai/install/4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c?version=44a07c43-9e4d-450f-9265-1862ba775e56

Once the user OKs it (see Routing), the core model calls `analyze_symptoms`. That starts a CREAO run in the background through the API Trigger, and the report (1-3 ranked conditions, red flags, care guidance, disclaimer) arrives a few minutes later as its own message, in the app or on Telegram.
- **Finishing:** CREAO calls `/creao` on the Convex site when the run ends. The webhook URL carries `CREAO_WEBHOOK_SECRET`, and the result is always re-fetched from CREAO rather than trusted from the webhook body. Polling every minute (up to ~20 minutes) covers missed webhooks and local deployments, which CREAO can't call back.
- **Limits:** one analysis at a time per user and 3 a day, since every run spends CREAO credits.
- **Privacy:** the symptoms and any health data the user shared are sent to CREAO. The model is told to say so when it starts a run.

## Health Supply Shopper
Finds over-the-counter health supplies: picks the cheapest approved items that follow the user's rules, then sends Amazon and Walmart links for each one plus a one-tap link per store that fills the user's own cart. We never buy or pay; the user checks out. Runs inside Convex (`convex/shop.ts`, logic in `convex/lib/shopping/`); try it directly with `npx convex run shop:chat '{"text": "restock my period kit today"}'`.

| Kit | Example | Items (priority order) |
|---|---|---|
| Diabetes care | "My sensor is almost out, restock my diabetes kit" | Dexcom Stelo OTC CGM, Dex4 glucose gel, alcohol prep pads, lancets, sensor overpatches |
| Allergy and air quality | "AQI is bad, restock my allergy kit today" | Loratadine 10 mg, NeilMed saline spray, HEPA filter, inhaler spacer |
| Post-surgery recovery | "Day 3 after knee surgery, need wound supplies" | Telfa pads, paper tape, cold pack, Voltaren gel, TheraBand |
| Period care | "Cramps are starting, get my period kit today" | ThermaCare heat wraps, Advil, magnesium glycinate, dark chocolate |
| Headache relief | "I have a pounding headache, get me something" | Acetaminophen 500 mg, Liquid I.V., Be Koool cooling sheets |

**How it works**
1. **Reads the request with Snowflake Cortex** (`lib/shopping/understanding.ts`): kit, items, urgency (within 2 hours / today / 3 days), budget, place. Keyword rules take over if the model is down. The model can only read: the safety rules re-run on the user's exact words, and it can't add products or raise a budget.
2. **Checks live air quality** (Open-Meteo) for allergy orders. At US AQI 101+, the HEPA filter can't be dropped and delivery moves up to today.
3. **Builds the cheapest valid kit** at catalog list prices. Over budget: optional items are dropped from the bottom of the list.
4. **Finds each item at Amazon and Walmart** (`lib/shopping/links.ts`) with Jina web search, limited to each store's site. Only a product page whose title matches the approved product (brand or ingredient, and strength) counts; no store page is loaded or scraped.
5. **Sends the links**: one per item per store (a store search link if no match was found), plus one-tap cart links (Amazon `gp/aws/cart/add.html`, Walmart `affil.walmart.com/cart/addToCart`) that put every found item in the user's own cart.

**Safety rules (in code):** no prescription items (and no OTC swap for one you asked for); never over the stated budget or the profile's cap for that kit; no substitutions (only the exact SKU, brand, or ingredient + strength in the profile); nothing is ever bought for the user; emergencies get a call-911 reply and no order.

**Simulated:** only the demo user's profile (`lib/shopping/data.ts`).

## Voice (Cartesia)
Voice works everywhere the assistant does. In the app, the mic is always there: tap it, speak, tap the red stop button, and the reply is read aloud as it streams in. Typed questions get text replies only (each message remembers whether it was spoken). On Telegram, just send a voice note: the bot answers in text and with a voice note.

**Cartesia features used**
| Feature | Where | How |
|---|---|---|
| **Sonic TTS over WebSocket** (`sonic-3.6`, raw `pcm_f32le`, 44.1 kHz) | Web app | `src/speaker.web.ts` keeps one WebSocket open and plays each audio chunk as it arrives (Web Audio, scheduled back to back), so speech starts after the first chunk instead of after the whole reply. The next reply is generated while the current one plays; **Stop** cancels the context at Cartesia. |
| **Sonic TTS, streamed bytes** (`/tts/bytes`, MP3) | iOS/Android app, Telegram | The app plays `GET /tts?message=<id>`, which Convex streams straight from Cartesia, so playback starts early. Telegram gets the MP3 as a voice note (`sendVoice`). |
| **Batch STT** (`ink-whisper`) | App mic, Telegram voice notes | The app sends its recording (WebM, MP4 or M4A); Convex sends Telegram's Ogg/Opus voice notes. |
| **Access tokens** (`/access-token`, STT + TTS grants, 5 minutes) | App | `voice.token` mints one for a signed-in user, so the API key never ships in the app. |

**How a voice turn works**
1. **In:** the app records with `expo-audio` and calls Cartesia STT with a short-lived token. A Telegram voice note is downloaded by Convex (`getFile`) and transcribed with the server key.
2. **Same pipeline:** the transcript runs through routing, memory, shopping and the model exactly like typed text.
3. **Out:** `convex/lib/speech.ts` turns the Markdown reply into speakable text (no URLs, symbols or "Sources:" lists; long replies stop at a sentence and say the rest is in the text). Store links are shown but never read aloud.

**Safety, privacy and accessibility**
- The Cartesia API key stays in Convex. The app only gets 5-minute tokens, and `/tts` only speaks the signed-in user's own replies.
- Audio isn't stored: recordings and voice notes are sent to Cartesia for transcription and only the text is kept, like a typed message. The Telegram reply quotes what was heard, so a mistranscription is easy to spot.
- Voice notes over 3 minutes, or past the daily message limit, are turned away before any audio is downloaded or sent to Cartesia.
- The Mic button shows every step (waiting for permission, listening, transcribing, speaking), announced to screen readers on web and Android, explains blocked or missing microphones (with Open Settings on iOS/Android), and stops itself after 2 minutes. Spoken replies can be stopped at any time, and leaving the screen discards a recording in progress.
- Speech is optional: if Cartesia fails, the text reply is always there.

**Setup**
1. Create a key at [play.cartesia.ai](https://play.cartesia.ai) and run `npx convex env set CARTESIA_API_KEY sk_car_...` (optionally `CARTESIA_VOICE_ID`).
2. Web: open the app over https (or localhost) and sign in. The browser asks for the microphone on the first tap of the mic button.
3. iOS/Android: voice needs a development build (`npx expo run:ios` / `npx expo run:android`); Expo Go can't record.
4. Telegram: nothing extra; voice notes work once the bot's webhook is set (see below).

**Known limitations**
- STT is batch, not real-time: the transcript comes after you tap Stop, not while you speak, and there's no voice barge-in (tap Stop instead).
- English only (`language: "en"` for STT and TTS).
- On iOS/Android, replies stream as MP3 through Convex (one extra hop) rather than over the WebSocket, because the app can't play raw PCM there. Voice on a real phone still needs testing.
- Web browsers only allow sound after a tap on the page; tapping Send or Mic unlocks it.
- Spoken replies are capped at about 2,500 characters (about 3 minutes of speech).

## Telegram setup
1. `@BotFather` → `/newbot` → token.
2. Register the webhook (needs a public Convex deployment, not local):
   ```bash
   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://<app>.convex.site/telegram&secret_token=$SECRET"
   ```
