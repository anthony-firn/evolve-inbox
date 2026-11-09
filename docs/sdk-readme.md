# Evolve Inbox client

A dependency-free Fetch client and read-only CLI for a compatible Evolve Inbox deployment.
Node 22+ is required for the CLI. The live client also works in modern browsers on the same
origin as your inbox; the server does not enable cross-origin browser access.

Download the versioned package from https://www.evolvetech.dev/developers/inbox/.
This is a downloadable npm-compatible tarball, not a package published to the npm registry.

```sh
npm install https://www.evolvetech.dev/developers/downloads/evolve-inbox-client-0.3.0.tgz
npx evolve-inbox --demo list
```

The demonstration contains fictional mail and performs no network requests. It cannot read or
change the real EvolveTech inbox. A fresh installation needs no account or credentials to try it.

```js
import { createDemoClient } from 'evolve-inbox-client/demo';
const inbox = createDemoClient();
const messages = await inbox.list();
console.log(messages.map(message => message.subject));
```

For your own deployment, use `createClient({ site, password })` from `evolve-inbox-client`.
Supply credentials through the environment on a server, never in committed code or a public bundle.

```js
import { createClient, InboxError } from 'evolve-inbox-client';
const inbox = createClient({ site: process.env.MAIL_SITE, password: process.env.MAIL_PASSWORD });
try {
  const status = await inbox.status({ signal: AbortSignal.timeout(5000) });
  console.log(status.storage);
} catch (error) {
  if (!(error instanceof InboxError)) throw error;
  console.error(error.code, error.status, error.retryAfter);
}
```

Methods are `status()`, `list()`, `get(id)` and `delete(id)`, each with an optional `{ signal }`.
TypeScript declarations accompany the modules. Requests have a timeout, keep credentials in
headers, refuse redirects and make no automatic retries. In particular, a lost deletion response
is not permission to repeat the deletion. Error codes include `unauthorized`, `throttled`,
`unavailable`, `not_found`, `invalid_response`, `network`, `aborted` and `request_failed`.
The client parses JSON but does not fully validate an untrusted server's response schema.

The CLI supports `status`, `list` and `get ID`, with JSON results and a nonzero exit code on error.
For live access set `MAIL_SITE` and `MAIL_PASSWORD` in your process environment. The CLI has no
delete command. Live list/get output contains private mail; keep it out of public logs.

[Source and tests](https://github.com/anthony-firn/evolve-inbox) ·
[Security model](https://github.com/anthony-firn/evolve-inbox/blob/main/docs/security.md)
