const redis = require('./lib/redis');

// Maybe add some verification to stop processing if key had expired and process come back for life? 
const isAdmin = identifier => async () => {
  // Set expiration time to avoid lock key when admin process fails
  const administratorWorkers = await redis.hincrbyAsync(identifier, 'administrators', 1);
  if(administratorWorkers === 1) return true;
  
  await redis.hincrbyAsync(identifier, 'administrators', -1);
  return false;
}

const getItemFromQueue = identifier => async (timeout = null) => {
  let item = timeout ? 
    await redis.blpopAsync(`${identifier}:queue`, timeout) :
    await redis.lpopAsync(`${identifier}:queue`);

  return item && timeout ? JSON.parse(item[1]) : JSON.parse(item);
}

const addRegistersInQueue = identifier => async (count, query, pageSize) => {
  return Promise.all(
    new Array(Math.ceil(count / pageSize))
    .fill()
    .map((_, i) => ({
      page: i+1,      
      pageSize: pageSize,
      query,
    }))
    .map(it => redis.rpushAsync(`${identifier}:queue`, JSON.stringify(it)))
  );
}

const updateQueueStats = identifier => async (lastTimestamp, desiredTimestamp) => {
  await Promise.all([
    redis.hsetAsync(identifier, 'lastTimestamp', lastTimestamp),
    redis.hsetAsync(identifier, 'desiredTimestamp', desiredTimestamp),
  ]);

  await redis.hincrbyAsync(identifier, 'administrators', -1);
}

const getQueueStats = identifier => async () => {
  const [ lastTimestamp, desiredTimestamp ] = await redis.hmgetAsync(identifier, 'lastTimestamp', 'desiredTimestamp');

  return {
    lastTimestamp,
    desiredTimestamp,
  };
}

module.exports = operationIdentifier => {
  const identifier = `mongolog:${operationIdentifier}`;

  return {
    isAdmin: isAdmin(identifier),
    getItemFromQueue: getItemFromQueue(identifier),
    addRegistersInQueue: addRegistersInQueue(identifier),
    getQueueStats: getQueueStats(identifier),
    updateQueueStats: updateQueueStats(identifier),
  }
};