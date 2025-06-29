const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const getCompanyDbByUserId = require('../services/companyDb');
const datagenieDb = require('../services/datagenieDb'); 
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/generate-sql', async (req, res) => {
  const { prompt, user_id = 1 } = req.body;
  const companyDb = await getCompanyDbByUserId(user_id);
;

  try {
    // 🔍 STEP 1: Fetch schema + descriptions
    // Get company-specific schema descriptions
    const [columns] = await datagenieDb.execute(`
    SELECT table_name, column_name, data_type, description
    FROM column_descriptions
    WHERE company_id = (
    SELECT company_id FROM users WHERE id = ?
  )
`, [user_id]);

    // 📦 STEP 2: Group by table and format descriptions
    const schemaMap = {};
    columns.forEach(({ table_name, column_name, data_type, description }) => {
      if (!schemaMap[table_name]) schemaMap[table_name] = [];
    const safeType = data_type ? data_type.toUpperCase() : 'UNKNOWN';
    schemaMap[table_name].push(
  `- ${column_name} (${safeType}): ${description || 'No description provided'}`
);
    });

    const formattedSchema = Object.entries(schemaMap)
      .map(([table, cols]) => `Table: ${table}\n${cols.join('\n')}`)
      .join('\n\n');

   
    // 🧠 STEP 3: Construct full prompt
    const fullPrompt = `
You are a MySQL expert. Given the following database schema with column descriptions, write a safe and optimized SQL query for this user request:

${formattedSchema}


User's request: "${prompt}"
You must:
1. What did you understand from the user's request
2. Describe what logic was applied to answer the question.
3. Explain clearly which tables and columns you used and why.
4. Generate a correct, efficient SQL query.


Respond in the following format:

Explanation:
<Your explanation>

SQL:
<Your SQL query>

    `.trim();

    // 🪄 STEP 4: Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: fullPrompt }],
    });

const content = response.choices[0].message.content || '';

// Extract explanation
const explanationMatch = content.match(/Explanation:\s*([\s\S]*?)\nSQL:/i);
const explanation = explanationMatch ? explanationMatch[1].trim() : 'Explanation not found.';

// Extract SQL
const sqlMatch = content.match(/SQL:\s*```sql\s*([\s\S]*?)```|SQL:\s*([\s\S]*)/i);
const cleanedSQL = sqlMatch ? (sqlMatch[1] || sqlMatch[2]).trim() : '';

    // 💾 STEP 5: Save history
    await companyDb.execute(
      `INSERT INTO query_history (user_id, prompt, generated_sql) VALUES (?, ?, ?)`,
      [user_id, prompt, cleanedSQL]
    );

    res.json({ sql: cleanedSQL, explanation: explanation,  rows: [] });
  } catch (err) {
    console.error('Error generating SQL:', err);
    res.status(500).json({ error: 'Failed to generate SQL', details: err.message });
  }
});

router.post('/execute-sql', async (req, res) => {
  const { sql, user_id=1 } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  try {
    const companyDb = await getCompanyDbByUserId(1, datagenieDb);
    const [rows] = await companyDb.execute(sql);
    res.json({ rows });
  } catch (error) {
    console.error('SQL Execution Error:', error);
    res.status(500).json({ error: 'Failed to execute SQL', details: error.message });
  }
});




router.get('/query-history', async (req, res) => {
  const user_id = 1; // Hardcoded for now
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = parseInt(req.query.offset, 10) || 0;
  console.log(`Fetching query history for user ${user_id} with limit ${limit} and offset ${offset}`);
  try {
    const [rows] = await companyDb.execute(
      `SELECT id, prompt, generated_sql, created_at FROM query_history
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [user_id]
    );
    res.json({ history: rows });
  } catch (error) {
    console.error('Error fetching query history:', error);
    res.status(500).json({ error: 'Failed to fetch query history' });
  }
});


module.exports = router;

