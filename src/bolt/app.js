require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  require('newrelic');
}

const fs = require('fs');

const { App, LogLevel } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');

const { Admin, Items } = require('../core/index');

const common = require('./common');
const views = require('./views');

let config;

// Create the app

const app = new App({
  logLevel: LogLevel.WARN,
  signingSecret: process.env.BOLT_SIGNING_SECRET,
  clientId: process.env.BOLT_CLIENT_ID,
  clientSecret: process.env.BOLT_CLIENT_SECRET,
  stateSecret: process.env.STATE_SECRET,
  customRoutes: [ common.homeEndpoint('Power Ranker') ],
  scopes: [
    'channels:history',
    'channels:join',
    'chat:write',
    'commands',
    'files:read',
    'files:write',
    'groups:history',
    'users:read',
  ],
  installationStore: {
    storeInstallation: async (installation) => {
      console.log(installation);
      await Admin.addWorkspace(installation.team.id, installation.team.name);
      await Admin.updateWorkspaceConfig(installation.team.id, { oauth: installation });
      console.log(`power installed @ ${installation.team.id}`);
    },
    fetchInstallation: async (installQuery) => {
      ({ config } = (await Admin.getWorkspace(installQuery.teamId)));
      return config.oauth;
    },
    deleteInstallation: async (installQuery) => {
      await Admin.updateWorkspaceConfig(installQuery.teamId, { oauth: null, channel: null });
      console.log(`power uninstalled @ ${installQuery.teamId}`);
    },
  },
  installerOptions: { directInstall: true },
});

// Define helper functions

async function postMessage (text, blocks) {
  return common.postMessage(app, config.oauth, config.channel, text, blocks);
}

async function postEphemeral (teammateId, text) {
  return common.postEphemeral(app, config.oauth, config.channel, teammateId, text);
}

// Event listeners

app.event('app_uninstalled', async ({ context }) => {
  console.log(`power app_uninstalled - ${context.teamId}`);

  const { installationStore } = app.receiver.installer;
  await installationStore.deleteInstallation(context);
});

// Publish the app home

app.event('app_home_opened', async ({ body, event }) => {
  if (event.tab !== 'home') { return; }

  const { now, workspaceId, teammateId } = common.beginHome('power', body, event);
  await Admin.activateTeammate(workspaceId, teammateId, now);

  let view;
  if (config.channel) {
    const admin = await common.isAdmin(app, config.oauth, teammateId);
    const exempt = await Admin.isExempt(teammateId, now);

    view = views.homeView(admin, exempt);
  } else {
    view = views.introView();
  }

  await common.publishHome(app, config.oauth, teammateId, view);
});

// Slash commands

app.command('/power-sync', async ({ ack, command }) => {
  const commandName = '/power-sync';
  common.beginCommand(commandName, command);

  await common.syncWorkspace(app, config.oauth, command);

  await ack();
});

app.command('/power-channel', async ({ ack, command }) => {
  const commandName = '/power-channel';
  common.beginCommand(commandName, command);

  await common.setChannel(app, config.oauth, command);
  await common.syncWorkspace(app, config.oauth, command);

  await ack();
});

app.command('/power-exempt', async ({ ack, command }) => {
  const commandName = '/power-exempt';
  const { now, workspaceId } = common.beginCommand(commandName, command);

  if (!(await common.isAdmin(app, config.oauth, command.user_id))) {
    await common.replyAdminOnly(app, config.oauth, command);
    return;
  }

  const exemptTeammates = (await Admin.getTeammates(workspaceId, now))
    .filter(r => r.exemptAt && r.exemptAt <= now);

  const view = views.itemsExemptView(exemptTeammates);
  await common.openView(app, config.oauth, command.trigger_id, view);

  await ack();
});

app.view('power-exempt-callback', async ({ ack, body }) => {
  const actionName = 'power-exempt-callback';
  const { now, workspaceId, teammateId } = common.beginAction(actionName, body);

  const action = common.getInputBlock(body, -2).action.selected_option.value;
  const teammateIds = common.getInputBlock(body, -1).residents.selected_users;

  let text;

  switch (action) {
    case 'exempt':
      for (const teammateId of teammateIds) {
        await Admin.exemptTeammate(workspaceId, teammateId, now);
      }
      text = 'Exemption succeeded :fire:';
      break;
    case 'unexempt':
      for (const teammateId of teammateIds) {
        await Admin.unexemptTeammate(workspaceId, teammateId, now);
      }
      text = 'Unexemption succeeded :fire:';
      break;
    default:
      console.log('No match found!');
      return;
  }

  await postEphemeral(teammateId, text);

  await ack();
});

// Ranking flow

app.action('power-rank', async ({ ack, body }) => {
  const actionName = 'power-rank';
  const { now, workspaceId } = common.beginAction(actionName, body);

  const itemRankings = await Items.getCurrentItemRankings(workspaceId, now);

  const view = (itemRankings.length > 1)
    ? views.powerRankView(itemRankings)
    : views.powerRankViewNoItems();

  await common.openView(app, config.oauth, body.trigger_id, view);

  await ack();
});

app.view('power-rank-2', async ({ ack, body }) => {
  const actionName = 'power-rank-2';
  const { now, workspaceId } = common.beginAction(actionName, body);

  const action = common.getInputBlock(body, -2).action.selected_option.value;
  const targetItem = JSON.parse(common.getInputBlock(body, -1).item.selected_option.value);
  const itemRankings = await Items.getCurrentItemRankings(workspaceId, now);

  const view = views.powerRankView2(action, targetItem, itemRankings);
  await ack({ response_action: 'push', view });
});

app.view('power-rank-3', async ({ ack, body }) => {
  const actionName = 'power-rank-3';
  const { now, workspaceId, teammateId } = common.beginAction(actionName, body);

  const { targetItem } = JSON.parse(body.view.private_metadata);
  const preference = Number(common.getInputBlock(body, -2).preference.selected_option.value);
  const sourceItems = common.getInputBlock(body, -1).items.selected_options
    .map(option => JSON.parse(option.value));

  const newPrefs = sourceItems.map((sc) => {
    return { targetItemId: targetItem.id, sourceItemId: sc.id, value: preference };
  });

  // Get the new ranking
  const filteredPrefs = await Items.filterPreferences(teammateId, newPrefs);
  const proposedRankings = await Items.getProposedItemRankings(workspaceId, filteredPrefs, now);
  const targetItemRanking = proposedRankings.find(item => item.id === targetItem.id);

  // Forward the preferences through metadata
  const sourceItemIds = sourceItems.map(sc => sc.id);
  const prefsMetadata = JSON.stringify({ targetItem, sourceItemIds, preference });

  const view = views.powerRankView3(targetItem, targetItemRanking, prefsMetadata);
  await ack({ response_action: 'push', view });
});

app.view('power-rank-callback', async ({ ack, body }) => {
  const actionName = 'power-rank-callback';
  const { now, workspaceId, teammateId } = common.beginAction(actionName, body);

  const { targetItem, sourceItemIds, preference } = JSON.parse(body.view.private_metadata);

  const newPrefs = sourceItemIds.map((scId) => {
    return { targetItemId: targetItem.id, sourceItemId: scId, value: preference };
  });

  // Get the new ranking
  const filteredPrefs = await Items.filterPreferences(teammateId, newPrefs);
  await Items.setPreferences(workspaceId, filteredPrefs); // Actually set the items
  const itemRankings = await Items.getCurrentItemRankings(workspaceId, now);
  const targetItemRanking = itemRankings.find(item => item.id === targetItem.id);

  const newPriority = Math.round(targetItemRanking.ranking * 1000);
  const change = newPriority - targetItem.priority;

  if (change > 0) {
    const text = `Someone *prioritized ${targetItem.name}* by *${change}*, to *${newPriority} ppt* :rocket:`;
    await postMessage(text);
  } else if (change < 0) {
    const text = `Someone *deprioritized ${targetItem.name}* by *${Math.abs(change)}*, to *${newPriority} ppt* :snail:`;
    await postMessage(text);
  }

  await ack({ response_action: 'clear' });
});

// I/O flows

app.action('power-upload', async ({ ack, body }) => {
  await ack();

  const actionName = 'power-upload';
  common.beginAction(actionName, body);

  const view = views.powerRankUploadView();
  await common.openView(app, config.oauth, body.trigger_id, view);
});

app.view('power-upload-callback', async ({ ack, body }) => {
  await ack();

  const actionName = 'power-upload-callback';
  const { workspaceId, teammateId } = common.beginAction(actionName, body);

  const blockId = body.view.blocks[3].block_id;
  const [ file ] = body.view.state.values[blockId].items.files;

  const fileObject = await app.client.files.info({
    token: config.oauth.bot.token,
    file: file.id,
  });

  // Format is {"items": ["Item 1", "Item 2", "Item 3"]}
  const { items } = JSON.parse(fileObject.content);

  const oldItems = (await Items.getItems(workspaceId)).map(i => i.name);
  await Items.deactivateItems(workspaceId, oldItems);

  await Items.activateItems(workspaceId, items);

  await postMessage(`<@${teammateId}> just uploaded ${items.length} items :rocket:`);
});

app.action('power-download', async ({ ack, body }) => {
  await ack();

  const actionName = 'power-download';
  common.beginAction(actionName, body);

  const view = views.powerRankDownloadView();
  await common.openView(app, config.oauth, body.trigger_id, view);
});

app.view('power-download-callback', async ({ ack, body }) => {
  await ack();

  const actionName = 'power-download-callback';
  const { workspaceId, teammateId, now } = common.beginAction(actionName, body);

  const rankings = await Items.getCurrentItemRankings(workspaceId, now);

  // Format is {"preferences": [{ "name": "Item 1", "ranking": 0.2, "name": "Item 2", "ranking": .5}]}
  const rankingsJson = JSON.stringify(
    rankings.map(r => ({ name: r.name, ranking: r.ranking })),
  );

  const filePath = '/tmp/rankings.json';
  fs.writeFileSync(filePath, rankingsJson);

  // Upload the file to Slack
  const webClient = new WebClient(config.oauth.bot.token);

  await webClient.filesUploadV2({
    channel_id: config.channel,
    file: fs.createReadStream(filePath),
    filename: `rankings-${now.getTime()}.json`,
    title: 'Power Ranker results',
    initial_comment: `<@${teammateId}>, your results are ready!`,
  });
});

// Launch the app

(async () => {
  const port = process.env.BOLT_PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Power Ranker is running on port ${port} in the ${process.env.NODE_ENV} environment`);
})();

// Fin
