const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch'); // Add for API calls
const app = express();
app.use(express.json());

const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key';
const TORN_API_BASE = 'https://api.torn.com';
const db = new sqlite3.Database('armory.db');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    api_key TEXT UNIQUE,
    faction_name TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
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

// Register user
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], (err) => {
    if (err) return res.status(400).json({ error: 'Username taken' });
    res.json({ message: 'User registered' });
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ username, userId: user.id }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ token });
  });
});

// Middleware to verify token
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

// Add API key
app.post('/api/api-key', authenticateToken, (req, res) => {
  const { api_key, faction_name } = req.body;
  db.run(
    `INSERT INTO api_keys (user_id, api_key, faction_name) VALUES (?, ?, ?)`,
    [req.user.userId, api_key, faction_name],
    (err) => {
      if (err) return res.status(400).json({ error: 'API key already exists' });
      res.json({ message: 'API key added' });
    }
  );
});

// Fetch and process armory data
app.get('/api/armory', authenticateToken, async (req, res) => {
  try {
    // Get user's API keys
    db.all(`SELECT * FROM api_keys WHERE user_id = ?`, [req.user.userId], async (err, keys) => {
      if (err) return res.status(500).json({ error: err.message });

      const armoryData = [];
      for (const key of keys) {
        // Fetch armory news from Torn API
        const response = await fetch(`${TORN_API_BASE}/faction/?selections=armorynews&key=${key.api_key}`);
        const data = await response.json();
        if (data.error) continue; // Skip invalid API keys

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
            }
          );
        }

        // Fetch current armory data
        db.all(
          `SELECT au.*, ak.faction_name FROM armory_usage au
           JOIN api_keys ak ON au.api_key_id = ak.id
           WHERE ak.user_id = ?`,
          [req.user.userId],
          (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            armoryData.push(...rows);
            if (armoryData.length === keys.length) {
              res.json(armoryData);
            }
          }
        );
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vercel serverless function export
module.exports = app;

// Background task to update armory data every 5 minutes
setInterval(async () => {
  db.all(`SELECT * FROM api_keys`, async (err, keys) => {
    if (err) return console.error(err);
    for (const key of keys) {
      const response = await fetch(`${TORN_API_BASE}/faction/?selections=armorynews&key=${key.api_key}`);
      const data = await response.json();
      if (data.error) continue;

      const armoryNews = data.armorynews;
      const usageUpdates = {};

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
            updateMarketValues(update.api_key_id, username);
          }
        );
      }
    }
  });
}, 5 * 60 * 1000); // Run every 5 minutes
