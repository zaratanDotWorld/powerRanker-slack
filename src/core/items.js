const assert = require('assert');

const { db } = require('./db');

const { dampingFactor } = require('../config');

const Admin = require('./admin');
const { PowerRanker } = require('./power');

// Items

exports.addItem = async function (workspaceId, name, metadata) {
  return db('Item')
    .insert({ workspaceId, name, metadata, active: true })
    .onConflict([ 'workspaceId', 'name' ]).merge()
    .returning('*');
};

// NOTE: also used for deletion
// NOTE: add and edit are distinct actions, since editing supports name changes
exports.editItem = async function (itemId, name, metadata, active) {
  return db('Item')
    .where({ id: itemId })
    .update({ name, metadata, active })
    .returning('*');
};

exports.getItems = async function (workspaceId) {
  return db('Item')
    .select('*')
    .where({ workspaceId })
    .where('active', true);
};

exports.getItem = async function (itemId) {
  return db('Item')
    .select('*')
    .where({ id: itemId })
    .first();
};

// Preferences

exports.getPreferences = async function (workspaceId) {
  return db('Preference')
    .where({ workspaceId })
    .select('teammateId', 'alphaItemId', 'betaItemId', 'value');
};

exports.getTeammatePreferences = async function (workspaceId, teammateId) {
  return db('Preference')
    .where({ workspaceId, teammateId })
    .select('teammateId', 'alphaItemId', 'betaItemId', 'value');
};

exports.getActivePreferences = async function (workspaceId, now) {
  return db('Preference')
    .join('Item AS AlphaItem', 'Preference.alphaItemId', 'AlphaItem.id')
    .join('Item AS BetaItem', 'Preference.betaItemId', 'BetaItem.id')
    .join('Teammate', 'Preference.teammateId', 'Teammate.slackId')
    .where('Preference.workspaceId', workspaceId)
    .where('Teammate.activeAt', '<=', now)
    .where('AlphaItem.active', true)
    .where('BetaItem.active', true)
    .select('teammateId', 'alphaItemId', 'betaItemId', 'value');
};

exports.setPreferences = async function (workspaceId, prefs) {
  return db('Preference')
    .insert(prefs.map((p) => { return { workspaceId, ...p }; }))
    .onConflict([ 'workspaceId', 'teammateId', 'alphaItemId', 'betaItemId' ]).merge();
};

// Preference Processing

exports.mergePreferences = function (currentPrefs, newPrefs) {
  const currentPrefsMap = exports.toPreferenceMap(currentPrefs);

  newPrefs.forEach((p) => {
    const prefKey = exports.toPreferenceKey(p);
    currentPrefsMap.set(prefKey, p);
  });

  return Array.from(currentPrefsMap.values());
};

exports.normalizePreference = function (preference) {
  // If already normalized, no-op
  // NOTE: Typescript would be useful here
  if (preference.alphaItemId || preference.betaItemId) {
    assert(preference.alphaItemId < preference.betaItemId, 'Invalid preference!');
    return preference;
  }

  let alphaItemId, betaItemId, value;

  // Value flows from source to target, and from beta to alpha
  if (preference.targetItemId < preference.sourceItemId) {
    alphaItemId = preference.targetItemId;
    betaItemId = preference.sourceItemId;
    value = preference.value;
  } else {
    alphaItemId = preference.sourceItemId;
    betaItemId = preference.targetItemId;
    value = 1 - preference.value;
  }

  return { alphaItemId, betaItemId, value };
};

exports.filterPreferences = async function (teammateId, preferences) {
  return preferences
    .filter(p => p.targetItemId !== p.sourceItemId)
    .map((p) => { return { teammateId, ...exports.normalizePreference(p) }; });
};

exports.toPreferenceMap = function (preferences) {
  return new Map(preferences.map(p => [ exports.toPreferenceKey(p), p ]));
};

exports.toPreferenceKey = function (preference) {
  assert(preference.teammateId && preference.alphaItemId && preference.betaItemId, 'Invalid preference!');
  return `${preference.teammateId}-${preference.alphaItemId}-${preference.betaItemId}`;
};

// Rankings

exports.getCurrentItemRankings = async function (workspaceId, now) {
  const preferences = await exports.getActivePreferences(workspaceId, now);
  return exports.getItemRankings(workspaceId, now, preferences);
};

exports.getProposedItemRankings = async function (workspaceId, newPreferences, now) {
  const preferences = await exports.getActivePreferences(workspaceId, now);
  const proposedPreferences = exports.mergePreferences(preferences, newPreferences);
  return exports.getItemRankings(workspaceId, now, proposedPreferences);
};

exports.getItemRankings = async function (workspaceId, now, preferences) {
  const items = await exports.getItems(workspaceId);
  const teammates = await Admin.getTeammates(workspaceId, now);

  const itemsSet = new Set(items.map(c => c.id));
  const formattedPreferences = preferences.map((p) => {
    return { alpha: p.alphaItemId, beta: p.betaItemId, value: p.value };
  });

  const powerRanker = new PowerRanker(itemsSet, formattedPreferences, teammates.length);
  const rankings = powerRanker.run(d = dampingFactor); // eslint-disable-line no-undef

  return items.map((item) => {
    return { id: item.id, name: item.name, ranking: rankings.get(item.id) };
  }).sort((a, b) => b.ranking - a.ranking);
};
