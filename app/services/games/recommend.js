const R = require('ramda');
const Cache = require('../../utils/cache');

const cache = Cache({ maxAge: 2000, max: 1000 });

const metricList = R.curry((metricFunction, list) =>
  R.pipe(R.values, R.reduce(metricFunction, 0))(list));

const average = list => metricList(R.add, list) / R.length(R.values(list));
const maxOf = metricList(R.max);
const minOf = metricList(R.min);
const fieldName = 'recommended';

const normalize = (schedule) => {
  const recomendationsValues = R.values(R.pluck(fieldName, schedule));
  const [max, min] = [maxOf(recomendationsValues), minOf(recomendationsValues)];
  const range = max - min;
  if (range === 0) {
    return schedule;
  }
  const normalized = R.mapObjIndexed((match, isRematchRound) => {
    if (match.status !== 'SCHEDULED') {
      return { ...match, [fieldName]: 1 };
    }
    const willBeRematch = schedule[match.rematch].status !== 'SCHEDULED';
    const score = Math.max(0, (match[fieldName] - min) / range);
    const recommends = {
      [fieldName]: willBeRematch ? score * 0.75 * (isRematchRound ? 0 : 1) : score,
      willBeRematch,
      enabled: isRematchRound ? !willBeRematch : true,
    };
    cache.set(match.id, recommends);
    return {
      ...match,
      ...recommends,
    };
  })(schedule);
  const sorted = R.sortWith([
    R.descend(R.prop('recommended')),
    R.descend(R.pipe(R.prop('updated'), d => new Date(d).getTime())),
    R.ascend(R.pipe(R.prop('id'))),
  ])(R.values(normalized));
  return R.indexBy(R.prop('id'), sorted);
};
module.exports.contest = async ({ id, gid }) => {
  // DIRTY HACK NEED TO BE RE-DEVELOPED
  const detailedGame = require('./detailedGame');
  const reccomends = cache.get(id);
  if (!reccomends) {
    console.log(`Cache not found for ${gid}`);
    const schedule = await cache.getOrSet(`g:${gid}`, async () =>
      detailedGame({ gid }).then(R.prop('schedule')));
    console.log('schedule ', R.length(R.values(schedule)));
    const related = R.pick(['enabled', fieldName, 'willBeRematch'], schedule[id]);
    return related;
  }
  return reccomends;
};
module.exports.game = (game) => {
  const { table, schedule } = game;
  if (!R.isEmpty(table) || R.isEmpty(schedule)) {
    const played = R.pipe(R.indexBy(R.prop('id')), R.mapObjIndexed(R.prop('played')))(table);
    const avgPlayed = average(played);
    const isRematchRound = minOf(played) >= table.length - 1;
    const toPlayScore = R.mapObjIndexed(R.pipe(R.subtract(avgPlayed)), played);
    const scoredSchedule = R.mapObjIndexed((match) => {
      if (match.status !== 'SCHEDULED') {
        return match;
      }
      return { ...match, [fieldName]: toPlayScore[match.home] + toPlayScore[match.visitor] };
    })(schedule);
    return {
      ...game,
      schedule: normalize(scoredSchedule, isRematchRound),
    };
  }
  return game;
};
