# Event Ticket Verification Frontends

Three independent clients for the deployed API:

- `admin-web`: React admin dashboard
- `attendee-web`: React attendee booking and ticket management UI
- `gate-app`: Flutter mobile-first gate scanner

The gate API key is intentionally not included in any client. Use a secure server-side proxy for `/verify` and pass its URL to Flutter with `--dart-define=GATE_PROXY_URL=...` when one is available. The existing `/verify` API-key requirement is therefore an explicit integration boundary.
