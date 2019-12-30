const dayjs = require('dayjs');
const defaults = require('lodash/defaults');
const omitBy = require('lodash/omitBy');
const isNull = require('lodash/isNull');

const { cache, storage, time } = require('./repositories');
const { delay } = require('./utils');

const defaultConfig = {
  pageSize: 50,
  queueWait: 5,
};

class Monwatch {
  constructor({
    database, collection, handler, clusterName,
  }) {
    this.collectionName = collection;
    this.databaseName = database;
    this.handler = handler;
    this.clusterName = clusterName;
    this.subscribers = {};
    this.stopped = false;
    this.onStop = null;
  }

  stop() {
    this.stopped = true;
    this.onStop = () => this.emit('stopped');
  }

  isStopped() {
    return this.stopped;
  }

  async start() {
    this.oplogStorage = await storage('local', 'oplog.rs');
    this.storage = await storage(this.databaseName, this.collectionName);
    this.cache = await cache(`${this.clusterName}:${this.databaseName}:${this.collectionName}`);
    this.stopped = false;
    this.config = defaultConfig;

    this.setupLocalWorker();
  }

  on(event, callback) {
    if (!this.subscribers[event]) this.subscribers[event] = [];
    this.subscribers[event].push(callback);

    return this;
  }

  emit(event, message) {
    if (this.subscribers[event]) {
      this.subscribers[event].forEach((it) => it(message || process.pid));
    }
  }

  // eslint-disable-next-line
  async throttleSetup(desiredTimestamp) {
    const currentTime = await time();
    const diff = parseInt(desiredTimestamp, 10) - parseInt(currentTime, 10);
    if (diff > 0) await delay(diff * 1000);
  }

  async setupGlobalWorkers() {
    this.emit('setting_instructions');

    const defaultLastTimestamp = await time();
    // review if lastTimestamp should had default value
    const stats = await this.cache.getQueueStats();
    const {
      lastTimestamp,
      desiredTimestamp,
    } = defaults(omitBy(stats, isNull), {
      lastTimestamp: defaultLastTimestamp,
      desiredTimestamp: dayjs.unix(defaultLastTimestamp).add(this.config.queueWait, 'second').unix(),
    });

    await this.throttleSetup(desiredTimestamp);
    const currentTimestamp = await time();
    const query = this.oplogStorage
      .buildOplogQuery(this.databaseName, this.collectionName, lastTimestamp, currentTimestamp);

    const count = await this.oplogStorage.count(query);

    if (count > 0) {
      const PAGE_SIZE = this.config.pageSize;
      await this.cache.addRegistersInQueue(count, query, PAGE_SIZE);
      await this.cache.updateQueueStats(currentTimestamp, dayjs.unix(currentTimestamp).add(this.config.queueWait, 'second').unix());
      this.emit('instructions_setted');
    } else {
      this.emit('no_instructions');
      await this.cache.updateQueueStats(lastTimestamp, dayjs.unix(currentTimestamp).add(this.config.queueWait, 'second').unix());
    }
  }

  async setupGlobalWorkersIfNeededAndGetItem() {
    if (await this.cache.isAdmin()) {
      await this.setupGlobalWorkers();
    } else {
      this.emit('waiting_instructions');
    }

    return this.cache.getItemFromQueue(this.config.queueWait);
  }

  async setupLocalWorker() {
    const item = await this.cache.getItemFromQueue()
      || await this.setupGlobalWorkersIfNeededAndGetItem();

    if (!item) {
      this.emit('no_items');

      if (this.isStopped()) {
        if (this.onStop) return this.onStop();

        return null;
      }

      return this.setupLocalWorker();
    }

    return this.process(item);
  }

  async process(item) {
    this.emit('receive_items');

    await this.cache.processItemWithCacheErrorHandler(item, async () => {
      try {
        const registers = await this.oplogStorage.getAndPopulateOplogRequest(item, this.storage);
        await this.handler(registers);
      } catch (err) {
        this.emit('error_processing', err);
      }
    });

    /*
    * Before start to process, we should add item in execution queue register, to recover if
    * execution fails. When fails, we should to put back in queue to process.
    * Maybe in setupGlobalWorkers?
    */

    if (!this.isStopped()) {
      this.setupLocalWorker();
    } else if (this.onStop) {
      this.onStop();
    }
  }
}

module.exports = Object.assign(Monwatch, {
  config: defaultConfig,
}); // eslint-disable-line
