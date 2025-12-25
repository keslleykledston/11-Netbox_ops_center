1. Seed the Movidesk application record on bootstrap so the UI always has the integration to configure.
2. Extend the Prisma schema with `autoSyncEnabled` and `lastSyncAt` plus a migration so the application row can track status metadata.
3. Tie the HUB sync loop to the stored `autoSyncEnabled` flag, persist the last-check timestamp, and surface the same info via `/sync/movidesk/status`.
4. Update the Applications screen to surface the switch, last-run timestamp, and auto-sync description while masking the API key and keeping the existing NetBox/Jumpserver controls.
