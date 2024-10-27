const voca = require('voca');

const { Admin } = require('../core/index');
const { SLACKBOT } = require('../constants');

// Utilities

exports.homeEndpoint = function (appName) {
  return {
    path: '/',
    method: [ 'GET' ],
    handler: async (_, res) => {
      res.writeHead(200);
      res.end(`Welcome to ${appName}!`);
    },
  };
};

exports.getUser = async function (app, oauth, userId) {
  return app.client.users.info({
    token: oauth.bot.token,
    user: userId,
  });
};

exports.isAdmin = async function (app, oauth, command) {
  const { user } = await exports.getUser(app, oauth, command.user_id);
  return user.is_admin;
};

exports.parseUrl = function (url) {
  url = url.startsWith('http') ? url : `https://${url}`;
  try {
    return new URL(url);
  } catch {}
};

// Entry points

exports.beginHome = function (appName, body, event) {
  const now = new Date();
  const workspaceId = body.team_id;
  const teammateId = event.user;

  console.log(`${appName} home - ${workspaceId} x ${teammateId}`);

  return { now, workspaceId, teammateId };
};

exports.beginAction = function (actionName, body) {
  const now = new Date();
  const workspaceId = body.team.id;
  const teammateId = body.user.id;

  console.log(`${actionName} - ${workspaceId} x ${teammateId}`);

  return { now, workspaceId, teammateId };
};

exports.beginCommand = function (commandName, command) {
  const now = new Date();
  const workspaceId = command.team_id;
  const teammateId = command.user_id;

  console.log(`${commandName} - ${workspaceId} x ${teammateId}`);

  return { now, workspaceId, teammateId };
};

// Publishing

exports.replyEphemeral = async function (app, oauth, command, text) {
  const { channel_id: channelId, user_id: teammateId } = command;
  return exports.postEphemeral(app, oauth, channelId, teammateId, text);
};

exports.postEphemeral = async function (app, oauth, channelId, teammateId, text) {
  return app.client.chat.postEphemeral({
    token: oauth.bot.token,
    channel: channelId,
    user: teammateId,
    text,
  });
};

exports.postMessage = async function (app, oauth, channelId, text, blocks) {
  return app.client.chat.postMessage({
    token: oauth.bot.token,
    channel: channelId,
    text,
    blocks,
  });
};

exports.postReply = async function (app, oauth, channelId, ts, text, blocks) {
  return app.client.chat.postMessage({
    token: oauth.bot.token,
    channel: channelId,
    thread_ts: ts,
    text,
    blocks,
  });
};

exports.publishHome = async function (app, oauth, teammateId, view) {
  await app.client.views.publish({
    token: oauth.bot.token,
    user_id: teammateId,
    view,
  });
};

exports.openView = async function (app, oauth, triggerId, view) {
  return app.client.views.open({
    token: oauth.bot.token,
    trigger_id: triggerId,
    view,
  });
};

exports.pushView = async function (app, oauth, triggerId, view) {
  return app.client.views.push({
    token: oauth.bot.token,
    trigger_id: triggerId,
    view,
  });
};

exports.addReaction = async function (app, oauth, payload, emoji) {
  return app.client.reactions.add({
    token: oauth.bot.token,
    channel: payload.channel,
    timestamp: payload.event_ts,
    name: emoji,
  });
};

exports.getMessage = async function (app, oauth, channelId, ts) {
  return app.client.conversations.history({
    token: oauth.bot.token,
    channel: channelId,
    latest: ts,
    inclusive: true,
    limit: 1,
  });
};

// Internal tools

exports.setChannel = async function (app, oauth, command) {
  if (!(await exports.isAdmin(app, oauth, command))) {
    await exports.replyAdminOnly(app, oauth, command);
    return;
  }

  let text;

  if (command.text === 'help') {
    text = 'Set the current channel as the events channel for the app. ' +
    'The app will use this channel to post polls and share public activity.';
  } else {
    const [ workspaceId, channelId ] = [ command.team_id, command.channel_id ];
    await Admin.updateWorkspaceConfig(workspaceId, { channel: channelId });

    await app.client.conversations.join({ token: oauth.bot.token, channel: channelId });
    text = `App events channel set to *<#${channelId}>* :fire:`;
  }

  await exports.replyEphemeral(app, oauth, command, text);
};

exports.syncWorkspace = async function (app, oauth, command) {
  const now = new Date();

  let text;

  if (command.text === 'help') {
    text = 'Sync the workspace to the current number of active members. ' +
    'This is important for ensuring the correct behavior of the app.';
  } else {
    text = 'Synced workspace with ';

    const numTeammates = await exports.syncWorkspaceMembers(app, oauth, command.team_id, now);
    text += `${numTeammates} active residents`;
  }

  await exports.replyEphemeral(app, oauth, command, text);
};

exports.syncWorkspaceMembers = async function (app, oauth, workspaceId, now) {
  const { members } = await app.client.users.list({ token: oauth.bot.token });

  for (const member of members) {
    await exports.syncWorkspaceMember(workspaceId, member, now);
  }

  const residents = await Admin.getTeammates(workspaceId, now);
  return residents.length;
};

exports.syncWorkspaceMember = async function (workspaceId, member, now) {
  if (!member.is_bot && member.id !== SLACKBOT) {
    if (member.deleted) {
      await Admin.deactivateTeammate(workspaceId, member.id);
    } else {
      await Admin.activateTeammate(workspaceId, member.id, now);
    }
  }
};

exports.joinChannel = async function (app, oauth, channelId) {
  return app.client.conversations.join({ token: oauth.bot.token, channel: channelId });
};

exports.replyAdminOnly = function (app, oauth, command) {
  const text = ':warning: This function is admin-only :warning:';
  return exports.replyEphemeral(app, oauth, command, text);
};

exports.parseTitlecase = function (text) {
  return voca(text).trim().lowerCase().titleCase().value();
};

exports.parseLowercase = function (text) {
  return voca(text).trim().lowerCase().value();
};

exports.getInputBlock = function (body, blockIdx) {
  // https://api.slack.com/reference/interaction-payloads/views#view_submission_fields
  const realIdx = (blockIdx < 0) ? body.view.blocks.length + blockIdx : blockIdx;
  const blockId = body.view.blocks[realIdx].block_id;
  return body.view.state.values[blockId];
};

exports.feedbackLink = '<mailto:support@zaratan.world|Submit Feedback>';

// Block rendering

exports.blockPlaintext = function (text) {
  return { type: 'plain_text', emoji: true, text };
};

exports.blockMarkdown = function (text) {
  return { type: 'mrkdwn', text };
};

exports.blockHeader = function (text) {
  return { type: 'header', text: exports.blockPlaintext(text) };
};

exports.blockSection = function (text) {
  return { type: 'section', text: exports.blockMarkdown(text) };
};

exports.blockButton = function (action, text) {
  return { type: 'button', action_id: action, text: exports.blockPlaintext(text) };
};

exports.blockDivider = function () {
  return { type: 'divider' };
};

exports.blockActions = function (elements) {
  return { type: 'actions', elements };
};

exports.blockInput = function (label, element) {
  return { type: 'input', label: exports.blockPlaintext(label), element };
};

exports.blockOptionGroup = function (label, options) {
  return { label: exports.blockPlaintext(label), options };
};

exports.CLOSE = exports.blockPlaintext('Cancel');
exports.BACK = exports.blockPlaintext('Back');
exports.NEXT = exports.blockPlaintext('Next');
exports.SUBMIT = exports.blockPlaintext('Submit');
