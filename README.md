<p align="center" vertical-align="center">
  <img src="https://app.kenoby.com/images/kenoby-logo-new.3b1beb26.svg" alt="Kenoby" width="400"/>
</p>

# Monwatch

A lib to watch MongoDB changes using oplog. Is highly available and works in parallel. Some features:

  - Fault tolerance
  - Highly Available
  - Worker and Cluster Mode
  - Not interfer in usage. You can use to index in ElasticSearch or any other thing you would like to do.

## Installing / Getting started

To getting started, add this repository in your package.json dependency

```json
"dependencies": {
  "monwatch": "git@github.com:Kenoby-Labs/monwatch.git"
}
```

After that, just import in your code:

```javascript
const Monwatch = require('monwatch');

new Monwatch({
  database: 'myDB',
  collection: 'test',
  clusterName: 'myCluster',
  handler: (items) => {},
}).start();
```

## How it works

Monwatch was designed to read [MongoDB oplog](https://docs.mongodb.com/manual/core/replica-set-oplog/) and process all changes from database. Oplog is a mechanism of MongoDB to replicate data over all replicas, we can know when some changes occur only watching this collection. In Monwatch, we use this concept to watch changes and process them. We have an worker that process and watch this changes.

![Diagram of Monwatch](https://user-images.githubusercontent.com/3194874/67714561-e7c75b00-f9a6-11e9-88fb-0aaf317f0a6b.png)
  
To make Monwatch highly available and work in parallel, we design it to be an worker with no central point of failure. Usually, in this solutions, we have a central point to manage all workers. In our case, any Monwatch instance can be an manager for all of other instances and at same time can process the instructions. To achieve this, each worker ask in one atomic operation to take control over all process. When someone is elected as admin, no other can be. Next, admin will search in MongoDB how many operations has been saved in oplog collection between a range of time and will save and distribute all instructions in a queue. After that, all workers, can get this instructions and process them. Admin will be deelected after set instructions, so it comes back as normal worker. When no more messages are available, the process of elect some manager will return's.

To be fault tolerance and avoid duplications in this process, when some worker get an instruction, we pop item from queue and put in a running queue. If some error occurs or worker no more available, we put again in default queue to another worker get this item. We have a dead letter queue too, when some instructions fails more than X times.

## Configuring Monwatch

Monwatch has some parameters and configurations:

### Constructor Options
When we initialize Monwatch, we need to pass 4 parameters: `database`, `collection`, `clusterName` and `handler`. 

- `database` - Is a name of database of you would like to listen
- `collection` - The name of collection you would like to watch
- `clusterName` - An unique name to you cluster. It helps to separate two Monwatch process when `database` and `collection` are equals. For example: You need to index in ElasticSearch when some item changes in collection. You need too to send email when new items comes to collection. Maybe you would like to have two process of Monwatch running this, because both are different operations. You can give two differents `clusterName`, so if one process fail, another won't be affected.
- `handler` - The callback invoked with all items founded in oplog search

All parameters are required

### Event emmiters

Monwatch has an event emmiter to track some events in process:

- `waiting_instructions` - When some worker is admin and this worker is waiting for instructions
- `setting_instructions` - When this worker will be an admin
- `instructions_setted` - When admin worker set all instructions to another workers and has items
- `no_instructions` - When admin tries to set instructions, but don't have instructions available
- `no_items` - When normal worker tries to wait for items but reaches timeout and don't found items
- `receive_items` - When workers found items
- `error_processing` - When worker tries to process this items, but can't
- `stopped` - When Monwatch process stops

To listen this events, you need to do this:

```javascript
const Monwatch = require('monwatch');

new Monwatch({...})
  .on('receive_items', (pid) => console.log(`New Items in process ${pid}`))
  .on('error_processing', (err) => console.error(err))
  .on('setting_instructions', (pid) => console.log(`Process ${pid} is admin`))
  .start();
```

### Environments

We need to set two environment variables to run Monwatch.

`MONGO_URI` - Is MongoDB inline connection url (Ex. mongodb://localhost:27017/test) <br>
`REDIS_URI` - Is Redis inline connection url (Ex. redis://localhost:6379)

We have plans to in future the possibility to configure this credentials in Monwatch constructor, but for now is only the option to configure connections.

## Developing

### Prerequisites
To contribute and start developing in Monwatch, you'll need to install `docker`, `docker-compose` and have `nodejs` installed in your machine.

- [Installing Docker](https://docs.docker.com/v17.09/engine/installation/)
- [Installing Docker Compose](https://docs.docker.com/compose/install/)
- [Installing NodeJS](https://nodejs.org/en/)


### Setting up Dev

To run Monwatch, you need to [configure MongoDB Replica Set Mode in Docker](https://www.sohamkamani.com/blog/2016/06/30/docker-mongo-replica-set/). First, you need to start all services in docker compose:

```shell
docker-compose -f docker-compose-dev.yml up
```

When containers starts to running, execute in another terminal:

```shell
docker exec -it mongo mongo
```

After that, execute: 

```javascript
db = (new Mongo('localhost:27017')).getDB('test')
```

and:

```javascript
rs.initiate({
  "_id" : "rs0",
  "members" : [{ "_id" : 0, "host" : "localhost:27017" }]
})
```

After run this command, you should exit from terminal. And thats all!

With replica set enabled, you can use this MongoDB to watch oplog. This process is necessary because MongoDB only uses oplog when you have replica set enabled, So, without configure this you can't watch oplog collection because MongoDB don't need to replicate if we don't have replicas.

### Testing

To run project tests, you should use this command:

```
npm run test
```

If you would like to develop using TDD, you can use:

```
npm run test:watch
```

### Versioning and Commits

We use [SemVer](http://semver.org/) for set project versions.

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) and [Commitizen](http://commitizen.github.io/) to keep a pattern in our commits.

To organize branchs and deploys, we use [GitFlow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow)


### Style guide

We use [Airbnb Javascript Styleguide](https://github.com/airbnb/javascript) for NodeJS;