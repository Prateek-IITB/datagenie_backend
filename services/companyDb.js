// services/companyDb.js
const mysql = require('mysql2/promise');
const datagenieDb = require('./datagenieDb'); // your main database
const poolCache = {}; // cache per company

async function getCompanyDbByUserId(userId) {

  // Step 1: Get company_id and DB creds from datagenie_db
//   const [rows] = await datagenieDb.execute(`
//     SELECT c.id as companyId, c.db_host, c.db_user, c.db_password_encrypted as db_password, c.db_name, c.db_port
//     FROM users u
//     JOIN companies c ON u.company_id = c.id
//     WHERE u.id = ?
//   `, [userId]);

//   if (!rows.length) {
//     throw new Error('User or company not found');
//   }


  let rows;
  try {
    [rows] = await datagenieDb.execute(`
      SELECT c.id as companyId, c.db_host, c.db_user, c.db_password_encrypted as db_password, c.db_name, c.db_port
      FROM users u
      JOIN companies c ON u.company_id = c.id
      WHERE u.id = ?
    `, [userId]);
  } catch (err) {
    console.error("❌ Error querying datagenieDb:", err.message);
    throw err;
  }

  if (!rows.length) {
    throw new Error('User or company not found');
  }

//   console.log("✅ Fetched company DB config:", rows);

  const { companyId, db_host, db_user, db_password, db_name, db_port } = rows[0];

// console.log("Connecting with credentials:", {
//     host: db_host,
//     user: db_user,
//     password: db_password,
//     database: db_name,
//     port: db_port
// });

  // Step 2: Cache and return pool
  if (!poolCache[companyId]) {
    const pool = mysql.createPool({
      host: db_host,
      user: db_user,
      password: db_password,
      database: db_name,
      port: db_port || 3306,
      waitForConnections: true,
      connectionLimit: 5,
    });

    poolCache[companyId] = pool;
  }

  return poolCache[companyId];
}

module.exports = getCompanyDbByUserId;
