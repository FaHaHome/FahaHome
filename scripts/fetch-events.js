const fs = require('fs');
const https = require('https');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const CALENDAR_URL = process.env.CALENDAR_URL || 'https://github.com';

async function syncEvents() {
  if (!BOT_TOKEN || !GUILD_ID) {
    console.error('Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID');
    process.exit(1);
  }

  // 1. Fetch Scheduled Events from Discord API
  const options = {
    hostname: 'discord.com',
    path: `/api/v10/guilds/${GUILD_ID}/scheduled-events`,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'User-Agent': 'FAHA-Calendar-Sync (1.0)'
    }
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
      if (res.statusCode !== 200) {
        console.error(`API Error: ${res.statusCode}`, data);
        process.exit(1);
      }

      const events = JSON.parse(data);
      
      // Save local backup copy
      fs.writeFileSync('events.json', JSON.stringify(events, null, 2));
      console.log(`Successfully synced ${events.length} events to events.json`);

      // 2. Format Embed Card for Discord
      if (WEBHOOK_URL) {
        await postToWebhook(events);
      }
    });
  }).on('error', err => {
    console.error('Fetch error:', err);
    process.exit(1);
  });
}

async function postToWebhook(events) {
  // Sort events chronologically
  events.sort((a, b) => new Date(a.scheduled_start_time) - new Date(b.scheduled_start_time));

  const fields = events.slice(0, 10).map(event => {
    const startTime = Math.floor(new Date(event.scheduled_start_time).getTime() / 1000);
    const location = event.entity_metadata?.location || 'Discord Voice/Stage Channel';
    
    return {
      name: `📌 ${event.name}`,
      value: `⏰ <t:${startTime}:F> (<t:${startTime}:R>)\n📍 **Location:** ${location}\n${event.description ? `📝 ${event.description}` : ''}`
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
      description: 'Here are the upcoming scheduled events for our community. Time displays auto-adjust to your local timezone!',
      color: 0x5865F2, // Discord Blurple color
      fields: fields,
      footer: {
        text: 'FAHA Calendar Sync • Auto-updated'
      },
      timestamp: new Date().toISOString()
    }]
  };

  // Post to Webhook
  const url = new URL(WEBHOOK_URL);
  const req = https.request({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, res => {
    console.log(`Webhook posted with status: ${res.statusCode}`);
  });

  req.write(JSON.stringify(embedPayload));
  req.end();
}

syncEvents();
