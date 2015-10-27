import AWS from 'aws-sdk';
import _ from 'lodash';
import moment from 'moment';
import fs from 'fs';

const config = {apiVersion: '2014-03-28', region: 'us-west-2'};

const argv = require('yargs')
  .string('app').default('app', '')
  .string('bunnies').default('bunnies', 'yes')
  .string('last').default('last', '')
  .string('start').default('start', '')
  .string('end').default('end', '')
  .string('level').default('level', '')
  .argv;

if (process.env['AWS_ACCESS_KEY_ID']) {
  const accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];
  const sessionToken = process.env['AWS_SESSION_TOKEN'];
  _.assign(config, { accessKeyId, secretAccessKey, sessionToken })
}

const logs = new AWS.CloudWatchLogs(config);
console.log('using:', config, '\n');

Promise.promisifyAll(logs);
Promise.promisifyAll(fs);

const logFileName = moment.utc().format(`[${argv.app}_log_]YYYY-MM-DDTHH_mm_ss[.log]`);

function createParams() {
  const { level, app, category, id, ip } = argv;
  const filterArray = _.reduce({level, app, category, id, ip}, (memo, value, key) => {
    if (!value) { return memo; }
    const criteria = {
      ip: '$.IP = "?"',
      id: '$.id = "?"',
      app: '$.name = "?"',
      level: '$.level >= ?',
      category: '$.category = "?"'
    }[key];
    return memo.concat([criteria.replace('?', value)]);
  }, []);
  const filterPattern = `{ ${filterArray.join(' && ')} }`;

  const startTime = (argv.start && moment(argv.start).valueOf()) ||
    (argv.last && moment().add(-(+argv.last), 'minutes').valueOf()) ||
    (moment().add(-1, 'days').valueOf());

  const endTime = argv.end ?
    moment(argv.end).valueOf() : moment().valueOf();

  const interleaved = true;

  console.log('=======================================================');
  console.log('-   app:', argv.app);
  console.log('- level:', argv.level ? `>= ${argv.level}` : 'any');
  console.log('- filter:', filterPattern);
  console.log('- start:', moment(startTime).format());
  console.log('-   end:', moment(endTime).format());
  console.log('-  from:', moment(startTime).fromNow());
  console.log('-    to:', moment(endTime).fromNow());
  console.log('=======================================================');

  return { interleaved, startTime, endTime, filterPattern };
}

const params = createParams();

function getLogs(logGroupName, nextToken) {
  const currentParams = _.assign({}, params, { logGroupName });

  if (nextToken) {
    console.log('nextToken:', nextToken);
    _.assign(params, { nextToken });
  }

  return logs.filterLogEventsAsync(currentParams);
}

function contentsFromEvent(event) {
  return event;
}

function writeContentsFrom(events) {
  return Promise.all(_.pluck(events, 'message').map(contentsFromEvent).map(content => {
    console.log(content);
    return fs.appendFileAsync(logFileName, `${content}\n`, 'utf8');
  }));
}

function getLogsAndLog(logGroupName, nextToken) {
  return getLogs(logGroupName, nextToken).then(res => {
    return {
      events: _.get(res, 'events') || [],
      nextToken: _.get(res, 'nextToken')
    };
  }).then(res => {
    return writeContentsFrom(res.events || []).thenReturn(res);
  }).then(res => {
    const nextToken = res.nextToken;

    if (!nextToken) {
      return res;
    }

    return getLogsAndLog(logGroupName, nextToken).thenReturn(res);
  });
}

function open() {
  return fs.writeFileAsync(logFileName, '{}\n', 'utf8');
}

function close() {
  return fs.appendFileAsync(logFileName, '{}', 'utf8');
}

export function go() {
  console.log('----------------------------------------------------');
  console.log('writing to', logFileName);
  console.log('----------------------------------------------------\n');

  open().then(res => {
    return logs.describeLogGroupsAsync({});
  }).then(res => {
    return _.get(res, 'logGroups[0].logGroupName');
  }).then(logGroupName => {
    console.log('log group name:', logGroupName);
    return getLogsAndLog(logGroupName);
  }).then(res => {
    return close().thenReturn(res);
  }).then(res => {
    console.log('\n====\ndone\n====\n\ngo try:\ncat', logFileName, '| bunyan');
  }).catch(err => {
    console.log(err);
  });
}
