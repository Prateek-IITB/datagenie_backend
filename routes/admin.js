const express = require('express');
const router = express.Router();
const db = require('../services/datagenieDb.js'); // your db connection file

// 1. Invite a new user
router.post('/invite-user', async (req, res) => {
  const { email, role, companyId } = req.body;

  try {
    const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'User already exists.' });
    }

    await db.query(
      'INSERT INTO users (email, role, is_active, company_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [email, role, 1, companyId]
    );

    res.status(200).json({ message: 'User invited successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error inviting user.' });
  }
});

// 2. Get all users for company
router.get('/users', async (req, res) => {
  const { companyId } = req.query;

  try {
    const [users] = await db.query(
      'SELECT id, email, role, is_active FROM users WHERE company_id = ?',
      [companyId]
    );
    res.status(200).json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching users.' });
  }
});

// 3. Update user role
router.put('/update-role', async (req, res) => {
  const { userId, newRole } = req.body;

  try {
    await db.query('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [newRole, userId]);
    res.status(200).json({ message: 'Role updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating role.' });
  }
});

// 4. Update active status
router.put('/update-status', async (req, res) => {
  const { userId, isActive } = req.body;

  try {
    await db.query('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?', [isActive, userId]);
    res.status(200).json({ message: 'Status updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating status.' });
  }
});

module.exports = router;
