import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderPage } from '../src/inbox.mjs';
import { messages } from '../demo/messages.mjs';

const out = fileURLToPath(new URL('../public/', import.meta.url));
await mkdir(out + '/assets', { recursive: true });
let page = renderPage({ label: 'Evolve Inbox', demoMessages: messages });
const style = /<style>([\s\S]*?)<\/style>/.exec(page);
const script = /<script>([\s\S]*?)<\/script>/.exec(page);
await writeFile(out + '/assets/inbox.css', style[1].trim() + '\n');
await writeFile(out + '/assets/inbox.js', script[1].trim() + '\n');
page = page.replace(style[0], '<link rel="stylesheet" href="./assets/inbox.css">')
  .replace(script[0], '<script src="./assets/inbox.js" defer></script>')
  .replace('</head>', '<meta name="description" content="Try Evolve Inbox with fictional messages: formatted mail, plain text, attachments and sender checks.">\n<link rel="canonical" href="https://www.evolvetech.dev/play/evolve-inbox/">\n</head>');
await writeFile(out + '/index.html', page);
console.log('Built public demo from fictional messages. No mailbox API or credentials are used.');
