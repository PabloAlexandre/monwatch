const { time } = require('../src/repositories');
const dayjs = require('dayjs');

// test using dayjs
console.log(dayjs().unix());
console.log(dayjs().add(2, 'second').unix());

// test using redis time + dayjs
time().then((time) => {
  console.log(time);
  console.log(dayjs.unix(time).add(2, 'second').unix());
});