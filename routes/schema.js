const express = require('express');
const router = express.Router();
const pool = require('../services/datagenieDb.js');

// GET full schema for the user's company (deeply nested)
router.get('/', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'Missing user_id' });

  try {
    // Get company_id from user
    const [userRows] = await pool.query('SELECT company_id FROM users WHERE id = ? AND is_active = 1', [userId]);
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found or inactive' });
    const companyId = userRows[0].company_id;

    // Fetch endpoints for this company
    const [endpoints] = await pool.query(
      'SELECT * FROM endpoints WHERE company_id = ? AND is_active = 1',
      [companyId]
    );

    for (const endpoint of endpoints) {
      // Fetch databases for this endpoint
      const [databases] = await pool.query(
        'SELECT * FROM endpoint_databases WHERE endpoint_id = ? AND is_active = 1',
        [endpoint.id]
      );

      for (const db of databases) {
        // Fetch tables for this database
        const [tables] = await pool.query(
          'SELECT * FROM database_tables WHERE database_id = ? AND is_active = 1',
          [db.id]
        );

        for (const table of tables) {
          // Fetch columns for this table
          const [columns] = await pool.query(
            `SELECT c.id, c.name, c.data_type, cd.description
             FROM table_columns c
             LEFT JOIN column_descriptions cd ON c.id = cd.column_id
             WHERE c.table_id = ? AND c.is_active = 1`,
            [table.id]
          );

          table.columns = columns;
        }

        db.tables = tables;
      }

      endpoint.databases = databases;
    }

    res.json(endpoints);
  } catch (error) {
    console.error('Error in GET /schema:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST to refresh schema (UI-triggered manual refresh)
router.post('/refresh', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

  try {
    // Perform the schema fetching logic for each endpoint and insert into DB
    // You will integrate the actual schema fetching code here (Databricks, Snowflake, etc.)
    console.log(`Refreshing schema for user_id ${user_id}...`);
    res.json({ message: 'Schema refresh initiated.' });
  } catch (error) {
    console.error('Error in POST /schema/refresh:', error);
    res.status(500).json({ error: 'Failed to refresh schema' });
  }
});

// Save column descriptions
router.post('/save-descriptions', async (req, res) => {
  const { descriptions } = req.body;
  if (!descriptions || !Array.isArray(descriptions)) {
    return res.status(400).json({ error: 'Invalid descriptions format' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const desc of descriptions) {
      const { column_id, description } = desc;
      if (!column_id || !description) continue;

      // Upsert logic for column descriptions
      await connection.query(`
        INSERT INTO column_descriptions (column_id, description)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE description = VALUES(description)
      `, [column_id, description]);
    }

    await connection.commit();
    res.json({ message: 'Descriptions saved successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error in POST /schema/save-descriptions:', error);
    res.status(500).json({ error: 'Failed to save descriptions' });
  } finally {
    connection.release();
  }
});

module.exports = router;
