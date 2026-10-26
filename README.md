# Evolve Inbox

A small web inbox for mail sent to your own domain. Forward Email receives SMTP mail and posts parsed messages to a secret webhook. A Netlify Function stores them in Netlify Blobs and serves a password-protected reader at `/mail`.

This is the inbox built for EvolveTech, extracted into a deployable Apache 2.0 project. It receives email; sending, SMTP submission, IMAP and POP3 are not implemented.

[Try the public demo](https://www.evolvetech.dev/play/evolve-inbox/) · [Project page](https://www.evolvetech.dev/projects/evolve-inbox/)

The demo uses three fictional messages and reserved example domains. It is read only and makes no mailbox API requests. The live EvolveTech mailbox requires its own password.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/anthony-firn/evolve-inbox)

## What it does

- Receives mail for individual aliases or a whole domain through Forward Email webhooks.
- Shows HTML mail in a sandboxed frame, with a plain-text view and downloadable attachments.
- Displays the SPF, DKIM and DMARC results reported by the forwarding provider.
- Uses a responsive reader with light and dark themes, refresh and message deletion.
- Searches subjects, senders, recipients and previews, with a filter for attachments.
- Generates private setup files and checks DNS, API authentication and deployed storage.
- Preserves concurrent inbox updates and deduplicates retries that have a matching Message-ID, content and recipients.
- Keeps the inbox password in the browser tab's session storage, with a Lock button to clear it.

## Try it locally

Use Node 22 or later:

```sh
npm ci
npm test
npm run build
npm run preview
```

Open `http://localhost:4194/`. This runs only the public demonstration. It neither receives mail nor connects to production storage.

The `createInbox` factory accepts storage and settings functions; the tests run the complete webhook and authenticated API against an in-memory store.

For the browser checks, run `npx playwright install chromium` once, then `npm run test:e2e`. They exercise the reader, attachments, mobile layout, read-only demo controls and isolation of untrusted HTML. An installed Chrome can be used with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` instead.

## Deploy your own inbox

Fork the repository and connect it to Netlify, then run this in your local clone with your own domain and production site URL:

```sh
npm ci
npm run setup -- --domain example.com --site https://your-inbox.netlify.app --label "My Inbox"
```

The setup command generates independent secrets and creates private `.env` and `.mail-setup.md` files with your exact forwarding instructions. It does not print secrets, overwrite existing settings or change DNS. The default alias is `hello`; use `--alias support` for another address or explicitly choose `--alias '*'` for a catch-all.

1. Import `.env` into Netlify's private environment settings with Functions scope and production context, then redeploy.
2. Follow `.mail-setup.md` to configure a private Forward Email alias or encrypt the complete DNS forwarding rule before publishing it. Review existing mail routing before changing MX records.
3. Open `https://YOUR-SITE.netlify.app/mail` and unlock with `MAIL_PASSWORD` from `.env`. The root page `/` remains the fictional demo.
4. Run `npm run doctor` to check DNS, password protection and authenticated storage access. Then send a real message from another account to verify delivery, content and attachments.

See the [complete setup guide](docs/setup.md) for settings, DNS records, troubleshooting, outbound mail and upgrading an existing installation. Both generated files contain private settings and are ignored by Git; keep them private. The doctor is read only and does not verify SMTP delivery.

[Forward Email's webhook reference](https://forwardemail.net/en/faq#do-you-support-webhooks) describes the parsed JSON payload. [Netlify's Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) describes the site-wide storage used here. The project does not provision a domain, forwarding subscription or paid hosting. Provider usage limits and pricing still apply.

## Storage and access

Mail is kept in the site-wide `mail` store, with one `msg/<id>` object per message and an `index` object for the inbox list. Site-wide storage survives deployments. The list shows the newest 2,000 messages; older message objects are not automatically deleted.

The reader and message API use `MAIL_PASSWORD`. Webhook delivery uses the independent `MAIL_HOOK_SECRET` in its URL. There are no credentials embedded in the reader page or demo. HTML mail is sandboxed and receives a policy that blocks scripts and remote images. The page also sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and a restrictive Content Security Policy. Parsed webhook JSON is limited to 5,000,000 bytes; hosting limits also apply.

Index updates use conditional writes with bounded retries, and storage failures return HTTP 503 so the forwarding provider can retry. Retries with the same Message-ID, content and recipients reuse the original message and receipt time. Messages without a Message-ID cannot be reliably deduplicated. Existing storage remains readable without migration; writes to multiple objects are not a transaction.

This is a small, single-owner inbox. It has one shared password, no second factor, no account system, no outbound mail, no automated retention and no application-level rate limiter. Search covers the loaded metadata, not full message bodies. Messages are not end-to-end encrypted: the forwarding provider and the hosting account can access them. Attachments are downloadable files, not malware-scanned by this app. It is not a replacement for a full mail platform.

## API

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| `GET /mail` | Unlock in the reader | Inbox interface |
| `GET /mail/api/messages` | `Authorization: Bearer MAIL_PASSWORD` | Message metadata |
| `GET /mail/api/status` | Same | Storage access, inbound configuration and latest receipt |
| `GET /mail/api/messages/<id>` | Same | Message body and attachments |
| `DELETE /mail/api/messages/<id>` | Same | Delete one message |
| `POST /mail/hook/<secret>` | Webhook secret | Receive a parsed Forward Email message |

## Source

`src/inbox.mjs` contains the handler and shared reader; `src/incoming.mjs` validates deliveries and `src/mail-store.mjs` handles conditional storage updates. `netlify/functions/mail.mjs` wires it into Netlify. `tools/setup.mjs` and `tools/doctor.mjs` provide setup and diagnostics. `demo/messages.mjs` contains only fictional fixtures. `tools/build-demo.mjs` builds the static demo from the same reader, extracting CSS and JavaScript into separate files for a strict host policy.

EvolveTech's original function lives in the [website repository](https://github.com/anthony-firn/evolvetech.dev). This standalone repository contains no mailbox exports, account passwords, webhook secrets or production provider settings.

## License

Apache License 2.0. Copyright 2026 Anthony Firn.
