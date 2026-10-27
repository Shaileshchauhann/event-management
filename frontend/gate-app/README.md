# gate_app

Flutter mobile application for gate keepers to scan event ticket QR codes.

The camera decodes ticket QR values locally. Live `/verify` calls require a
secure server-side proxy because the deployed API endpoint requires an API key.
