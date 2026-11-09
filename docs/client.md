# Programmatic access

Node 22+ or a modern browser with Fetch, AbortSignal.timeout and AbortSignal.any is required. A dependency-free developer tarball is available at [the developer quickstart](https://www.evolvetech.dev/developers/inbox/). It is installable with npm but is not published to the npm registry. You can also install a pinned Git commit or use the source module directly. After cloning and `npm ci`, a TypeScript consumer can import the package's `evolve-inbox/client` export (for an external project, install the local clone with `npm install /path/to/evolve-inbox`).

```ts
import { createClient, InboxError } from 'evolve-inbox/client';

const client = createClient({
  site: 'https://your-inbox.netlify.app',
  password: process.env.MAIL_PASSWORD!, // server-side example; never bundle a secret
});
try {
  const messages = await client.list();
  console.log(`${messages.length} messages`); // keep message data out of public logs
} catch (error) {
  if (error instanceof InboxError) {
    console.error(error.code, error.status, error.retryAfter);
  } else throw error;
}
```

Methods: `list()`, `status()`, `get(id)` and `delete(id)`. Each accepts a final `{ signal }` option. Requests use an HTTPS origin, Bearer header, no-store cache policy, omitted cookies and redirects disabled. The default timeout is ten seconds; configure `timeoutMs` from 1 to 60,000. No tokens appear in URLs. The client does not persist credentials, send telemetry or automatically retry any request, including deletion. Decide explicitly whether to retry a write after a lost response.

`InboxError` has `code`, numeric `status` (0 for transport failures), and nullable `retryAfter` in seconds. Codes are `unauthorized`, `throttled`, `unavailable`, `not_found`, `invalid_response`, `network`, `aborted`, and `request_failed`. Error messages omit server response bodies and transport details. Method return types describe the current server JSON contract; the client parses JSON but does not fully validate an untrusted remote schema. Use the client only with your own compatible inbox deployment. Cross-origin browser access is not enabled by the server.

## CLI JSON

Use direct Node commands or `npm run --silent ...` so npm's own banner does not precede JSON:

```sh
node tools/setup.mjs --domain example.com --site https://your-inbox.netlify.app --json
node tools/doctor.mjs --json
node tools/rotate.mjs --json
npm run typecheck
```

Each `--json` command writes one JSON document, exits nonzero on failure and omits credentials. Setup returns private file names; doctor returns checks and `smtpDeliveryVerified: false`; rotation returns a private file name, grace deadline and `deployed: false`. Setup JSON mode requires arguments and never prompts. Review [security and rotation](security.md) before importing generated settings.

## Offline quickstart

Run `node tools/inbox.mjs --demo list` after cloning, or follow [the package guide](sdk-readme.md). The fixture client uses the same Fetch client and error handling with fictional mail and no network. `npm run sdk:pack` builds an explicit allowlist into a dependency-free tarball; no server settings, real mail or private files are included.
