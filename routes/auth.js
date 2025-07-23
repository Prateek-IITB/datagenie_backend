require('dotenv').config(); 

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const datagenieDb = require('../services/datagenieDb');

const JWT_SECRET = process.env.JWT_SECRET;


// Signup
router.post('/signup', async (req, res) => {
  const { email, password, user_name } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Default company_id = 1, role = 'user'
    const [result] = await datagenieDb.execute(
      `INSERT INTO users (email, password, name, company_id, role)
       VALUES (?, ?, ?, 1, 'user')`,
      [email, hashedPassword, user_name]
    );

    const token = jwt.sign({ user_id: result.insertId, company_id: 1, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: result.insertId,
        email,
        user_name,
        company_id: 1,
        role: 'user',
      },
    });
  } catch (err) {
    console.error('Signup Error:', err);
    res.status(500).json({ error: 'Signup failed', details: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await datagenieDb.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password); // ✅ FIXED: password_hash → password

    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { user_id: user.id, company_id: user.company_id, role: user.role },
      JWT_SECRET, // ✅ FIXED: consistent secret
      { expiresIn: '2h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        user_name: user.name,
        company_id: user.company_id,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
