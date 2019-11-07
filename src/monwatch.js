const dayjs = require('dayjs');
const defaults = require('lodash/defaults');
const omitBy = require('lodash/omitBy');
const isNull = require('lodash/isNull');

const { cache, storage, time } = require('./repositories');
const { delay } = require('./utils');

class Monwatch {
  constructor({ database, collection, handler }) {
    this.collectionName = collection;
    this.databaseName = database;
    this.handler = handler;
    this.subscribers = {};
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }

  async start() {
    this.oplogStorage = await storage('local', 'oplog.rs');
    this.storage = await storage(this.databaseName, this.collectionName);
    this.cache = await cache(`${this.databaseName}:${this.collectionName}`);
    this.stopped = false;

    return this.setupLocalWorker();
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
    const diff = dayjs.unix(desiredTimestamp) - currentTime;
    if (diff > 0) await delay(diff);
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
      desiredTimestamp: dayjs.unix(time).add(2, 'second').unix(),
    });

    await this.throttleSetup(desiredTimestamp);
    const currentTimestamp = await time();

    const query = this.oplogStorage
      .buildOplogQuery(this.databaseName, this.collectionName, lastTimestamp, currentTimestamp);

    const count = await this.oplogStorage.count(query);

    if (count > 0) {
      const PAGE_SIZE = 50;
      await this.cache.addRegistersInQueue(count, query, PAGE_SIZE);
      await this.cache.updateQueueStats(currentTimestamp, dayjs.unix(currentTimestamp).add(2, 'second').unix());
      this.emit('instructions_setted');
    } else {
      this.emit('no_instructions');
      await this.cache.updateQueueStats(lastTimestamp, desiredTimestamp);
    }
  }

  async setupGlobalWorkersIfNeededAndGetItem() {
    if (await this.cache.isAdmin()) {
      await this.setupGlobalWorkers();
    } else {
      this.emit('waiting_instructions');
    }

    return this.cache.getItemFromQueue(5);
  }

  async setupLocalWorker() {
    const item = await this.cache.getItemFromQueue()
      || await this.setupGlobalWorkersIfNeededAndGetItem();

    if (!item) {
      this.emit('no_items');
      return this.stopped ? null : this.setupLocalWorker();
    }

    return this.process(item);
  }

  async process(item) {
    try {
      const registers = await this.oplogStorage.getAndPopulateOplogRequest(item, this.storage);
      await this.handler(registers);
    } catch (err) {
      this.emit('error_processing', err);

      /*
      * Before start to process, we should add item in execution queue register, to recover if
      * execution fails. When fails, we should to put back in queue to process.
      * Maybe in setupGlobalWorkers?
      */
    }

    if (!this.stopped) {
      this.setupLocalWorker();
    }
  }
}

module.exports = Monwatch; // eslint-disable-line
