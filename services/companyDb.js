const mysql = require('mysql2/promise');
const datagenieDb = require('./datagenieDb'); // connection to datagenie_db
const poolCache = {}; // keyed by companyId or endpointId

// 1️⃣ Use when you only have the userId (like on frontend actions)
async function getCompanyDbByUserId(userId) {
  let rows;
  try {
    [rows] = await datagenieDb.execute(`
      SELECT c.id as companyId, e.id as endpointId, e.host_url, e.username, e.password as db_password, ed.name as db_name
      FROM users u
      JOIN companies c ON u.company_id = c.id
      JOIN endpoints e ON c.id = e.company_id AND e.is_active = 1
      JOIN endpoint_databases ed ON ed.endpoint_id = e.id AND ed.is_active = 1
      WHERE u.id = ?
      LIMIT 1
    `, [userId]);
  } catch (err) {
    console.error("❌ Error querying datagenieDb:", err.message);
    throw err;
  }

  if (!rows.length) throw new Error('User or company not found');

  const { companyId, endpointId, host_url, username, db_password, db_name } = rows[0];

  // Use endpointId as key for better granularity
  if (!poolCache[endpointId]) {
    const pool = mysql.createPool({
      host: host_url,
      user: username,
      password: db_password,
      database: db_name,
      // port: port || 3306,
      waitForConnections: true,
      connectionLimit: 5,
    });

    poolCache[endpointId] = pool;
  }

  return poolCache[endpointId];
}

// 2️⃣ Use this for system tasks like schema refresh, where you only have endpointId + dbName
async function getCompanyDbByEndpoint(endpointId, dbName) {
  const [rows] = await datagenieDb.execute(`
    SELECT host_url, username, password as db_password
    FROM endpoints
    WHERE id = ? AND is_active = 1
  `, [endpointId]);

  if (!rows.length) throw new Error('Endpoint not found or inactive');

  const { host_url, username, db_password, port } = rows[0];
  const cacheKey = `${endpointId}_${dbName}`;

  if (!poolCache[cacheKey]) {
    const pool = mysql.createPool({
      host: host_url,
      user: username,
      password: db_password,
      database: dbName,
      // port: port || 3306,
      waitForConnections: true,
      connectionLimit: 5,
    });

    poolCache[cacheKey] = pool;
  }

  return poolCache[cacheKey];
}

module.exports = {
  getCompanyDbByUserId,
  getCompanyDbByEndpoint
};
