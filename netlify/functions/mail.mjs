import { createInbox } from '../../src/inbox.mjs';

export default createInbox();
export const config = { path: ['/mail', '/mail/*'] };
