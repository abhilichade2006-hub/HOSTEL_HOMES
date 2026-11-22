const { randomUUID } = require('node:crypto');

function createEmailDelivery(db, { apiKey, from, appUrl }, request = fetch) {
  let sending = false;
  return {
    async flush() {
      if (!apiKey || !from || sending) return;
      sending = true;
      try {
        const pending = (await db.prepare(`SELECT n.id,n.message,n.email_key,n.email_attempts,u.email,u.name
          FROM notifications n JOIN users u ON u.id=n.user_id
          WHERE n.email_sent_at IS NULL AND n.email_attempts<3 AND n.email_next_attempt<=?
          ORDER BY n.id LIMIT 10`).all(Date.now()));
        for (const notification of pending) {
          // Concurrent app instances must use the same persisted provider idempotency key.
          const queued = await db.prepare('UPDATE notifications SET email_key=COALESCE(email_key,?) WHERE id=? AND email_sent_at IS NULL RETURNING email_key').get(randomUUID(), notification.id);
          if (!queued) continue;
          const key = queued.email_key;
          try {
            const response = await request('https://api.brevo.com/v3/smtp/email', {
              method: 'POST',
              headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
              signal: AbortSignal.timeout(10000),
              body: JSON.stringify({
                sender: { name: 'Hostel Homes', email: from },
                to: [{ email: notification.email, name: notification.name }],
                subject: 'Hostel Homes: a new update',
                textContent: `${notification.message}\n\nOpen your dashboard: ${appUrl}`,
                headers: { idempotencyKey: key }
              })
            });
            const result = await response.json().catch(() => ({}));
            const alreadySent = response.status === 400 && result.code === 'duplicate_parameter' && /idempotency/i.test(result.message || '');
            if (!response.ok && !alreadySent) throw Error(`Email provider returned HTTP ${response.status}`);
            (await db.prepare("UPDATE notifications SET email_sent_at=CURRENT_TIMESTAMP,email_attempts=email_attempts+1 WHERE id=?").run(notification.id));
          } catch (error) {
            (await db.prepare('UPDATE notifications SET email_attempts=email_attempts+1,email_next_attempt=? WHERE id=?').run(Date.now() + 5 * 60 * 1000, notification.id));
            console.error(`Email notification ${notification.id} could not be sent (${error.name}). Check the Brevo key, verified sender and account quota.`);
          }
        }
      } finally { sending = false; }
    }
  };
}

module.exports = { createEmailDelivery };
