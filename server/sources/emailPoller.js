'use strict';

const config = require('../config');
const { ingestFile } = require('../pipeline/ingest');

const ACCEPTED_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|gif|tiff?))$/i;

// Subject filter: keep an email if it has no filter or matches any term.
function subjectMatches(subject) {
  const terms = config.imap.filterSubject || [];
  if (!terms.length) return true;
  const s = (subject || '').toLowerCase();
  return terms.some((t) => s.includes(String(t).toLowerCase()));
}

async function pollOnce() {
  // Lazy-require so the app runs even if imapflow isn't installed / not used.
  let ImapFlow;
  let simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch {
    console.warn('[imap] imapflow/mailparser not installed — email source disabled.');
    return;
  }

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.imap.mailbox);
    try {
      // Only look at recent unseen-ish messages: fetch last 50 by UID.
      const messages = [];
      for await (const msg of client.fetch(
        { seen: false },
        { envelope: true, source: true }
      )) {
        messages.push(msg);
      }

      for (const msg of messages) {
        const subject = msg.envelope && msg.envelope.subject;
        if (!subjectMatches(subject)) continue;
        const messageId = msg.envelope && msg.envelope.messageId;

        const parsed = await simpleParser(msg.source);
        for (const att of parsed.attachments || []) {
          if (!ACCEPTED_MIME.test(att.contentType || '')) continue;
          try {
            const { receipt, duplicate } = await ingestFile(att.content, {
              originalName: att.filename || 'email-attachment',
              mimeType: att.contentType,
              source: 'email',
              emailMessageId: messageId
                ? `${messageId}:${att.filename || att.checksum}`
                : null,
            });
            if (!duplicate) {
              console.log(
                `[imap] imported "${att.filename}" from "${subject}" → receipt #${receipt.id}`
              );
            }
          } catch (err) {
            console.warn(`[imap] failed to import attachment: ${err.message}`);
          }
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.warn(`[imap] poll failed: ${err.message}`);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

// Poll the inbox on an interval. No-op when IMAP isn't configured.
function startEmailPoller() {
  if (!config.imap.enabled) return null;
  console.log(
    `  Email inbox: ${config.imap.user}@${config.imap.host} (every ${config.imap.pollSeconds}s)`
  );
  pollOnce();
  const timer = setInterval(pollOnce, config.imap.pollSeconds * 1000);
  timer.unref();
  return timer;
}

module.exports = { startEmailPoller, pollOnce };
