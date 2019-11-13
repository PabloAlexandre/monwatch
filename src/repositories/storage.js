/* eslint no-underscore-dangle: 0 */
const { Timestamp } = require('mongodb');
const property = require('lodash/property');
const map = require('lodash/fp/map');

const mongo = require('./lib/mongo');
const { deepClone, composeP } = require('../utils');

const formatQuery = (query) => {
  if (!query.ts) return query;
  const newQuery = deepClone(query);

  /*
  * For some reason, bson Timestamp invert Timestamp parameters order.
  * First parameter is low and last is high.
  */
  if (newQuery.ts.$gt) newQuery.ts.$gt = Timestamp(0, newQuery.ts.$gt);
  if (newQuery.ts.$lte) newQuery.ts.$lte = Timestamp(0, newQuery.ts.$lte);

  return newQuery;
};

const buildOplogQuery = (dbName, collection, minimunTime, maximunTime) => {
  const query = {
    ns: `${dbName}.${collection}`,
    ts: {},
  };

  if (minimunTime) query.ts.$gt = minimunTime;
  if (maximunTime) query.ts.$lte = maximunTime;

  return query;
};

const count = (collection) => composeP(
  (query) => collection.countDocuments(query),
  formatQuery,
);

const find = (collection) => composeP(
  (query) => collection.find(query).toArray(),
  formatQuery,
);

const findPaginated = (collection) => (query, page, pageSize) => collection.find(formatQuery(query))
  .skip((page - 1) * pageSize)
  .limit(pageSize)
  .toArray();

const groupOplogRegister = (register) => {
  const diff = register.o.$set ? register.o.$set : register.o;
  const _id = register.o2 ? register.o2._id : register.o._id;

  return {
    _id,
    diff,
    operation: register.op,
  };
};

const getAndPopulateOplogRequest = (oplogCollection) => async (oplogInstructions, storage) => {
  const { query, page, pageSize } = oplogInstructions;

  const oplogRegisters = await composeP(
    map(groupOplogRegister),
    () => findPaginated(oplogCollection)(query, page, pageSize),
  )();

  const registers = await storage.find({
    _id: { $in: oplogRegisters.map(property('_id')) },
  });

  return oplogRegisters.map((it) => ({
    ...it,
    doc: registers.find((doc) => doc._id.toString() === it._id.toString()),
  }));
};

module.exports = async (dbName, collectionName) => {
  const db = await mongo(dbName);
  const collection = db.collection(collectionName);

  return {
    collection,
    count: count(collection),
    find: find(collection),
    findPaginated: findPaginated(collection),
    buildOplogQuery,
    getAndPopulateOplogRequest: getAndPopulateOplogRequest(collection),
  };
};
