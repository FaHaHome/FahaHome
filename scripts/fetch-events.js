const fs = require('fs');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MESSAGE_ID = process.env.DISCORD_MESSAGE_ID;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchEventsWithRetry() {
  const url = `https://discord.com/api/v10/guilds/${GUILD_ID}/scheduled-events`;
  const headers = {
    Authorization: `Bot ${BOT_TOKEN}`,
    'User-Agent': 'DiscordBot (https://github.com/FahaHome, 1.0.0)'
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Fetching events from Discord API (Attempt ${attempt}/3)...`);
    const response = await fetch(url, { headers });

    if (response.status === 200) {
      return await response.json();
    }

    if (response.status === 429) {
      const data = await response.json();
      const retryAfter = Math.ceil(data.retry_after || 5);
      console.warn(`⚠️ Rate limited by Discord. Waiting ${retryAfter} seconds before retrying...`);
      await sleep(retryAfter * 1000);
      continue;
    }

    const errorText = await response.text();
    throw new Error(`Discord API Error [${response.status}]: ${errorText}`);
  }

  throw new Error('Exceeded maximum retry attempts for Discord API.');
}

async function syncEvents() {
  console.log('--- Starting FAHA Calendar Sync ---');

  if (!BOT_TOKEN || !GUILD_ID || !WEBHOOK_URL) {
    console.error('❌ Missing required secrets in environment (BOT_TOKEN, GUILD_ID, or WEBHOOK_URL)');
    process.exit(1);
  }

  try {
    const events = await fetchEventsWithRetry();
    console.log(`✅ Successfully fetched ${events.length} event(s) from Discord.`);

    fs.writeFileSync('events.json', JSON.stringify(events, null, 2));
    await updateWebhook(events);
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

async function updateWebhook(events) {
  events.sort((a, b) => new Date(a.scheduled_start_time) - new Date(b.scheduled_start_time));

  // Build sanitized fields for up to 10 upcoming events
  const fields = events.slice(0, 10).map((event) => {
    const startTime = Math.floor(new Date(event.scheduled_start_time).getTime() / 1000);

    // Sanitize Location
    let location = 'Discord Server';
    if (event.entity_metadata && event.entity_metadata.location && event.entity_metadata.location.trim() !== '') {
      location = event.entity_metadata.location.trim();
    } else if (event.channel_id) {
      location = `<#${event.channel_id}>`;
    }

    // Build guaranteed non-empty field value
    let valueLines = [
      `⏰ <t:${startTime}:F> (<t:${startTime}:R>)`,
      `📍 **Location:** ${location}`
    ];

    if (event.description && event.description.trim() !== '') {
      valueLines.push(`📝 ${event.description.trim()}`);
    }

    // Ensure title/name is non-empty and bounded
    const eventName = (event.name && event.name.trim() !== '') ? event.name.trim() : 'Scheduled Event';

    return {
      name: `📌 ${eventName}`.substring(0, 256),
      value: valueLines.join('\n').substring(0, 1024)
    };
  });

  // Fallback if no events exist in the server
  if (fields.length === 0) {
    fields.push({
      name: '📌 No Upcoming Events',
      value: 'Check back soon for upcoming FAHA meetings and activities!'
    });
  }

  const embedPayload = {
    embeds: [{
      title: '📅 FAHA Server Scheduled Events',
      description: 'Upcoming scheduled events for our community. Times automatically adjust to your local timezone!',
      color: 5793266, // 0x5865F2 Blurple as standard integer
      fields: fields,
      footer: {
        text: 'FAHA Calendar Sync • Auto-updated'
      },
      timestamp: new Date().toISOString()
    }]
  };

  const webhookBase = WEBHOOK_URL.trim();
  let targetUrl = webhookBase;
  let method = 'POST';

  if (MESSAGE_ID && MESSAGE_ID.trim() !== '') {
    // Strip trailing slash if present before appending /messages/ID
    targetUrl = `${webhookBase.replace(/\/$/, '')}/messages/${MESSAGE_ID.trim()}`;
    method = 'PATCH';
    console.log(`Editing existing message ID: ${MESSAGE_ID.trim()}...`);
  } else {
    console.log('Posting new message to Webhook...');
  }

  const response = await fetch(targetUrl, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embedPayload)
  });

  if (response.status >= 200 && response.status < 300) {
    console.log(`🎉 Webhook successfully updated channel message (Status: ${response.status})!`);
  } else {
    const errBody = await response.text();
    console.error(`❌ Webhook update failed with status ${response.status}:`, errBody);
    process.exit(1);
  }
}

syncEvents();
