const voca = require('voca');

const { Admin, Hearts, Polls } = require('../core/index');
const { SLACKBOT, HOUR, YAY, NAY } = require('../constants');

// Utilities

exports.homeEndpoint = function (appName) {
  return {
    path: '/',
    method: [ 'GET' ],
    handler: async (_, res) => {
      res.writeHead(200);
      res.end(`Welcome to Mirror - ${appName}!`);
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

// Publishing

exports.replyEphemeral = async function (app, oauth, command, text) {
  const { channel_id: channelId, user_id: residentId } = command;
  return exports.postEphemeral(app, oauth, channelId, residentId, text);
};

exports.postEphemeral = async function (app, oauth, channelId, residentId, text) {
  return app.client.chat.postEphemeral({
    token: oauth.bot.token,
    channel: channelId,
    user: residentId,
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

exports.publishHome = async function (app, oauth, residentId, view) {
  await app.client.views.publish({
    token: oauth.bot.token,
    user_id: residentId,
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

// Internal tools

exports.setChannel = async function (app, oauth, command, channelType) {
  if (!(await exports.isAdmin(app, oauth, command))) {
    await exports.replyAdminOnly(app, oauth, command);
    return;
  }

  let text;

  if (command.text === 'help') {
    text = 'Set the current channel as the events channel for the app. ' +
    'The app will use this channel to post polls and share public activity.';
  } else {
    const [ houseId, channelId ] = [ command.team_id, command.channel_id ];
    await Admin.updateHouse(houseId, { [channelType]: channelId });
    await app.client.conversations.join({ token: oauth.bot.token, channel: channelId });
    text = `App events channel set to *<#${channelId}>* :fire:`;
  }

  await exports.replyEphemeral(app, oauth, command, text);
};

exports.syncWorkspace = async function (app, oauth, command, syncMembers, syncChannels) {
  let text;

  if (command.text === 'help') {
    text = 'Sync the workspace to the current number of active members. ' +
    'This is important for ensuring the correct behavior of the app.';
  } else {
    text = 'Synced workspace with ';

    if (syncMembers) {
      const numResidents = await exports.syncWorkspaceMembers(app, oauth, command.team_id);
      text += `${numResidents} active residents`;
    }

    if (syncMembers && syncChannels) {
      text += ' and ';
    }

    if (syncChannels) {
      const numChannels = await exports.syncWorkspaceChannels(app, oauth);
      text += `${numChannels} public channels`;
    }
  }

  await exports.replyEphemeral(app, oauth, command, text);
};

exports.syncWorkspaceMembers = async function (app, oauth, houseId) {
  const now = new Date();
  const { members } = await app.client.users.list({ token: oauth.bot.token });

  for (const member of members) {
    if (!member.is_bot && member.id !== SLACKBOT) {
      if (member.deleted) {
        await Admin.deactivateResident(houseId, member.id);
      } else {
        await Admin.activateResident(houseId, member.id, now);
        await Hearts.initialiseResident(houseId, member.id, now);
      }
    }
  }

  const residents = await Admin.getResidents(houseId, now);
  return residents.length;
};

exports.syncWorkspaceChannels = async function (app, oauth) {
  const { channels: workspaceChannels } = await app.client.conversations.list({ token: oauth.bot.token, exclude_archived: true });
  const workspaceChannelIds = workspaceChannels.map(channel => channel.id);

  const { channels: botChannels } = await app.client.users.conversations({ token: oauth.bot.token });
  const botChannelIds = botChannels.map(channel => channel.id);

  for (const channelId of workspaceChannelIds) {
    if (!botChannelIds.includes(channelId)) {
      await app.client.conversations.join({ token: oauth.bot.token, channel: channelId });
    }
  }

  return workspaceChannels.length;
};

exports.introHomeView = function (appName) {
  const commandName = `/${voca.lowerCase(appName)}-channel`;

  const text = `:wave::skin-tone-4: Thanks for installing *${appName}.*\n\n` +
    `Set a channel using \`${commandName}\` to unlock app functionality.`;

  return {
    type: 'home',
    blocks: [ exports.blockSection(text) ],
  };
};

exports.replyAdminOnly = function (app, oauth, command) {
  const text = ':warning: This function is admin-only :warning:';
  return exports.replyEphemeral(app, oauth, command, text);
};

exports.updateVoteCounts = async function (app, oauth, body, action) {
  const now = new Date();
  const channelId = body.channel.id;
  const residentId = body.user.id;

  if (await Admin.isExempt(residentId, now)) {
    const text = ':warning: Exempt residents are not allowed to vote :warning:';
    await exports.postEphemeral(app, oauth, channelId, residentId, text);
  } else {
    const { pollId, value } = JSON.parse(action.value);
    await Polls.submitVote(pollId, residentId, now, value);

    // Update the vote counts
    const { yays, nays } = await Polls.getPollResultCounts(pollId);
    const blockIndex = body.message.blocks.length - 1; // Voting block is last
    body.message.token = oauth.bot.token;
    body.message.channel = channelId;
    body.message.blocks[blockIndex].elements = exports.makeVoteButtons(pollId, yays, nays);

    await app.client.chat.update(body.message);
  }
};

exports.makeVoteText = function (minVotes, pollLength) {
  return `At least *${minVotes} upvote(s)* are needed to pass, ` +
    `voting closes in *${pollLength / HOUR} hours*`;
};

exports.makeVoteButtons = function (pollId, yays, nays) {
  return [
    {
      type: 'button',
      action_id: 'poll-vote-up',
      text: exports.blockPlaintext(`:+1: (${yays})`),
      value: JSON.stringify({ pollId, yays, value: YAY }),
    },
    {
      type: 'button',
      action_id: 'poll-vote-down',
      text: exports.blockPlaintext(`:-1: (${nays})`),
      value: JSON.stringify({ pollId, nays, value: NAY }),
    },
  ];
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
exports.SUBMIT = exports.blockPlaintext('Submit');
