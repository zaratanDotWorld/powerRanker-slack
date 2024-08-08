const { db } = require('./db');

// Workspaces

exports.addWorkspace = async function (slackId, name) {
  return db('Workspace')
    .insert({ slackId, name })
    .onConflict('slackId').ignore();
};

exports.getWorkspace = async function (slackId) {
  return db('Workspace')
    .where({ slackId })
    .select('*')
    .first();
};

exports.updateWorkspaceConfig = async function (slackId, config) {
  // NOTE: May be possible as a single operation using a jsonb datatype
  const workspace = await exports.getWorkspace(slackId);
  config = { ...workspace.config, ...config };

  return db('Workspace')
    .where({ slackId })
    .update({ config })
    .returning('*');
};

// Teammates

exports.getTeammate = async function (teammateId) {
  return db('Teammate')
    .where({ slackId: teammateId })
    .select('*')
    .first();
};

exports.getTeammates = async function (workspaceId, now) {
  return db('Teammate')
    .where({ workspaceId })
    .where('activeAt', '<=', now)
    .select('*');
};

// Voting teammates are active && !exempt
exports.getVotingTeammates = async function (workspaceId, now) {
  return db('Teammate')
    .where({ workspaceId })
    .where('activeAt', '<=', now)
    .where(function () { exports.teammateNotExempt(this, now); })
    .select('*');
};

exports.activateTeammate = async function (workspaceId, slackId, activeAt) {
  // No-op if already active or exempt
  const teammate = await exports.getTeammate(slackId);
  if (teammate && (teammate.activeAt || teammate.exemptAt)) { return; }

  return db('Teammate')
    .insert({ workspaceId, slackId, activeAt, exemptAt: null })
    .onConflict('slackId').merge();
};

exports.deactivateTeammate = async function (workspaceId, slackId) {
  return db('Teammate')
    .insert({ workspaceId, slackId, activeAt: null })
    .onConflict('slackId').merge();
};

exports.exemptTeammate = async function (workspaceId, slackId, exemptAt) {
  // No-op if already exempt
  const teammate = await exports.getTeammate(slackId);
  if (teammate && teammate.exemptAt && teammate.exemptAt <= exemptAt) { return; }

  return db('Teammate')
    .insert({ workspaceId, slackId, exemptAt })
    .onConflict('slackId').merge();
};

exports.unexemptTeammate = async function (workspaceId, slackId, activeAt) {
  return db('Teammate')
    .insert({ workspaceId, slackId, activeAt, exemptAt: null })
    .onConflict('slackId').merge();
};

exports.isExempt = async function (teammateId, now) {
  const teammate = await exports.getTeammate(teammateId);
  return Boolean(teammate.exemptAt && teammate.exemptAt <= now);
};

// Subqueries

exports.teammateNotExempt = function (db, now) {
  return db.whereNull('Teammate.exemptAt')
    .orWhere('Teammate.exemptAt', '>', now);
};
