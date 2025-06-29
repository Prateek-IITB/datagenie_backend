
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlRoutes = require('./routes/sql');
const app = express();
const schemaRoutes = require('./routes/schema');


app.use(cors());
app.use(express.json());
app.use('/api', sqlRoutes);
app.use('/api/schema', schemaRoutes);

app.get('/', (req, res) => {
  res.send('SaaS SQL backend is running!');
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

