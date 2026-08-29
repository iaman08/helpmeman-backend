const crypto = require('crypto');
const axios = require('axios');
const config = require('../config/env');

/**
 * POST /api/webhooks/tawk
 * Handles tawk.to webhook events (specifically ticket:create) and forwards formatted rich embeds to Discord.
 */
async function handleTawkWebhook(req, res) {
  try {
    const webhookSecret = config.tawk.webhookSecret || process.env.TAWK_WEBHOOK_SECRET;
    const signature = req.headers['x-tawk-signature'];

    // 1. Verify HMAC SHA1 signature if secret is configured
    if (webhookSecret && signature) {
      const rawPayload = req.rawBody || Buffer.from(JSON.stringify(req.body));
      const expectedSignature = crypto
        .createHmac('sha1', webhookSecret)
        .update(rawPayload)
        .digest('hex');

      if (signature !== expectedSignature) {
        console.warn('[Tawk Webhook] Invalid signature mismatch');
        return res.status(401).send('Invalid signature');
      }
    }

    const payload = req.body || {};
    const eventType = payload.event || payload.type || 'ticket:create';

    // 2. Check if payload is ticket:create event
    if (eventType === 'ticket:create' || payload.ticket || payload.event === 'ticket:create') {
      const ticket = payload.ticket || payload;
      const requester = payload.requester || ticket.requester || {};

      const ticketId = ticket.id || payload.id || 'N/A';
      const subject = ticket.subject || payload.subject || 'Support Ticket';
      const message = ticket.message || ticket.description || payload.message || 'No description provided.';
      const requesterName = requester.name || payload.name || 'Anonymous User';
      const requesterEmail = requester.email || payload.email || 'No email provided';

      const discordWebhookUrl = config.discord.ticketWebhookUrl || process.env.DISCORD_TICKET_WEBHOOK_URL;

      // 3. Post formatted rich Discord embed if Discord webhook URL is configured
      if (discordWebhookUrl) {
        const embedPayload = {
          embeds: [
            {
              title: `🎫 New tawk.to Ticket: ${subject}`,
              color: 0x00b0ff, // tawk.to Blue
              fields: [
                {
                  name: 'Ticket ID',
                  value: String(ticketId),
                  inline: true,
                },
                {
                  name: 'Reporter',
                  value: `${requesterName}\n\`${requesterEmail}\``,
                  inline: true,
                },
                {
                  name: 'Message Body',
                  value: message.length > 1024 ? message.slice(0, 1021) + '...' : message,
                  inline: false,
                },
                {
                  name: 'Tawk.to Dashboard',
                  value: '[Open tawk.to Dashboard](https://dashboard.tawk.to)',
                  inline: false,
                },
              ],
              timestamp: new Date().toISOString(),
              footer: {
                text: 'HelpMeMan Support System • tawk.to Webhook',
              },
            },
          ],
        };

        try {
          await axios.post(discordWebhookUrl, embedPayload, {
            headers: { 'Content-Type': 'application/json' },
          });
          console.log(`[Tawk Webhook] Successfully forwarded Ticket #${ticketId} to Discord`);
        } catch (dErr) {
          console.error('[Tawk Webhook] Error forwarding to Discord:', dErr.message);
        }
      } else {
        console.warn('[Tawk Webhook] DISCORD_TICKET_WEBHOOK_URL is not set. Ticket received but not forwarded to Discord.');
      }
    }

    // 4. Always return 200 OK to tawk.to
    return res.status(200).send('Webhook received');
  } catch (error) {
    console.error('[Tawk Webhook] Error processing webhook:', error);
    return res.status(500).send('Internal server error');
  }
}

module.exports = {
  handleTawkWebhook,
};
