const fs = require('fs');

// 1. Read environment credentials
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MESSAGE_ID = process.env.DISCORD_MESSAGE_ID;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Fetch Discord API events with rate-limit retry
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
      console.warn(`⚠️ Rate limited by Discord. Waiting ${retryAfter} seconds...`);
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
    console.error('❌ Missing required environment secrets (BOT_TOKEN, GUILD_ID, or WEBHOOK_URL)');
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
  // Sort events chronologically
  events.sort((a, b) => new Date(a.scheduled_start_time) - new Date(b.scheduled_start_time));

  const titleText = '📅 FAHA Server Scheduled Events';
  const descText = 'Upcoming scheduled events for our community. Times automatically adjust to your local timezone!';
  const footerText = 'FAHA Calendar Sync • Auto-updated';

  // Discord global limit is 6000 chars. Target 4500 chars max for safety.
  const MAX_TOTAL_EMBED_CHARS = 4500;
  let currentTotalChars = titleText.length + descText.length + footerText.length;

  const fields = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const startTime = Math.floor(new Date(event.scheduled_start_time).getTime() / 1000);

    // Sanitize location
    let location = 'Discord Server';
    if (event.entity_metadata?.location?.trim()) {
      location = event.entity_metadata.location.trim();
    } else if (event.channel_id) {
      location = `<#${event.channel_id}>`;
    }

    // Clean description & truncate to 200 chars per event max
    let cleanDesc = (event.description || '').trim();
    if (cleanDesc.length > 200) {
      cleanDesc = cleanDesc.substring(0, 197) + '...';
    }

    let valueLines = [
      `⏰ <t:${startTime}:F> (<t:${startTime}:R>)`,
      `📍 **Location:** ${location}`
    ];
    if (cleanDesc !== '') {
      valueLines.push(`📝 ${cleanDesc}`);
    }

    const fieldName = `📌 ${(event.name || 'Scheduled Event').trim()}`.substring(0, 256);
    const fieldValue = valueLines.join('\n').substring(0, 1024);

    const fieldCharCost = fieldName.length + fieldValue.length;

    // Budget check
    if (currentTotalChars + fieldCharCost > MAX_TOTAL_EMBED_CHARS || fields.length >= 15) {
      const remainingCount = events.length - fields.length;
      fields.push({
        name: '➕ More Events',
        value: `...and ${remainingCount} more event(s) scheduled in Discord!`
      });
      break;
    }

    fields.push({ name: fieldName, value: fieldValue });
    currentTotalChars += fieldCharCost;
  }

  // Fallback if no events exist
  if (fields.length === 0) {
    fields.push({
      name: '📌 No Upcoming Events',
      value: 'Check back soon for upcoming FAHA meetings and activities!'
    });
  }

  const embedPayload = {
    embeds: [{
      title: titleText,
      description: descText,
      color: 5793266, // Blurple integer
      fields: fields,
      footer: { text: footerText },
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
    console.log(`🎉 Success! Webhook updated channel message (Status: ${response.status}).`);
  } else {
    const errBody = await response.text();
    console.error(`❌ Webhook update failed with status ${response.status}:`, errBody);
    process.exit(1);
  }
}

syncEvents();

syncEvents();
