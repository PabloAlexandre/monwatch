const redis = require('./lib/redis');
const util = require('util');

const send_command = util.promisify(redis.send_command).bind(redis);

const time = async () => {
  const timestamp = await send_command('time', null);
  if (timestamp && timestamp.length > 0) return timestamp[0];
  return false;
};

module.exports = time;