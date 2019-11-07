const redis = require('./lib/redis');

const time = async () => {
  const timestamp = await redis.timeAsync();
  if (timestamp && timestamp.length > 0) return timestamp[0];
  return false;
};

module.exports = time;