const delay = ms => new Promise((resolve) => setTimeout(resolve, ms));

const deepClone = obj => JSON.parse(JSON.stringify(obj));

const composeP = (...args) => {
  return args.reduce((accumulator, currentFunction) => async (...params) => {
    const result = await currentFunction(...params);
    return accumulator(result);
  });
}

module.exports = {
  delay,
  deepClone,
  composeP
};