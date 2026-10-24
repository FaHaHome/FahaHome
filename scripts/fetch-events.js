const fs = require('fs');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MESSAGE_ID = process.env.DISCORD_MESSAGE_ID;

// Helper function for delays
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

  const fields = events.slice(0, 10).map((event) => {
    const startTime = Math.floor(new Date(event.scheduled_start_time).getTime() / 1000);

    let location = 'Discord Server';
    if (event.entity_metadata?.location) {
      location = event.entity_metadata.location;
    } else if (event.channel_id) {
      location = `<#${event.channel_id}>`;
    }

    let valueText = `⏰ <t:${startTime}:F> (<t:${startTime}:R>)\n📍 **Location:** ${location}`;
    if (event.description && event.description.trim() !== '') {
      valueText += `\n📝 ${event.description.trim()}`;
    }

    return {
      name: `📌 ${event.name || 'Scheduled Event'}`,
      value: valueText
    };
  });

  if (fields.length === 0) {
    fields.push({
      name: 'No Upcoming Events',
      value: 'Check back soon for upcoming FAHA meetings and activities!'
    });
  }

  const embedPayload = {
    embeds: [{
      title: '📅 FAHA Server Scheduled Events',
      description: 'Upcoming scheduled events for our community. Times automatically adjust to your local timezone!',
      color: 0x5865F2,
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
