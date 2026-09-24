# LingoSwap Recovery Audit

## Critical finding
The production project named `lingoswap` was deploying the unrelated `pawnkerz/jadogo` repository. The original `pawnkerz/LingoSwap` repository existed but contained no source files.

## Recovery scope
- Rebuilt the core two-person translation interface.
- Restored browser speech recognition with a silence-submit flow.
- Added server-side translation routing and browser speech playback.
- Restored local conversation history, meeting transcripts, export, settings, theme, and PWA shell.
- Added graceful unsupported-browser and unavailable-feature states.

## Deliberately pending
Cloud authentication, cloud persistence, Stripe billing, premium TTS providers, and reliable meeting audio capture require their external services/configuration and are not presented as working until connected.

## Deployment requirement
The Vercel project for LingoSwap must point to `pawnkerz/LingoSwap`, not `pawnkerz/jadogo`.
