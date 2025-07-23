// Inside your sql.js
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const mysql = require('mysql2/promise');
const getCompanyDbByUserId = require('../services/companyDb');
const datagenieDb = require('../services/datagenieDb');
const classifyQueryIntent = require('../utils/classifyQueryIntent');

const BLOCKED_KEYWORDS = [
  'DROP', 'ALTER', 'TRUNCATE', 'CREATE',
  'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'MERGE'
];

function containsDestructiveSQL(sql) {
  return BLOCKED_KEYWORDS.some(keyword =>
    new RegExp(`\\b${keyword}\\b`, 'i').test(sql)
  );
}

router.post('/generate-sql', async (req, res) => {
  let { prompt, user_id = 3, context = [] } = req.body;
  const companyDb = await getCompanyDbByUserId(user_id);

  try {
    // ⬆️ Step 1: Get schema first so we can pass it into the classifier
    const [columns] = await datagenieDb.execute(`
      SELECT table_name, column_name, data_type, description
      FROM table_columns
      WHERE company_id = (
        SELECT company_id FROM users WHERE id = ?
      )
    `, [user_id]);

    const schemaMap = {};
    columns.forEach(({ table_name, column_name, data_type, description }) => {
      if (!schemaMap[table_name]) schemaMap[table_name] = [];
      schemaMap[table_name].push(`- ${column_name} (${data_type.toUpperCase()}): ${description || 'No description'}`);
    });

    const formattedSchema = Object.entries(schemaMap)
      .map(([table, cols]) => `Table: ${table}\n${cols.join('\n')}`)
      .join('\n\n');

    // 🧠 Step 2: Use schema when classifying prompt intent/type
    const { intent, requires_schema, needs_sql } = await classifyQueryIntent(prompt, context, formattedSchema);
    console.log('🧠 sql.js fetching intent:', 'intnt:', intent, 'requires_schema', requires_schema, 'needs_sql:', needs_sql);
    if (intent === 'fresh') {
     context = [];
    }

    // 🗣️ Step 3: Handle non-data prompts early
    if (!requires_schema) {
      const followUpContext = context.map((c) => `Q: ${c.prompt}\nA: ${c.message || ''}`).join('\n\n');

      const nonDataPrompt = `
     You are a helpful assistant. Given this context and question, answer clearly. If conext is empty then consider it as a fresh question.

      ${followUpContext}

      User's question: ${prompt}
      `.trim();

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: nonDataPrompt }],
      });

      return res.json({
        requires_schema,
        intent,
        needs_sql,
        message: response.choices[0].message.content.trim(),
      });
    }

     if (requires_schema && !needs_sql) {
        // ✅ NEW CASE: Schema question but no SQL needed
        const schemaQuestionPrompt = `
      You're a database expert. A user has asked a question that needs understanding of the database schema but does not require generating SQL.

      Here’s the schema:
      ${formattedSchema}

      User's Question: "${prompt}"

      Answer clearly and concisely in plain English.
        `.trim();

        const response = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: schemaQuestionPrompt }],
        });

        return res.json({
          requires_schema,
          intent,
          needs_sql,
          message: response.choices[0].message.content.trim(),
        });
      }

    // 🛠️ Step 4: Handle data query
    const contextText = context
      .map((c, i) => `Prompt: ${c.prompt}\nSQL: ${c.sql}\nResult (sample): ${JSON.stringify(c.result?.slice(0, 2) || [])}`)
      .join('\n\n');

    const fullPrompt = `
You are a MySQL expert. You take questions from users and generate correct SQL queries using provided database schema.
You use the database schema(that includes table names, columns in each table, and column description. Column description tells you what type of data is present in that column).
If required , you can also get context from previous user propmts, SQL queries, and results. If you don not get conext then ignore it. 

Schema:
${formattedSchema}

${context.length ? `Previous Context:\n${contextText}` : ''}

User Request:
"${prompt}"

You must:
1. Describe what you understood from the user's request.
2. Explain the logic you applied and which tables/columns you used and why.
3. Call out any assumptions you made.
4. Only use tables and columns provided in the schema. Do not guess or invent columns.
5. Make sure the column used if present in the table used else make a join if required.
6. If the query involves selecting rows from a table, always add "LIMIT 100" to the end of the query, unless the user explicitly asks for more or all rows.

Expected Output Format:
Explanation: ( You are talking directly to the user here so keep your tone accordingly. Summarize your understanding, logic, assumptions. Try to be concise but clear. )
<Your Explanation>

SQL: (You must must ensure that you only return the SQL query here, if anything else is returned along with sql query then it will be considered as an error)
<SQL Code>
`.trim();

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: fullPrompt }],
    });

    const content = response.choices[0].message.content || '';
    const explanationMatch = content.match(/Explanation:\s*([\s\S]*?)\nSQL:/i);
    const explanation = explanationMatch ? explanationMatch[1].trim() : 'Explanation not found.';
    const sqlMatch = content.match(/SQL:\s*```sql\s*([\s\S]*?)```|SQL:\s*([\s\S]*)/i);
    let cleanedSQL = sqlMatch ? (sqlMatch[1] || sqlMatch[2]).trim() : '';

    if (containsDestructiveSQL(cleanedSQL)) {
      return res.json({
        requires_schema,
        intent,
        error: true,
        explanation: 'This action is blocked because it modifies the database structure or data.',
        sql: cleanedSQL,
        rows: []
      });
    }

    try {
      await companyDb.execute(`EXPLAIN ${cleanedSQL}`);
    } catch (err) {
      const retryPrompt = `The following SQL generated for user prompt failed EXPLAIN with error: ${err.message}.\n\nPrompt: ${prompt}\n\nInvalid SQL:\n${cleanedSQL}\n\nPlease correct it.`;

      const retryRes = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: retryPrompt }],
      });

      const retryContent = retryRes.choices[0].message.content || '';
      const retrySqlMatch = retryContent.match(/```sql\s*([\s\S]*?)```|SQL:\s*([\s\S]*)/i);
      cleanedSQL = retrySqlMatch ? (retrySqlMatch[1] || retrySqlMatch[2]).trim() : '';

      if (containsDestructiveSQL(cleanedSQL)) {
        return res.json({
          requires_schema,
          intent,
          needs_sql,
          error: true,
          explanation: 'Corrected SQL still contains destructive actions. Access denied.',
          sql: cleanedSQL,
          rows: []
        });
      }

      try {
        await companyDb.execute(`EXPLAIN ${cleanedSQL}`);
      } catch (retryErr) {
        return res.json({
          requires_schema,
          intent,
          needs_sql,
          error: true,
          explanation: 'The generated SQL seems incorrect. Please rephrase your query.',
          sql: cleanedSQL,
          rows: []
        });
      }
    }

    return res.json({
      requires_schema,
      intent,
      needs_sql,
      explanation,
      sql: cleanedSQL,
    });
  } catch (err) {
    console.error('❌ Error generating SQL:', err);
    res.status(500).json({ error: 'Failed to process', details: err.message });
  }
});

router.post('/execute-sql', async (req, res) => {
  const { sql, user_id = 3 } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  if (containsDestructiveSQL(sql)) {
    return res.status(403).json({
      error: 'This query modifies the database and is not allowed.',
    });
  }

  try {
    const companyDb = await getCompanyDbByUserId(user_id, datagenieDb);
    const [rows] = await companyDb.execute(sql);
    res.json({ rows });
  } catch (error) {
    console.error('SQL Execution Error:', error);
    res.status(500).json({ error: 'Failed to execute SQL', details: error.message });
  }
});



module.exports = router;
