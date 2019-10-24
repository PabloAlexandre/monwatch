const { MongoClient } = require('mongodb');

module.exports = async (dbName) => {
  const client = await MongoClient.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/test', { 
    useUnifiedTopology: true 
  });
  return client.db(dbName || 'local');
}