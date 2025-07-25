require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlRoutes = require('./routes/sql');
const schemaRoutes = require('./routes/schema');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();

// ✅ Add a global request logger for debugging (HIGHLY RECOMMENDED)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

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

// ✅ Route mounting — should stay like this
app.use('/api', sqlRoutes);            // e.g., /api/sql
app.use('/api/schema', schemaRoutes);  // e.g., /api/schema
app.use('/api/auth', authRoutes); 
app.use('/api/admin', adminRoutes);     // e.g., /api/auth

// ✅ Health check endpoint
app.get('/', (req, res) => {
  res.send('SaaS SQL backend is running!');
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
