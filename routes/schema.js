const express = require('express');
const router = express.Router();
const pool = require('../services/datagenieDb.js');
const {getCompanyDbByUserId} = require('../services/companyDb.js');


// GET full schema for the user's company (deeply nested)
router.get('/', async (req, res) => {
    console.log('GET /api/schema hit with query:', req.query); // <-- ADD THIS
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
            `SELECT c.id, c.name, c.data_type, c.description
             FROM table_columns c
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
  
  const userId = req.body.user_id
  console.log("POST /api/schema/refresh hit with user id", userId);

  if (!userId) return res.status(400).json({ error: 'Missing user_id' });

  try {
    const companyDb = await getCompanyDbByUserId(userId); // connect to partner DB
    const [companyRow] = await pool.execute(
      'SELECT company_id FROM users WHERE id = ?',
      [userId]
    );
    if (!companyRow.length) return res.status(404).json({ error: 'User not found' });

    const companyId = companyRow[0].company_id;

    // Step 1: Get endpoint_id
    const [endpoints] = await pool.execute(
      'SELECT id FROM endpoints WHERE company_id = ? AND is_active = 1',
      [companyId]
    );
    if (!endpoints.length) return res.status(404).json({ error: 'No active endpoint found' });

    const endpointId = endpoints[0].id;

    // Step 2: Get current list of databases from live connection
    const [databases] = await companyDb.query('SHOW DATABASES');
    const dbNames = databases.map(row => row.Database).filter(name => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(name));

    // Fetch existing DBs for this endpoint
    const [existingDbRows] = await pool.execute(
      'SELECT id, name FROM endpoint_databases WHERE endpoint_id = ?',
      [endpointId]
    );
    const existingDbMap = new Map(existingDbRows.map(row => [row.name, row]));

    // Step 3: Update or insert DBs
    const seenDbNames = new Set();
    for (const dbName of dbNames) {
      seenDbNames.add(dbName);
      const existing = existingDbMap.get(dbName);
      if (existing) {
        await pool.execute('UPDATE endpoint_databases SET is_active = 1 WHERE id = ?', [existing.id]);
      } else {
        await pool.execute('INSERT INTO endpoint_databases (endpoint_id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())', [endpointId, dbName]);
      }
    }

    // Mark databases no longer present as inactive
    for (const db of existingDbRows) {
      if (!seenDbNames.has(db.name)) {
        await pool.execute('UPDATE endpoint_databases SET is_active = 0 WHERE id = ?', [db.id]);
      }
    }

    // Step 4: Update tables and columns for each active DB
    const [updatedDbs] = await pool.execute(
      'SELECT id, name FROM endpoint_databases WHERE endpoint_id = ? AND is_active = 1',
      [endpointId]
    );

    for (const db of updatedDbs) {
      await companyDb.query(`USE \`${db.name}\``); // switch to database

      const [tables] = await companyDb.query('SHOW TABLES');
      const tableKey = `Tables_in_${db.name}`;
      const tableNames = tables.map(row => row[tableKey]);

      // Get existing tables
      const [existingTables] = await pool.execute(
        'SELECT id, name FROM database_tables WHERE database_id = ?',
        [db.id]
      );
      const existingTableMap = new Map(existingTables.map(row => [row.name, row]));
      const seenTables = new Set();

      for (const tableName of tableNames) {
        seenTables.add(tableName);
        let tableId;

        const existing = existingTableMap.get(tableName);
        if (existing) {
          await pool.execute('UPDATE database_tables SET is_active = 1 WHERE id = ?', [existing.id]);
          tableId = existing.id;
        } else {
          const [result] = await pool.execute(
            'INSERT INTO database_tables (database_id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())',
            [db.id, tableName]
          );
          tableId = result.insertId;
        }

        const [columns] = await companyDb.query(`SHOW COLUMNS FROM \`${tableName}\``);
        const [existingCols] = await pool.execute(
          'SELECT id, name FROM table_columns WHERE table_id = ?',
          [tableId]
        );
        const existingColMap = new Map(existingCols.map(col => [col.name, col]));
        const seenCols = new Set();

        for (const col of columns) {
          seenCols.add(col.Field);
          if (existingColMap.has(col.Field)) {
            await pool.execute('UPDATE table_columns SET is_active = 1 WHERE id = ?', [existingColMap.get(col.Field).id]);
          } else {
            await pool.execute(
              'INSERT INTO table_columns (table_id, name, data_type, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(), NOW())',
              [tableId, col.Field, col.Type]
            );
          }
        }

        for (const col of existingCols) {
          if (!seenCols.has(col.name)) {
            await pool.execute('UPDATE table_columns SET is_active = 0 WHERE id = ?', [col.id]);
          }
        }
      }

      for (const table of existingTables) {
        if (!seenTables.has(table.name)) {
          await pool.execute('UPDATE database_tables SET is_active = 0 WHERE id = ?', [table.id]);
        }
      }
    }

    res.json({ success: true, message: 'Schema refreshed and metadata updated' });
  } catch (error) {
    console.error('❌ Error in /refresh:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;



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
      const { type, id, description } = desc;
      if (!type || !id || !description) continue;

      let query = '';
      let params = [];

      if (type === 'column') {
        query = `UPDATE table_columns SET description = ? WHERE id = ? AND is_active = 1`;
        params = [description, id];
      } else if (type === 'table') {
        query = `UPDATE database_tables SET description = ? WHERE id = ? AND is_active = 1`;
        params = [description, id];
      } else if (type === 'database') {
        query = `UPDATE endpoint_databases SET description = ? WHERE id = ? AND is_active = 1`;
        params = [description, id];
      } else {
        console.warn(`Unknown type "${type}" — skipping`);
        continue;
      }

      await connection.query(query, params);
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
