# Mongolog

## Example:

```
const oplog = require('mongolog')

oplog()
  .addHandler({ database: 'test', collection: 'users', handler: console.log })
  .execute();
```