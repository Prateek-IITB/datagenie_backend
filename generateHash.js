const bcrypt = require('bcrypt');
const password = 'Prateek2_admin';
bcrypt.hash(password, 10).then(console.log).catch(console.error);