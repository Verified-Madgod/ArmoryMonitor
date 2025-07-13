const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

const TORN_API_BASE = 'https://api.torn.com';
const db = new sqlite3.Database('armory.db');

// Item IDs for market value lookups (from your previous context)
const itemIds = {
  xanax: 67,
  beer: 10,
  empty_blood_bags: 70,
  filled_blood_bags: 71,
  lollipop: 226,
  first_aid_kit: 68
};

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key TEXT UNIQUE,
    faction_name TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS armory_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER,
    username TEXT,
    xanax INTEGER DEFAULT 0,
    beer INTEGER DEFAULT 0,
    empty_blood_bags INTEGER DEFAULT 0,
    filled_blood_bags INTEGER DEFAULT 0,
    lollipop INTEGER DEFAULT 0,
    first_aid_kit INTEGER DEFAULT 0,
    total_value REAL DEFAULT 0,
    last_updated INTEGER,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  )`);
});

// Middleware to validate API key
const authenticateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'No API key provided' });

  // Validate API key against database
  db.get(`SELECT * FROM api_keys WHERE api_key = ?`, [apiKey], async (err, key) => {
    if (err || !key) return res.status(403).json({ error: 'Invalid API key' });

    // Verify API key with Torn API
    const response = await fetch(`${TORN_API_BASE}/faction/?selections=armorynews&key=${apiKey}`);
    const data = await response.json();
    if (data.error) return res.status(403).json({ error: 'Invalid or unauthorized API key' });

    req.apiKey = apiKey;
    req.factionName = key.faction_name;
    req.apiKeyId = key.id;
    next();
  });
};

// Add API key
app.post('/api/api-key', async (req, res) => {
  const { api_key, faction_name } = req.body;

  // Verify API key with Torn API
  const response = await fetch(`${TORN_API_BASE}/faction/?selections=armorynews&key=${api_key}`);
  const data = await response.json();
  if (data.error) return res.status(400).json({ error: 'Invalid Torn API key' });

  db.run(
    `INSERT INTO api_keys (api_key, faction_name) VALUES (?, ?)`,
    [api_key, faction_name || 'Unknown Faction'],
    (err) => {
      if (err) return res.status(400).json({ error: 'API key already exists' });
      res.json({ message: 'API key added' });
    }
  );
});

// Update market values
async function updateMarketValues(apiKeyId, username, apiKey) {
  let totalValue = 0;
  for (const item in itemIds) {
    const response = await fetch(`${TORN_API_BASE}/v2/market/${itemIds[item]}/itemmarket?offset=0&key=${apiKey}`);
    const data = await response.json();
    if (data.error) continue;
    const marketPrice = data.itemmarket[0]?.cost || 0;
    const quantity = await new Promise((resolve) => {
      db.get(`SELECT ${item} FROM armory_usage WHERE api_key_id = ? AND username = ?`, [apiKeyId, username], (err, row) => {
        resolve(row ? row[item] : 0);
      });
    });
    totalValue += marketPrice * quantity;
  }
  db.run(`UPDATE armory_usage SET total_value = ? WHERE api_key_id = ? AND username = ?`, [totalValue, apiKeyId, username]);
}

// Fetch and process armory data (used by both user and cron)
async function fetchArmoryData(apiKey, res = null) {
  try {
    db.all(`SELECT * FROM api_keys WHERE api_key = ?`, [apiKey], async (err, keys) => {
      if (err || !keys.length) {
        if (res) res.status(500).json({ error: 'API key not found' });
        return;
      }

      const key = keys[0];
      const response = await fetch(`${TORN_API_BASE}/faction/?selections=armorynews&key=${key.api_key}`);
      const data = await response.json();
      if (data.error) {
        if (res) res.status(500).json({ error: data.error });
        return;
      }

      const armoryNews = data.armorynews;
      const usageUpdates = {};

      // Process armory news
      for (const newsId in armoryNews) {
        const { news, timestamp } = armoryNews[newsId];
        const match = news.match(/^(\w+) (?:used one of the faction's|gave (\d+)x) (.+?) (?:items|to themselves)/);
        if (!match) continue;

        const username = match[1];
        const quantity = parseInt(match[2] || 1);
        const item = match[3].toLowerCase().replace(/\s+/g, '_');

        if (!usageUpdates[username]) {
          usageUpdates[username] = { username, api_key_id: key.id };
          usageUpdates[username][item] = 0;
        }
        usageUpdates[username][item] += quantity;
      }

      // Update database
      for (const username in usageUpdates) {
        const update = usageUpdates[username];
        db.run(
          `INSERT INTO armory_usage (api_key_id, username, ${Object.keys(update).filter(k => k !== 'username' && k !== 'api_key_id').join(', ')}, last_updated)
           VALUES (?, ?, ${Object.keys(update).filter(k => k !== 'username' && k !== 'api_key_id').map(() => '?').join(', ')}, ?)
           ON CONFLICT(api_key_id, username) DO UPDATE SET
           ${Object.keys(update).filter(k => k !== 'username' && k !== 'api_key_id').map(k => `${k} = ${k} + excluded.${k}`).join(', ')},
           last_updated = excluded.last_updated`,
          [update.api_key_id, username, ...Object.keys(update).filter(k => k !== 'username' && k !== 'api_key_id').map(k => update[k]), Math.floor(Date.now() / 1000)],
          (err) => {
            if (err) console.error(err);
            updateMarketValues(update.api_key_id, username, key.api_key);
          }
        );
      }

      // Fetch and return armory data if requested by user
      if (res) {
        db.all(
          `SELECT au.*, ak.faction_name FROM armory_usage au
           JOIN api_keys ak ON au.api_key_id = ak.id
           WHERE ak.api_key = ?`,
          [apiKey],
          (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
          }
        );
      }
    });
  } catch (error) {
    if (res) res.status(500).json({ error: error.message });
  }
}

// Fetch armory data (user-initiated or cron)
app.get('/api/armory', authenticateApiKey, async (req, res) => {
  await fetchArmoryData(req.apiKey, res);
});

// Vercel serverless function export
module.exports = app;
