const express = require('express');
const router = express.Router();
const datagenieDb = require('../services/datagenieDb');
const getCompanyDbByUserId = require('../services/companyDb'); // dynamically connects

// Retry wrapper
const executeWithRetry = async (query, params, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await datagenieDb.execute(query, params);
    } catch (err) {
      if (err.code === 'ER_LOCK_DEADLOCK' && i < retries - 1) {
        console.warn('Deadlock detected. Retrying...');
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        throw err;
      }
    }
  }
};

// 🚀 Step A: Refresh + Cache schema from actual company DB
router.post('/refresh', async (req, res) => {
  console.log('🔄 Refreshing schema cache...');
  const user_id = req.body.user_id || 1;

  try {
    // 1. Get dynamic company DB
    const companyDb = await getCompanyDbByUserId(user_id);

    // 2. Get company_id from users table
    const [companyInfo] = await datagenieDb.execute(
      `SELECT company_id FROM users WHERE id = ?`,
      [user_id]
    );

    if (!companyInfo.length) {
      return res.status(404).json({ error: 'User or company not found' });
    }

    const company_id = companyInfo[0].company_id;

    // 3. Fetch schema from the actual company DB
    const [schemaRows] = await companyDb.execute(`
      SELECT 
        TABLE_NAME as table_name,
        COLUMN_NAME as column_name,
        DATA_TYPE as data_type
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
    `);

    // 4. Save to column_descriptions table in datagenie DB
    const insertQuery = `
      INSERT INTO column_descriptions (company_id, table_name, column_name, data_type)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE data_type = VALUES(data_type)
    `;

    for (const row of schemaRows) {
      await executeWithRetry(insertQuery, [
        company_id,
        row.table_name,
        row.column_name,
        row.data_type,
      ]);
    }

    res.json({ success: true, inserted: schemaRows.length });
  } catch (err) {
    console.error('❌ Error refreshing schema cache:', err);
    res.status(500).json({ error: 'Failed to refresh schema' });
  }
});

// 💾 Step B: Save Descriptions
router.post('/save-descriptions', async (req, res) => {
  const { data, user_id = 1 } = req.body;

  if (!Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  try {
    const [companyInfo] = await datagenieDb.execute(
      `SELECT company_id FROM users WHERE id = ?`,
      [user_id]
    );
    if (!companyInfo.length) {
      return res.status(404).json({ error: 'User or company not found' });
    }

    const company_id = companyInfo[0].company_id;

    const updateQuery = `
      UPDATE column_descriptions
      SET description = ?
      WHERE company_id = ? AND table_name = ? AND column_name = ?
    `;

    for (const item of data) {
      await executeWithRetry(updateQuery, [
        item.description,
        company_id,
        item.table_name,
        item.column_name,
      ]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to save schema descriptions:', err);
    res.status(500).json({ error: 'Failed to save schema descriptions' });
  }
});

// 📤 Step C: Get full schema for current company
router.get('/', async (req, res) => {
  const user_id = parseInt(req.query.user_id || '1');

  try {
    const [companyInfo] = await datagenieDb.execute(
      `SELECT company_id FROM users WHERE id = ?`,
      [user_id]
    );
    if (!companyInfo.length) {
      return res.status(404).json({ error: 'User or company not found' });
    }

    const company_id = companyInfo[0].company_id;

    const [rows] = await datagenieDb.execute(
      `SELECT table_name, column_name, data_type, description
       FROM column_descriptions
       WHERE company_id = ?
       ORDER BY table_name, column_name`,
      [company_id]
    );

    res.json({ schema: rows });
  } catch (err) {
    console.error('❌ Failed to fetch schema:', err);
    res.status(500).json({ error: 'Failed to fetch schema info' });
  }
});

module.exports = router;
