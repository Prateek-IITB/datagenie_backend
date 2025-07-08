require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlRoutes = require('./routes/sql');
const schemaRoutes = require('./routes/schema');
const authRoutes = require('./routes/auth');

const app = express();


const allowedOrigins = [
  'https://datagenie.wizevelocity.com',
  'http://localhost:3000',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());
app.use('/api', sqlRoutes);
app.use('/api/schema', schemaRoutes);
app.use('/api/auth', authRoutes);
app.get('/', (req, res) => {
  res.send('SaaS SQL backend is running!');
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

