const flowRight = require('lodash/flowRight');
const reduce = require('lodash/fp/reduce');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

const composeP = (...args) => args.reduce((accumulator, currentFunction) => async (...params) => {
  const result = await currentFunction(...params);
  return accumulator(result);
});

const hashObject = flowRight(
  reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0), //eslint-disable-line
  (s) => s.split(''),
  JSON.stringify,
);

module.exports = {
  delay,
  deepClone,
  composeP,
  hashObject,
};
