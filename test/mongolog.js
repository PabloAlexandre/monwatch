const oplog = require('../index');

oplog()
  .addHandler({ database: 'test', collection: 'users', handler: console.log })
  .execute();