// Fictional sample mail only. Never replace these fixtures with a real mailbox export.
export const messages = [
  {
    id: 'demo-welcome-001', receivedAt: 1792926000000,
    from: 'Alex <alex@example.org>', to: 'hello@example.com', recipients: ['hello@example.com'],
    subject: 'Your new inbox is ready', preview: 'One place for mail sent to your own domain.',
    text: 'Hi Morgan,\n\nYour new inbox is ready. Mail sent to your domain arrives here through an inbound webhook.\n\nOpen a message, check the sender authentication results, download an attachment, or switch to plain text.\n\nThese are fictional messages in a read-only demonstration.\n\nAlex',
    html: '<div style="font-family:system-ui;color:#29231e;padding:24px"><p style="color:#d9480f;font-size:13px">EVOLVE INBOX</p><h1>Your new inbox is ready.</h1><p>Hi Morgan,</p><p>One place for mail sent to your own domain, with a reader that stays out of the way.</p><ul><li>Read formatted mail or plain text.</li><li>Download attachments.</li><li>Inspect the sender’s reported SPF, DKIM and DMARC results.</li></ul><p>These messages are fictional. The demo cannot read or change the EvolveTech mailbox.</p><p>Alex</p></div>',
    auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' }, attachments: [],
  },
  {
    id: 'demo-notes-0002', receivedAt: 1792918800000,
    from: 'Sam <sam@example.net>', to: 'projects@example.com', recipients: ['projects@example.com'],
    subject: 'Notes from our project review', preview: 'The deployment notes are attached as a text file.',
    text: 'Hi Morgan,\n\nThe deployment notes are attached as a text file.\n\nEverything in this demo uses reserved example domains. No real email or passwords are included.\n\nSam',
    html: '', auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    attachments: [{ filename: 'project-notes.txt', contentType: 'text/plain', size: 74, data: Buffer.from('Demo project notes\n\nConfigure your domain, webhook and private inbox password.\n').toString('base64') }],
  },
  {
    id: 'demo-checks-003', receivedAt: 1792911600000,
    from: 'Sender <sender@example.org>', to: 'hello@example.com', recipients: ['hello@example.com'],
    subject: 'A message with a failed sender check', preview: 'Authentication badges show what the forwarding provider reported.',
    text: 'This fictional message demonstrates a failed sender check. The badges report the forwarding provider’s authentication results; the inbox does not compute these results itself.',
    html: '', auth: { spf: 'fail', dkim: 'none', dmarc: 'fail' }, attachments: [],
  },
];
