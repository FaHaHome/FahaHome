const fs = require('fs');
const path = require('path');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

async function fetchDiscordEvents() {
  if (!DISCORD_BOT_TOKEN || !GUILD_ID) {
    console.error('ERROR: DISCORD_BOT_TOKEN or GUILD_ID missing in environment variables.');
    process.exit(1);
  }

  try {
    const discordUrl = `https://discord.com/api/v10/guilds/${GUILD_ID}/scheduled-events?with_user_count=true`;
    
    console.log('Fetching scheduled events from Discord API...');
    const response = await fetch(discordUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Discord API responded with status ${response.status}: ${errText}`);
    }

    const events = await response.json();

    const formattedEvents = events.map(event => ({
      id: event.id,
      title: event.name,
      description: event.description || '',
      startTime: event.scheduled_start_time,
      endTime: event.scheduled_end_time,
      location: event.entity_metadata?.location || (event.channel_id ? 'Discord Voice Channel' : 'See Event Description'),
      userCount: event.user_count || 0,
      image: event.image 
        ? `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png` 
        : null
    }));

    // Save formatted events array to events.json in the repository root
    const outputPath = path.join(__dirname, '..', 'events.json');
    fs.writeFileSync(outputPath, JSON.stringify(formattedEvents, null, 2));
    console.log(`Successfully written ${formattedEvents.length} event(s) to events.json`);

  } catch (err) {
    console.error('Error in fetchDiscordEvents:', err);
    process.exit(1);
  }
}

fetchDiscordEvents();
