require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

require('./db/db'); // initializes schema on boot

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1); // we sit behind Caddy

app.use(express.json());
app.use(
  session({
    name: 'fact.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd, // requires HTTPS in production (Caddy provides this)
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);

app.use(express.static(path.join(__dirname, 'public')));

// Friendly fallback for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`FACT ordering system listening on port ${PORT}`);
});
