import AWS from 'aws-sdk';
import _ from 'lodash';
import moment from 'moment';
import fs from 'fs';

const config = {apiVersion: '2014-03-28', region: 'us-west-2'};

const argv = require('yargs')
  .string('app').default('app', '')
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

Promise.promisifyAll(logs);
Promise.promisifyAll(fs);

const logFileName = moment.utc().format(`[${argv.app}_log_]YYYY-MM-DDTHH_mm_ss[.log]`);

function getLogs(logGroupName, nextToken) {
  const filterPattern = argv.level ?
    `{ $.name = "${argv.app}" && $.level = ${argv.level} }` : `{ $.name = "${argv.app}" }`;

  const startTime = argv.start ?
    moment(argv.start).valueOf() : moment().add(-1, 'days').valueOf();

  const endTime = argv.end ?
    moment(argv.end).valueOf() : moment().valueOf();

  const interleaved = true;

  const params = { logGroupName, filterPattern, startTime, interleaved, endTime };

  if (nextToken) {
    _.assign(params, { nextToken });
  }

  console.log('using params', params);

  return logs.filterLogEventsAsync(params);
}

function contentsFrom(events) {
  return _.pluck(events, 'message').map(event => {
    try {
      return JSON.stringify(JSON.parse(event), null, '  ');
    } catch (e) {
      return event;
    }
  }).join('\n');
}

function getLogsAndLog(logGroupName, nextToken) {
  return getLogs(logGroupName, nextToken).then(res => {
    return {
      events: _.get(res, 'events') || [],
      nextToken: _.get(res, 'nextToken')
    };
  }).then(res => {
    const contents = contentsFrom(res.events || []);
    return fs.appendFileAsync(logFileName, contents, 'utf8').thenReturn(res);
  }).then(res => {
    if (res.nextToken) {
      return getLogsAndLog(logGroupName, res.nextToken);
    }
  });
}

export function go() {
  console.log('writing to', logFileName);

  fs.writeFileAsync(logFileName, '', 'utf8').then(res => {
    return logs.describeLogGroupsAsync({});
  }).then(res => {
    return _.get(res, 'logGroups[0].logGroupName');
  }).then(logGroupName => {
    return getLogsAndLog(logGroupName);
  }).then(res => {
    console.log('done');
  }).catch(err => {
    console.log(err);
  });
}
