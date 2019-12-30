const redis = require('./lib/redis');
const { hashObject } = require('../utils');

// Maybe add some verification to stop processing if key had expired and process come back for life?
const isAdmin = (identifier, redisInstance) => async () => {
  // Set expiration time to avoid lock key when admin process fails
  const administratorWorkers = await redisInstance.incrAsync(`${identifier}:administrators`);
  if (administratorWorkers === 1) {
    await redisInstance.expireAsync(`${identifier}:administrators`, 180);
    return true;
  }

  return false;
};

const getItemFromQueue = (identifier, redisInstance) => async (timeout = null) => {
  const item = timeout
    ? await redisInstance.blpopAsync(`${identifier}:queue`, timeout)
    : await redisInstance.lpopAsync(`${identifier}:queue`);

  return item && timeout ? JSON.parse(item[1]) : JSON.parse(item);
};

const addItem = (key, redisInstance) => (item) => redisInstance
  .rpushAsync(key, JSON.stringify(item));

const addRegistersInQueue = (identifier, redisInstance) => async (
  count, query, pageSize,
) => Promise.all(
  new Array(Math.ceil(count / pageSize))
    .fill()
    .map((_, i) => ({
      page: i + 1,
      pageSize,
      query,
    }))
    .map(addItem(`${identifier}:queue`, redisInstance)),
);

const updateQueueStats = (identifier, redisInstance) => async (lastTimestamp, desiredTimestamp) => {
  await Promise.all([
    redisInstance.hsetAsync(identifier, 'lastTimestamp', lastTimestamp),
    redisInstance.hsetAsync(identifier, 'desiredTimestamp', desiredTimestamp),
  ]);

  await redisInstance.setAsync(`${identifier}:administrators`, 0);
};

const getQueueStats = (identifier, redisInstance) => async () => {
  const [lastTimestamp, desiredTimestamp] = await redisInstance.hmgetAsync(identifier, 'lastTimestamp', 'desiredTimestamp');

  return {
    lastTimestamp,
    desiredTimestamp,
  };
};

const processItemWithCacheErrorHandler = (identifier, redisInstance) => async (item, callback) => {
  const itemHash = hashObject(item);
  const key = `${identifier}:executionQueue:${itemHash}`;

  const executionCount = await redisInstance.incrbyAsync(`${identifier}:retries:${itemHash}`, 1);
  await redisInstance.setAsync(key, JSON.stringify(item));

  try {
    await callback();
  } catch (err) {
    // If maximum retries reach, go to deadLetter. Transform this number in config later
    if (executionCount === 5) {
      await addItem(`${identifier}:deadLetterQueue`, redisInstance)(item);
    } else {
      await addItem(`${identifier}:queue`, redisInstance)(item);
    }

    await redisInstance.delAsync(key);
    throw new Error('Error processing item');
  }

  await Promise.all([redisInstance.delAsync(key), redisInstance.delAsync(`${identifier}:retries:${itemHash}`)]);
};

module.exports = (operationIdentifier, overrideDefaultIdentifier = false) => {
  const redisInstance = redis.createInstance();
  const identifier = overrideDefaultIdentifier ? operationIdentifier : `monwatch:${operationIdentifier}`;

  return {
    isAdmin: isAdmin(identifier, redisInstance),
    getItemFromQueue: getItemFromQueue(identifier, redisInstance),
    addRegistersInQueue: addRegistersInQueue(identifier, redisInstance),
    getQueueStats: getQueueStats(identifier, redisInstance),
    updateQueueStats: updateQueueStats(identifier, redisInstance),
    processItemWithCacheErrorHandler: processItemWithCacheErrorHandler(identifier, redisInstance),
  };
};
