# LingoSwap

LingoSwap is a recovered, mobile-first voice translation PWA. The original product source was missing, so this repository now contains a clean restoration of the core experience.

## Restored now

- Two-person translation screen with independent language selectors
- Browser speech recognition with interim text when supported
- Approx. 2-second silence gate before automatic translation
- Server-side translation endpoint (MyMemory fallback; no secret exposed in the browser)
- Browser speech synthesis for translated playback
- Local conversation history, save/rename/delete, and transcript export
- Meeting transcript mode with elapsed timer and saved meeting history
- Dark/light themes, haptics, earcons, transcript logging, auto-handoff preference
- Installable PWA manifest/service worker shell
- Responsive mobile and desktop UI with graceful unsupported-browser states

## Intentionally not faked

The original report described cloud auth, subscription billing, ElevenLabs/OpenAI premium TTS, cloud meeting persistence and recorded audio exports. Those integrations are not represented as working until their services, secrets, and database policies are connected.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Production notes

The translation route currently uses the public MyMemory endpoint as a recovery fallback. For production scale, replace that provider behind `app/api/translate/route.ts` with a contracted translation service or AI provider, add rate limiting, and add privacy/retention controls appropriate to your use case.

For speech recognition, Chromium-based browsers currently provide the strongest Web Speech API support. Typed translation continues to work when speech recognition is unavailable.

## Deployment

This repo is ready for Vercel or another Next.js-compatible host. Do not point the LingoSwap deployment at an unrelated repository. Keep production secrets in host environment variables, never in this repository.
