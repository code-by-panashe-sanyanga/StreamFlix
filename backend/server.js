// StreamFlix API server
// Simple Express backend for movies, login and a watchlist.

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();

// Secret used to sign the login tokens. Falls back to a dev value.
const SECRET = process.env.JWT_SECRET || 'streamflix-dev-secret';

// I am keeping everything in memory for now instead of a real database.
// users holds the registered accounts.
// watchlists maps an email to a list of movie ids.
const users = [];
const watchlists = {};

// Load the movies once when the server starts.
const movies = JSON.parse(fs.readFileSync(path.join(__dirname, 'movies.json')));

app.use(cors());
app.use(express.json());

// Make emails lower case so "Bob@x.com" and "bob@x.com" are the same user.
function normalizeEmail(email) {
  if (!email) {
    return '';
  }
  return email.trim().toLowerCase();
}

// Look up a movie by its id. Returns undefined if it is not there.
function findMovie(id) {
  return movies.find(function (movie) {
    return movie.id === id;
  });
}

// Quick check to see if the server is up.
app.get('/api/health', function (req, res) {
  res.json({ ok: true, movies: movies.length });
});

// Create a new account.
app.post('/api/register', async function (req, res) {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;

  // Basic validation before we save anything.
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'valid email required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  // Do not let two people register with the same email.
  const existing = users.find(function (u) {
    return u.email === email;
  });
  if (existing) {
    return res.status(409).json({ error: 'user exists' });
  }

  // Never store the raw password, hash it first.
  const hash = await bcrypt.hash(password, 10);
  users.push({ email: email, password: hash });
  watchlists[email] = [];

  res.status(201).json({ ok: true });
});

// Log in and get a token back.
app.post('/api/login', async function (req, res) {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const user = users.find(function (u) {
    return u.email === email;
  });

  // Check the user exists and the password matches the stored hash.
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  // Token is valid for 2 hours.
  const token = jwt.sign({ email: email }, SECRET, { expiresIn: '2h' });
  res.json({ token: token });
});

// Middleware that checks the token on protected routes.
function auth(req, res, next) {
  const header = req.headers.authorization || '';

  // The header looks like "Bearer <token>", so cut off the first part.
  let token = null;
  if (header.startsWith('Bearer ')) {
    token = header.slice(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'no token' });
  }

  try {
    // If this works the token is valid and we save the user on the request.
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'bad token' });
  }
}

// Send back all the movies. This one is open to everyone.
app.get('/api/movies', function (req, res) {
  res.json(movies);
});

// Get the movies that are on the logged in user's watchlist.
app.get('/api/watchlist', auth, function (req, res) {
  const ids = watchlists[req.user.email] || [];
  const saved = movies.filter(function (m) {
    return ids.includes(m.id);
  });
  res.json(saved);
});

// Add a movie to the watchlist.
app.post('/api/watchlist/:id', auth, function (req, res) {
  const id = Number(req.params.id);

  // Make sure the id is a real movie.
  if (!Number.isInteger(id) || !findMovie(id)) {
    return res.status(404).json({ error: 'movie not found' });
  }

  // Grab the user's list, or make an empty one if they do not have it yet.
  if (!watchlists[req.user.email]) {
    watchlists[req.user.email] = [];
  }
  const list = watchlists[req.user.email];

  // Only add it if it is not already there.
  if (!list.includes(id)) {
    list.push(id);
  }

  res.json({ watchlist: list });
});

// Remove a movie from the watchlist.
app.delete('/api/watchlist/:id', auth, function (req, res) {
  const id = Number(req.params.id);

  if (!watchlists[req.user.email]) {
    watchlists[req.user.email] = [];
  }

  // Keep everything except the id we want to remove.
  watchlists[req.user.email] = watchlists[req.user.email].filter(function (movieId) {
    return movieId !== id;
  });

  res.json({ watchlist: watchlists[req.user.email] });
});

// Start the server.
app.listen(4000, function () {
  console.log('StreamFlix API http://localhost:4000');
});
