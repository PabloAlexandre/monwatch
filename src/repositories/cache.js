const redis = require('./lib/redis');
const { hashObject } = require('../utils');

// Maybe add some verification to stop processing if key had expired and process come back for life?
const isAdmin = (identifier) => async () => {
  // Set expiration time to avoid lock key when admin process fails
  const administratorWorkers = await redis.hincrbyAsync(identifier, 'administrators', 1);
  if (administratorWorkers === 1) return true;

  await redis.hincrbyAsync(identifier, 'administrators', -1);
  return false;
};

const getItemFromQueue = (identifier) => async (timeout = null) => {
  const item = timeout
    ? await redis.blpopAsync(`${identifier}:queue`, timeout)
    : await redis.lpopAsync(`${identifier}:queue`);

  return item && timeout ? JSON.parse(item[1]) : JSON.parse(item);
};

const addItem = (key) => (item) => redis.rpushAsync(key, JSON.stringify(item));

const addRegistersInQueue = (identifier) => async (count, query, pageSize) => Promise.all(
  new Array(Math.ceil(count / pageSize))
    .fill()
    .map((_, i) => ({
      page: i + 1,
      pageSize,
      query,
    }))
    .map(addItem(`${identifier}:queue`)),
);

const updateQueueStats = (identifier) => async (lastTimestamp, desiredTimestamp) => {
  await Promise.all([
    redis.hsetAsync(identifier, 'lastTimestamp', lastTimestamp),
    redis.hsetAsync(identifier, 'desiredTimestamp', desiredTimestamp),
  ]);

  await redis.hincrbyAsync(identifier, 'administrators', -1);
};

const getQueueStats = (identifier) => async () => {
  const [lastTimestamp, desiredTimestamp] = await redis.hmgetAsync(identifier, 'lastTimestamp', 'desiredTimestamp');

  return {
    lastTimestamp,
    desiredTimestamp,
  };
};

const processItemWithCacheErrorHandler = (identifier) => async (item, callback) => {
  const itemHash = hashObject(item);
  const key = `${identifier}:executionQueue:${itemHash}`;

  const executionCount = await redis.incrbyAsync(`${identifier}:retries:${itemHash}`, 1);
  await redis.setAsync(key, JSON.stringify(item));

  try {
    await callback();
  } catch (err) {
    // If maximum retries reach, go to deadLetter. Transform this number in config later
    if (executionCount === 5) {
      await addItem(`${identifier}:deadLetterQueue`)(item);
    } else {
      await addItem(`${identifier}:queue`)(item);
    }

    await redis.delAsync(key);
    throw new Error('Error processing item');
  }

  await Promise.all([redis.delAsync(key), redis.delAsync(`${identifier}:retries:${itemHash}`)]);
};

module.exports = (operationIdentifier, overrideDefaultIdentifier = false) => {
  const identifier = overrideDefaultIdentifier ? operationIdentifier : `monwatch:${operationIdentifier}`;

  return {
    isAdmin: isAdmin(identifier),
    getItemFromQueue: getItemFromQueue(identifier),
    addRegistersInQueue: addRegistersInQueue(identifier),
    getQueueStats: getQueueStats(identifier),
    updateQueueStats: updateQueueStats(identifier),
    processItemWithCacheErrorHandler: processItemWithCacheErrorHandler(identifier),
  };
};
