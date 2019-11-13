const Chance = require('chance');

const { storage } = require('./repositories');
const Monwatch = require('./monwatch');

const DB_NAME = 'test';
const COLLECTION_NAME = 'myCollection';

describe('Testing Monwatch core', () => {
  const chance = new Chance();
  Monwatch.config.queueWait = 1;

  async function insertItems(quantity) {
    const myStorage = await storage(DB_NAME, COLLECTION_NAME);
    const items = new Array(quantity).fill({}).map(() => ({
      name: chance.name(),
      city: chance.city(),
      createdAt: chance.timestamp(),
    }));

    return myStorage.collection.insertMany(items);
  }

  async function waitMonwatchEvent(instance, event) {
    return new Promise((resolve) => instance.on(event, resolve));
  }

  it('Should listen insertions in specific collection', async () => {
    const handlerCallback = jest.fn(() => Promise.resolve());

    const monwatchInstance = new Monwatch({
      database: DB_NAME,
      collection: COLLECTION_NAME,
      handler: handlerCallback,
      clusterName: chance.word(),
    });

    await monwatchInstance.start();
    const insertedItems = await insertItems(5);

    monwatchInstance.on('receive_items', () => monwatchInstance.stop());
    await waitMonwatchEvent(monwatchInstance, 'stopped');

    expect(handlerCallback).toBeCalled();
    const docsFromHandlerPayload = handlerCallback.mock.calls[0][0].map((it) => it.doc);

    expect(docsFromHandlerPayload).toHaveLength(insertedItems.ops.length);
    expect(docsFromHandlerPayload).toEqual(expect.arrayContaining(insertedItems.ops));
  });
});
