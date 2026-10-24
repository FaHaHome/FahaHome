const fs = require('fs');
const https = require('https');

// Read Environment Variables from GitHub Actions
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MESSAGE_ID = process.env.DISCORD_MESSAGE_ID;

async function syncEvents() {
  console.log('--- Starting FAHA Calendar Sync ---');
  
  // Debug check environment variables
  if (!BOT_TOKEN) console.error('❌ ERROR: DISCORD_BOT_TOKEN is missing or empty in GitHub Secrets!');
  if (!GUILD_ID) console.error('❌ ERROR: DISCORD_GUILD_ID is missing or empty in GitHub Secrets!');
  if (!WEBHOOK_URL) console.error('❌ ERROR: DISCORD_WEBHOOK_URL is missing or empty in GitHub Secrets!');

  if (!BOT_TOKEN || !GUILD_ID || !WEBHOOK_URL) {
    console.error('Please verify your Repository Secrets names and values in GitHub Settings.');
    process.exit(1);
  }

  console.log(`✅ Secrets loaded successfully. Fetching scheduled events for Guild: ${GUILD_ID}...`);

  // 1. Fetch Scheduled Events from Discord API
  const options = {
    hostname: 'discord.com',
    path: `/api/v10/guilds/${GUILD_ID}/scheduled-events`,
    method: 'GET',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'User-Agent': 'FAHA-Calendar-Webhook-Sync (1.0)'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      if (res.statusCode !== 200) {
        console.error(`❌ Discord API returned status ${res.statusCode}:`, data);
        process.exit(1);
      }

      const events = JSON.parse(data);
      console.log(`✅ Successfully fetched ${events.length} event(s) from Discord.`);

      // Save local backup file
      fs.writeFileSync('events.json', JSON.stringify(events, null, 2));

      // 2. Format and post to Webhook
      await updateDiscordCard(events);
    });
  });

  req.on('error', err => {
    console.error('❌ Network error while fetching events:', err);
    process.exit(1);
  });

  req.end();
}

async function updateDiscordCard(events) {
  // Sort events chronologically
  events.sort((a, b) => new Date(a.scheduled_start_time) - new Date(b.scheduled_start_time));

  // Build Discord Embed Fields
  const fields = events.slice(0, 10).map(event => {
    const startTime = Math.floor(new Date(event.scheduled_start_time).getTime() / 1000);
    const location = event.entity_metadata?.location || 'Discord Voice/Stage Channel';
    
    return {
      name: `📌 ${event.name}`,
      value: `⏰ <t:${startTime}:F> (<t:${startTime}:R>)\n📍 **Location:** ${location}${event.description ? `\n📝 ${event.description}` : ''}`
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
      color: 0x5865F2, // Discord Blurple
      fields: fields,
      footer: {
        text: 'FAHA Calendar Sync • Auto-updated'
      },
      timestamp: new Date().toISOString()
    }]
  };

  // Determine URL path: PATCH to edit an existing message, POST to publish a new one
  const webhookUrl = new URL(WEBHOOK_URL);
  let requestPath = webhookUrl.pathname + webhookUrl.search;
  let method = 'POST';

  if (MESSAGE_ID && MESSAGE_ID.trim() !== '') {
    requestPath = `${webhookUrl.pathname}/messages/${MESSAGE_ID.trim()}${webhookUrl.search}`;
    method = 'PATCH';
    console.log(`Updating existing message ID: ${MESSAGE_ID.trim()} via PATCH...`);
  } else {
    console.log('No DISCORD_MESSAGE_ID provided. Posting a new message via POST...');
  }

  const webhookReq = https.request({
    hostname: webhookUrl.hostname,
    path: requestPath,
    method: method,
    headers: {
      'Content-Type': 'application/json'
    }
  }, res => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`🎉 Webhook successfully updated channel message (Status: ${res.statusCode})!`);
    } else {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        console.error(`❌ Webhook update failed with status ${res.statusCode}:`, responseBody);
      });
    }
  });

  webhookReq.on('error', err => {
    console.error('❌ Webhook request error:', err);
  });

  webhookReq.write(JSON.stringify(embedPayload));
  webhookReq.end();
}

syncEvents();
