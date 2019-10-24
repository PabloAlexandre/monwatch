const dayjs = require('dayjs');
const defaults = require('lodash/defaults');
const omitBy = require('lodash/omitBy');
const isNull = require('lodash/isNull');

const { cache, storage } = require('./repositories');
const { delay } = require('./utils');

class HandlerProcessor {
  constructor(oplogStorage, database, collection, handler) {
    this.collectionName = collection;
    this.databaseName = database;
    this.oplogStorage = oplogStorage;
    this.handler = handler;
  }

  async start() {
    this.storage = await storage(this.databaseName, this.collectionName);
    this.cache = await cache(`${this.databaseName}:${this.collectionName}`);

    this.setupLocalWorker();
  }
  
  async throttleSetup(desiredTimestamp) {
    const diff = dayjs.unix(desiredTimestamp) - dayjs().unix();
    if(diff > 0) await delay(diff);
  } 

  async setupGlobalWorkers() {
    // review if lastTimestamp should had default value
    const stats =  await this.cache.getQueueStats();
    const {
      lastTimestamp,
      desiredTimestamp,
    } = defaults(omitBy(stats, isNull), {
      lastTimestamp: dayjs().unix(),
      desiredTimestamp: dayjs().add(2, 'second').unix(),
    });

    await this.throttleSetup(desiredTimestamp);
    const currentTimestamp = dayjs().unix();

    const query = this.oplogStorage.buildOplogQuery(this.databaseName, this.collectionName, lastTimestamp, currentTimestamp);
    const count = await this.oplogStorage.count(query);

    if(count > 0) {
      const PAGE_SIZE = 50;
      await this.cache.addRegistersInQueue(count, query, PAGE_SIZE);
      await this.cache.updateQueueStats(currentTimestamp, dayjs.unix(currentTimestamp).add(2, 'second').unix())
    } else {
      await this.cache.updateQueueStats(lastTimestamp, desiredTimestamp);
    }
  }
  
  async setupGlobalWorkersIfNeededAndGetItem() {
    if(await this.cache.isAdmin()) await this.setupGlobalWorkers();
    
    return this.cache.getItemFromQueue(5);
  } 
  
  async setupLocalWorker() {
    const item = await this.cache.getItemFromQueue() || await this.setupGlobalWorkersIfNeededAndGetItem();
    
    // if item don't exists, log waiting status

    return item ? this.process(item) : this.setupLocalWorker();
  }
  
  async process(item) {
    try {
      const registers = await this.oplogStorage.getAndPopulateOplogRequest(item, this.storage);
      await this.handler(registers);
    } catch(err) {
      console.log(err);
      /*
      * Before start to process, we should add item in execution queue register, to recover if execution fails.
      * When fails, we should to put back in queue to process. Maybe in setupGlobalWorkers?
      */
    }

    this.setupLocalWorker();
  }
}


module.exports = (oplogStorage) => ({ database, collection, handler}) => 
  new HandlerProcessor(oplogStorage, database, collection, handler);