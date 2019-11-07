const { storage } = require('./repositories');
const handlerProcessor = require('./handlerProcessor');

module.exports = function monwatch(config) {
  return {
    config,
    handlers: [],
    addHandler(handler) {
      this.handlers.push(handler);
      return this;
    },
    async execute() {
      const oplog = await storage('local', 'oplog.rs');

      const handlerProcessorWithOplog = handlerProcessor(oplog);
      this.handlers.forEach((it) => handlerProcessorWithOplog(it).start());
    },
  };
};
