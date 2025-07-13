const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());

const SECRET_KEY = 'your-secret-key'; // Replace with a secure key
const db = new sqlite3.Database('armory.db');

// Initialize database
db.serialize(() => {
 db.run(`CREATE TABLE IF NOT EXISTS users (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   username TEXT UNIQUE,
   password TEXT
 )`);
 db.run(`CREATE TABLE IF NOT EXISTS armory_usage (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   username TEXT,
   xanax INTEGER DEFAULT 0,
   beer INTEGER DEFAULT 0,
   empty_blood_bags INTEGER DEFAULT 0,
   filled_blood_bags INTEGER DEFAULT 0,
   total_value REAL DEFAULT 0,
   FOREIGN KEY (username) REFERENCES users(username)
 )`);
});

// Register user
app.post('/register', (req, res) => {
 const { username, password } = req.body;
 const hashedPassword = bcrypt.hashSync(password, 10);
 db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], (err) => {
   if (err) return res.status(400).json({ error: 'Username taken' });
   res.json({ message: 'User registered' });
 });
});

// Login
app.post('/login', (req, res) => {
 const { username, password } = req.body;
 db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
   if (err || !user || !bcrypt.compareSync(password, user.password)) {
     return res.status(401).json({ error: 'Invalid credentials' });
   }
   const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
   res.json({ token });
 });
});

// Middleware to verify token
const authenticateToken = (req, res, next) => {
 const token = req.headers['authorization'];
 if (!token) return res.status(401).json({ error: 'No token provided' });
 jwt.verify(token, SECRET_KEY, (err, decoded) => {
   if (err) return res.status(403).json({ error: 'Invalid token' });
   req.username = decoded.username;
   next();
 });
};

// Update armory usage
app.post('/armory', authenticateToken, (req, res) => {
 const { xanax, beer, empty_blood_bags, filled_blood_bags } = req.body;
 db.run(
   `INSERT INTO armory_usage (username, xanax, beer, empty_blood_bags, filled_blood_bags) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
    xanax = xanax + excluded.xanax,
    beer = beer + excluded.beer,
    empty_blood_bags = empty_blood_bags + excluded.empty_blood_bags,
    filled_blood_bags = filled_blood_bags + excluded.filled_blood_bags`,
   [req.username, xanax || 0, beer || 0, empty_blood_bags || 0, filled_blood_bags || 0],
   (err) => {
     if (err) return res.status(500).json({ error: err.message });
     res.json({ message: 'Usage updated' });
   }
 );
});

// Fetch armory data
app.get('/armory', authenticateToken, (req, res) => {
 db.all(`SELECT * FROM armory_usage WHERE username = ?`, [req.username], (err, rows) => {
   if (err) return res.status(500).json({ error: err.message });
   res.json(rows);
 });
});

app.listen(3000, () => console.log('Server running on port 3000'));
