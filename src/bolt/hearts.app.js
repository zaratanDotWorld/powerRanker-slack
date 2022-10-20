require('dotenv').config();

const { App, LogLevel } = require('@slack/bolt');

const Hearts = require('../modules/hearts');
const Polls = require('../modules/polls');
const Admin = require('../modules/admin');

const { heartsPollLength } = require('../config');
const { YAY } = require('../constants');
const { sleep } = require('../utils');

const blocks = require('./blocks');

let res;
let heartsOauth;

// Create the app

const home = {
  path: '/',
  method: [ 'GET' ],
  handler: async (_, res) => {
    res.writeHead(200);
    res.end('Welcome to Mirror - Hearts!');
  }
};

const app = new App({
  logLevel: LogLevel.DEBUG,
  clientId: process.env.HEARTS_CLIENT_ID,
  clientSecret: process.env.HEARTS_CLIENT_SECRET,
  signingSecret: process.env.HEARTS_SIGNING_SECRET,
  stateSecret: process.env.STATE_SECRET,
  customRoutes: [ home ],
  scopes: [
    'channels:history', 'channels:read',
    'chat:write',
    'commands',
    'users:read'
  ],
  installationStore: {
    storeInstallation: async (installation) => {
      return Admin.updateHouse({ slackId: installation.team.id, heartsOauth: installation });
    },
    fetchInstallation: async (installQuery) => {
      ({ heartsOauth } = await Admin.getHouse(installQuery.teamId));
      return heartsOauth;
    },
    deleteInstallation: async (installQuery) => {
      return Admin.updateHouse({ slackId: installQuery.teamId, heartsOauth: null });
    }
  },
  installerOptions: { directInstall: true }
});

// Publish the app home

app.event('app_home_opened', async ({ body, event }) => {
  if (event.tab === 'home') {
    const houseId = body.team_id;
    const residentId = event.user;

    await Admin.addResident(houseId, residentId);
    console.log(`Added resident ${residentId}`);

    const now = new Date();
    await Hearts.initialiseResident(houseId, residentId, now);
    await sleep(5);

    const hearts = await Hearts.getResidentHearts(residentId, now);

    const data = {
      token: heartsOauth.bot.token,
      user_id: residentId,
      view: blocks.heartsHomeView(hearts.sum || 0)
    };
    await app.client.views.publish(data);

    // // This is where we resolve any challenges, transparently to the resident
    // const resolvableBuys = await Hearts.getResolvableHeartBuys(houseId, now);
    // for (const challenge of resolvableBuys) {
    //   await Hearts.resolveHeartBuy(challenge.id, now);
    //   console.log(`Resolved HeartBuy ${challenge.id}`);
    // }
  }
});

// Slash commands

async function getUser (userId) {
  return app.client.users.info({
    token: heartsOauth.bot.token,
    user: userId
  });
}

function prepareEphemeral (command, text) {
  return {
    token: heartsOauth.bot.token,
    channel: command.channel_id,
    user: command.user_id,
    text: text
  };
}

app.command('/hearts-channel', async ({ ack, command, say }) => {
  await ack();

  const channelName = command.text;
  const houseId = command.team_id;
  const userInfo = await getUser(command.user_id);

  let text;

  if (userInfo.user.is_admin) {
    // TODO: return a friendly error if the channel doesn't exist
    res = await app.client.conversations.list({ token: heartsOauth.bot.token });
    const channelId = res.channels.filter(channel => channel.name === channelName)[0].id;

    await Admin.updateHouse({ slackId: houseId, heartsChannel: channelId });

    text = `Heart challenges channel set to ${channelName} :fire:\nPlease add the Hearts bot to the channel`;
    console.log(`Set heart challenges channel to ${channelName}`);
  } else {
    text = 'Only admins can set the channels...';
  }

  const message = prepareEphemeral(command, text);
  await app.client.chat.postEphemeral(message);
});

// Challenge flow

app.action('hearts-challenge', async ({ ack, body, action }) => {
  await ack();

  const view = {
    token: heartsOauth.bot.token,
    trigger_id: body.trigger_id,
    view: blocks.heartsChallengeView()
  };

  res = await app.client.views.open(view);
  console.log(`Hearts-challenge opened with id ${res.view.id}`);
});

app.view('hearts-challenge-callback', async ({ ack, body }) => {
  await ack();

  const residentId = body.user.id;
  const houseId = body.team.id;

  // // https://api.slack.com/reference/interaction-payloads/views#view_submission_fields
  const challengeeBlockId = body.view.blocks[2].block_id;
  const numHeartsBlockId = body.view.blocks[3].block_id;
  const circumstanceBlockId = body.view.blocks[4].block_id;

  const challengeeId = body.view.state.values[challengeeBlockId].challengee.selected_users[0];
  const numHearts = body.view.state.values[numHeartsBlockId].hearts.value;
  const circumstance = body.view.state.values[circumstanceBlockId].circumstance.value;

  const { heartsChannel } = await Admin.getHouse(houseId);

  // TODO: Return error to user (not console) if channel is not set
  if (heartsChannel === null) { throw new Error('Hearts channel not set!'); }

  // Initiate the challenge
  const now = new Date();
  const [ challenge ] = await Hearts.issueChallenge(houseId, residentId, challengeeId, numHearts, now);
  await Polls.submitVote(challenge.pollId, residentId, now, YAY);

  const message = {
    token: heartsOauth.bot.token,
    channel: heartsChannel,
    text: 'Someone just issued a hearts challenge',
    blocks: blocks.heartsChallengeCallbackView(
      residentId,
      challengeeId,
      numHearts,
      circumstance,
      challenge.pollId,
      heartsPollLength
    )
  };

  res = await app.client.chat.postMessage(message);
  console.log(`Challenge ${challenge.id} created with poll ${challenge.pollId}`);
});

// Voting flow

app.action(/poll-vote/, async ({ ack, body, action }) => {
  await ack();

  const residentId = body.user.id;
  const channelId = body.channel.id;

  // // Submit the vote
  const [ pollId, value ] = action.value.split('|');
  await Polls.submitVote(pollId, residentId, new Date(), value);

  await sleep(5);

  const { yays, nays } = await Polls.getPollResultCounts(pollId);

  // Update the vote counts
  const numBlocks = body.message.blocks.length;
  body.message.token = heartsOauth.bot.token;
  body.message.channel = channelId;
  body.message.blocks[numBlocks - 1].elements = blocks.makeVoteButtons(pollId, yays, nays);

  await app.client.chat.update(body.message);

  console.log(`Poll ${pollId} updated`);
});

// Launch the app

(async () => {
  const port = process.env.HEARTS_PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Hearts app is running on port ${port} in the ${process.env.NODE_ENV} environment`);
})();

// Fin