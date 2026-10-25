# Evolve Inbox

A small web inbox for mail sent to your own domain. Forward Email receives SMTP mail and posts parsed messages to a secret webhook. A Netlify Function stores them in Netlify Blobs and serves a password-protected reader at `/mail`.

This is the inbox built for EvolveTech, extracted into a deployable Apache 2.0 project. It receives email; sending, SMTP submission, IMAP and POP3 are not implemented.

[Try the public demo](https://www.evolvetech.dev/play/evolve-inbox/) · [Project page](https://www.evolvetech.dev/projects/evolve-inbox/)

The demo uses three fictional messages and reserved example domains. It is read only and makes no mailbox API requests. The live EvolveTech mailbox requires its own password.

## What it does

- Receives mail for individual aliases or a whole domain through Forward Email webhooks.
- Shows HTML mail in a sandboxed frame, with a plain-text view and downloadable attachments.
- Displays the SPF, DKIM and DMARC results reported by the forwarding provider.
- Uses a responsive reader with light and dark themes, refresh and message deletion.
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

1. Fork this repository and connect it to a Netlify site. The included `netlify.toml` builds the fictional demo into `public/` and deploys the mail function separately.
2. Generate two independent random secrets: `MAIL_PASSWORD` for the reader and `MAIL_HOOK_SECRET` for inbound delivery. For each secret, use a password manager or run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` locally. Store the values in Netlify's private environment settings with the Functions scope enabled. Plans that require all scopes can use all scopes. Redeploy after setting them. No secret belongs in this repository or a DNS record in plaintext.
3. Visit `https://YOUR-SITE.netlify.app/mail` and unlock it with `MAIL_PASSWORD`. An unauthenticated `GET /mail/api/messages` must return HTTP 401.
4. Configure your domain with Forward Email using its [setup guide](https://forwardemail.net/en/faq). Its receiving MX hosts are `mx1.forwardemail.net` and `mx2.forwardemail.net`. Configure a webhook destination of `https://YOUR-SITE.netlify.app/mail/hook/YOUR_MAIL_HOOK_SECRET?raw=false`. The app uses parsed content, so raw MIME is unnecessary.
5. For a catch-all, an example forwarding rule is `forward-email=/^(.*?)$/:https://YOUR-SITE.netlify.app/mail/hook/YOUR_MAIL_HOOK_SECRET?raw=false`. **Encrypt the complete forwarding rule before publishing it in DNS**, using Forward Email's [TXT encryption tool](https://forwardemail.net/en/encrypt), or configure a private alias in its account dashboard. DNS is public; publishing an unencrypted webhook secret would allow forged incoming messages. Review existing aliases before changing live mail routing.
6. Send a real message to the domain from another account. Check delivery, message text, attachments and the reported sender checks in `/mail`. A successful webhook test by itself does not verify MX routing or SMTP delivery.

[Forward Email's webhook reference](https://forwardemail.net/en/faq#do-you-support-webhooks) describes the parsed JSON payload. [Netlify's Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) describes the site-wide storage used here. The project does not provision a domain, forwarding subscription or paid hosting. Provider usage limits and pricing still apply.

## Storage and access

Mail is kept in the site-wide `mail` store, with one `msg/<id>` object per message and an `index` object for the inbox list. Site-wide storage survives deployments. The list shows the newest 2,000 messages; older message objects are not automatically deleted.

The reader and message API use `MAIL_PASSWORD`. Webhook delivery uses the independent `MAIL_HOOK_SECRET` in its URL. There are no credentials embedded in the reader page or demo. HTML mail is sandboxed and receives a policy that blocks scripts and remote images. The page also sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and a restrictive Content Security Policy.

This is a small, single-owner inbox. It has one shared password, no second factor, no account system, no search, no outbound mail, no automated retention and no application-level rate limiter. Messages are not end-to-end encrypted: the forwarding provider and the hosting account can access them. Attachments are downloadable files, not malware-scanned by this app. The shared index uses read-modify-write, so simultaneous deliveries can race; webhook retries can also create duplicates. It is not a replacement for a full mail platform.

## API

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| `GET /mail` | Unlock in the reader | Inbox interface |
| `GET /mail/api/messages` | `Authorization: Bearer MAIL_PASSWORD` | Message metadata |
| `GET /mail/api/messages/<id>` | Same | Message body and attachments |
| `DELETE /mail/api/messages/<id>` | Same | Delete one message |
| `POST /mail/hook/<secret>` | Webhook secret | Receive a parsed Forward Email message |

## Source

`src/inbox.mjs` contains the handler and shared reader. `netlify/functions/mail.mjs` wires it into Netlify. `demo/messages.mjs` contains only fictional fixtures. `tools/build-demo.mjs` builds the static demo from the same reader, extracting CSS and JavaScript into separate files for a strict host policy.

EvolveTech's original function lives in the [website repository](https://github.com/anthony-firn/evolvetech.dev). This standalone repository contains no mailbox exports, account passwords, webhook secrets or production provider settings.

## License

Apache License 2.0. Copyright 2026 Anthony Firn.
