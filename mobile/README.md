# AMS mobile (athlete app)

Expo / React Native app for athletes, operators and study participants (the org's
terminology decides the label): today's questionnaires in under 30 seconds, their own
trends, and wearable connections. iOS and Android, light and dark.

| | |
|---|---|
| Expo SDK | 57 (React Native 0.86, React 19.2, TypeScript ~6.0) |
| Routing | Expo Router, typed routes (`app/`) |
| Data | TanStack Query + `@ams/shared` (`createApiClient`, `queryKeys`, form engine, types) |
| Auth | Access + rotating refresh token in `expo-secure-store` |
| Wearables | Cloud providers via `expo-web-browser` auth sessions; Apple Health / Health Connect / Samsung Health via the Open Wearables React Native SDK (`src/lib/health/`) |
| Charts | Small `react-native-svg` line chart and sparkline |
| Tests | `jest-expo` + `@testing-library/react-native` 14 |

## Screens

| Route | What |
|---|---|
| `(auth)/login` | Email + password |
| `accept-invite` | Deep link `ams://accept-invite?token=...` (or paste the link): shows the invitation, then name + password |
| `select-org` | Shown when the user is an athlete in several orgs; the choice is remembered |
| `account-status` | No athlete profile in any org (staff account), or `GET /me` failed |
| `(tabs)/index` Today | Greeting, today's forms (overdue/due first, then anytime, then done with a check), pull to refresh, health sync chip, trends at a glance |
| `form/[formId]` | The questionnaire as a wizard, one section per screen; submit, success screen |
| `(tabs)/trends` | Athlete-visible metrics over 4 weeks with flags, recent own entries |
| `(tabs)/devices` | Wearable connections, Apple Health / Health Connect card |
| `connect-device` | Cloud provider list and OAuth connect |
| `wearables/connected` | Redirect target of the provider OAuth flow |
| `(tabs)/profile` | Name, org, code, password, reminders (push token), switch org, sign out |

## Set up

```bash
pnpm install                    # at the repository root (pnpm workspace, node-linker=hoisted)
cp mobile/.env.example mobile/.env
```

`EXPO_PUBLIC_API_URL` is the AMS API **as the phone sees it**: your computer's LAN IP, not
`localhost` (`/api/v1` is appended when missing). The API must listen on all interfaces:

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=http://192.168.1.20:8001
# API, e.g. from api/:  uv run uvicorn app.main:app --host 0.0.0.0 --port 8001   (compose already publishes 8001)
```

Without `EXPO_PUBLIC_API_URL` the app uses the dev server's host on port 8001, which is the
right machine whenever Metro and the API run on the same computer. The Android emulator
reaches the host as `10.0.2.2`; the iOS simulator can use `localhost`. The login screen shows
the server it talks to.

## Run

### Expo Go (quickest, no native build)

```bash
pnpm --filter @ams/mobile start      # scan the QR code with Expo Go (same Wi-Fi as the computer)
```

Everything works except:

- **Health sync** (Apple Health / Health Connect): the Devices tab shows "Health sync needs the
  development build". Expo Go has no Open Wearables native module.
- **Push reminders** on Android (Expo Go has no remote push since SDK 53), and on both
  platforms without an EAS project id.
- **The `ams://` scheme**: in Expo Go deep links are `exp://<ip>:8081/--/accept-invite?token=...`;
  or tap "I have an invitation" on the login screen and paste the invitation link.

Cloud wearables (Garmin, Oura, ...) work in Expo Go: the OAuth redirect is
`Linking.createURL("wearables/connected")`, i.e. `exp://.../--/wearables/connected` there and
`ams://wearables/connected` in a build.

### Development build (everything, including health sync)

```bash
cd mobile
npx expo run:ios --device            # or: npx expo run:android
# or with EAS: eas build --profile development --platform ios|android
```

Then `pnpm --filter @ams/mobile start` and open the project from the dev build.

## Health-store sync (Open Wearables React Native SDK)

HealthKit / Health Connect / Samsung Health data goes **directly from the phone to Open
Wearables**. AMS only mints the SDK token: `POST /orgs/{org}/me/wearables/sdk-token` returns
`access_token`, `refresh_token`, `ow_base_url` and `ow_user_id`. The app then calls
`configure(ow_base_url)`, `signIn(ow_user_id, access, refresh, null)`, `requestAuthorization(...)`
and `startBackgroundSync(30)`. On `onAuthError` it asks AMS for a new token and calls
`updateTokens`. Disconnect revokes the Open Wearables connection
(`DELETE {ow}/api/v1/users/{id}/connections/{apple|health_connect|samsung}`) before
`stopBackgroundSync()` + `signOut()`. Sign-out of AMS only stops sync on the device.

All SDK use sits behind `src/lib/health/` (`HealthAdapter`: `isAvailable()`, `connect(orgId)`,
`disconnect()`, `status()`, `startSync()`). The SDK (`open-wearables`) is **not on npm yet**, so
until it is installed:

- Metro (`metro.config.js`) and Jest (`jest.config.js`) resolve `open-wearables` to
  `src/lib/health/ow-sdk-stub.ts`, whose `isAvailable()` is `false`;
- TypeScript uses the declaration in `src/types/open-wearables.d.ts` (the real package's own
  types take over once it is installed);
- `app.config.ts` leaves out the SDK's config plugin, so `expo config` / `expo prebuild` work.

The SDK is also required lazily, so a build that has the JS package but not the native module
(Expo Go) reports "unavailable" instead of crashing.

### Installing the real SDK

1. Clone and build the SDK in `mobile/vendor/` (git-ignored; excluded from tsc, ESLint and
   Jest), pinned to a commit:

   ```bash
   cd mobile
   git clone https://github.com/the-momentum/open-wearables-react-native-sdk vendor/open-wearables-react-native-sdk
   (cd vendor/open-wearables-react-native-sdk && git checkout <commit-sha> && npm install)   # builds build/
   ```

2. Add it as a dependency (still in `mobile/`):

   ```bash
   pnpm add open-wearables@file:./vendor/open-wearables-react-native-sdk
   ```

   pnpm copies the package's published files into `node_modules` (no nested
   `node_modules`, so React Native and Expo resolve to the app's copies). After updating the
   checkout, rebuild it and run `pnpm install --force`. Metro stops using the stub as soon as
   `open-wearables` resolves (Jest always uses the stub), and `app.config.ts` adds the SDK's
   config plugin and the Android minimum SDK:

   ```js
   ["open-wearables", { healthShareUsage: "...", healthUpdateUsage: "..." }],
   ["expo-build-properties", { android: { minSdkVersion: 29 } }]
   ```

3. Android only: publish the native SDK (and the Samsung Health SDK it depends on) to Maven
   Local, on every machine that builds the app, including CI:

   ```bash
   git clone https://github.com/the-momentum/open_wearables_android_sdk
   cd open_wearables_android_sdk && git checkout v0.11.2 && ./gradlew publishToMavenLocal
   ```

4. Generate the native projects and add Maven Local:

   ```bash
   cd mobile && npx expo prebuild --clean
   ```

   In `android/build.gradle`, add `mavenLocal()` as the **first** entry of
   `allprojects { repositories { ... } }`. `prebuild --clean` regenerates `android/`, so add it
   again after every clean prebuild.

5. The SDK states it is built and tested with Expo SDK 54 / React Native 0.81; this app is on
   SDK 57, so check its release notes for newer Expo support before upgrading the pin.

6. Build a development build on a **physical device**: `npx expo run:ios --device` /
   `npx expo run:android`. HealthKit does not work in the iOS Simulator.

7. Server side: AMS needs `OW_APP_ID` / `OW_APP_SECRET` (otherwise `sdk-token` answers 503 and
   the app says health sync isn't set up by the organization), and `OW_PUBLIC_BASE_URL` must be
   reachable from the phone.

### iOS HealthKit notes

- The config plugin sets the `com.apple.developer.healthkit` and
  `com.apple.developer.healthkit.background-delivery` entitlements, the
  `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` texts (from
  `app.config.ts`), `UIBackgroundModes` (`fetch`, `processing`) and the SDK's
  `BGTaskSchedulerPermittedIdentifiers`.
- The App ID (`AMS_IOS_BUNDLE_ID`, default `org.ams.athlete`) must have the **HealthKit**
  capability in your Apple Developer account, and a development team must be selected for
  signing (Xcode → Signing & Capabilities). Free personal teams cannot use HealthKit.
- The plugin **replaces** `UIBackgroundModes`. If you later enable background push
  (`remote-notification`), check `Info.plist` after prebuild and add it back.
- iOS never tells an app which read permissions were granted; the app starts sync either
  way and the athlete manages access in Settings → Health → Data Access & Devices.

## Push reminders

The Profile toggle registers the Expo push token with `POST /me/push-tokens` and removes it
with `DELETE /me/push-tokens/{token}` (also on sign-out). It needs a physical device and an
EAS project id (`EAS_PROJECT_ID`, from `eas init`); on Android a development build with FCM
credentials. A notification whose data carries `form_id` opens that questionnaire.

## Offline

Screens show cached query data while offline (with a banner) and pause refetching until the
network returns. If a submission fails for lack of network, the answers stay in the form and
the screen offers Retry. A durable offline queue is Phase 2 (docs/ROADMAP.md).

## Scripts

| | |
|---|---|
| `pnpm --filter @ams/mobile start` | Metro dev server (`ios` / `android` open a simulator) |
| `pnpm --filter @ams/mobile run:ios` / `run:android` | Native development build |
| `pnpm --filter @ams/mobile typecheck` | Generates the typed-route declarations, then `tsc` |
| `pnpm --filter @ams/mobile lint` | ESLint (typescript-eslint, react-hooks, expo) |
| `pnpm --filter @ams/mobile test` | Jest |

Bundle check without a device: `cd mobile && npx expo export --platform ios --output-dir /tmp/ams-export`.

## Layout

```
app/                     Expo Router routes (thin; they render src/screens)
src/screens/             Screens
src/components/forms/    Questionnaire renderer: useFormWizard (state + @ams/shared engine),
                         FormWizardView (one section per screen), one input per field type
src/components/charts/   LineChart, Sparkline (react-native-svg)
src/components/ui/       Text, buttons, cards, banners, states
src/lib/                 API client wiring, session + gate, health adapter, push, queries, formatting
src/test/                Test helpers: fetch double routed by "METHOD /path", fixtures, router mock
```

Tests drive screens through the real `@ams/shared` API client with a fetch double, so request
paths and bodies are checked against `docs/API.md`; the form renderer is checked against the
schemas and cases in `spec/form-cases.json`.
