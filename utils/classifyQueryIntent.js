const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function classifyQueryIntent(prompt, context = [], schema = '') {
  const contextText = context.length
    ? context.map((c, i) => `Context ${i + 1}: ${c.prompt}`).join('\n')
    : 'No context';

  const systemPrompt = `

You are a classification assistant for a database assistant tool. A user will enter a query.
Your job is to classify the prompt into the following categories:

1. intent: "fresh" if it's a new independent query, or "follow-up" if it depends on previous conversation.
2. requires_schema: "true" if the user's question is about the database, tables, columns, or any query that needs schema knowledge or "false" (can be answered directly via LLM).
3. needs_sql: true if the question actually requires generating and running an SQL query.


Clarification:
- requires_schema = true means : The answer cannot be given without using the company's database. 
- requires_schema = false means: The answer is either general, definitional, or can be inferred without needing live data access.

Only respond in the following strict JSON format:
{
  intent: 'fresh' | 'follow-up',
  requires_schema: true | false,
  needs_sql: true | false,
}

Example:
Prompt: "Do we have a column that stores user names?"
→ Output:
{
  "requires_schema": true,
  "needs_sql": false,
  "intent": "fresh"
}

Prompt: "Now filter by customers from Bangalore"
→ Output:
{
  "requires_schema": true,
  "needs_sql": true,
  "intent": "follow-up"
}

Prompt: "What can you do?"
→ Output:
{
  "requires_schema": false,
  "needs_sql": false,
  "intent": "fresh"
}

`.trim();

  const userPrompt = `
Schema:
${schema || 'Schema not available'}

Context:
${contextText}

User prompt:
${prompt}
`.trim();

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });



  const content = response.choices[0].message.content;
   console.log('Raw OpenAI Response:', content); // 🔍

  try {
    const parsed = JSON.parse(content);
    console.log('🧠 classifyQueryIntent result:', parsed);

    return parsed;

  } catch (err) {
    console.error('Error parsing intent:', err);
    return { intent: 'fresh', requires_schema: 'true' }; // default fallback
  }
}

module.exports = classifyQueryIntent;
