const mysql = require('mysql2/promise');
require('dotenv').config();
// console.log('🔥 datagenieDb.js loaded');


// console.log('Datagenie DB Config:', {
//   host: process.env.DATAGENIE_DB_HOST,
//   user: process.env.DATAGENIE_DB_USER,
//   password: process.env.DATAGENIE_DB_PASSWORD,
//   database: process.env.DATAGENIE_DB_NAME,
// });


const datageniePool = mysql.createPool({
  host: process.env.DATAGENIE_DB_HOST,
  user: process.env.DATAGENIE_DB_USER,
  password: process.env.DATAGENIE_DB_PASSWORD,
  database: process.env.DATAGENIE_DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = datageniePool;
