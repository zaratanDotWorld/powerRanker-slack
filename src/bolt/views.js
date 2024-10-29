const common = require('./common');

const TITLE = common.blockPlaintext('Power Ranker');

// Home views

exports.introView = function () {
  const header = ':wave::skin-tone-4: Thanks for installing Power Ranker!';
  const mainText = 'Set an events channel by calling `/power-channel`, which *unlocks the app*.';

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));

  return {
    type: 'home',
    blocks,
  };
};

exports.homeView = function (admin, exempt) {
  const header = 'Welcome to Power Ranker';
  const mainText = 'Power Ranker is a tool for collaborative prioritization of items, supporting interoperatiblity.\n\n' +
    'You can use it to prioritize tasks, projects, or anything else you need to get done.';

  const actions = [];
  if (!exempt) {
    actions.push(common.blockButton('power-rank', ':scales: Set priorities'));
  }
  if (admin) {
    actions.push(common.blockButton('power-upload', ':satellite: Upload items'));
  }
  actions.push(common.blockButton('power-download', ':floppy_disk: Download results'));

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));
  blocks.push(common.blockSection(common.feedbackLink));
  blocks.push(common.blockDivider());
  blocks.push(common.blockActions(actions));

  return {
    type: 'home',
    blocks,
  };
};

// Slash commands

exports.powerExemptView = function (exemptTeammates) {
  const header = 'Set item exemptions';
  const mainText = 'Exempt residents are excused from items and cannot create or vote on polls.';

  const exemptText = '*Current exemptions:*\n' +
    exemptTeammates
      .sort((a, b) => a.exemptAt < b.exemptAt)
      .map(r => `\n${r.exemptAt.toDateString()} - <@${r.slackId}>`)
      .join('');

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));
  blocks.push(common.blockSection(exemptText));
  blocks.push(common.blockDivider());
  blocks.push(common.blockInput(
    'Action',
    {
      action_id: 'action',
      type: 'radio_buttons',
      options: [
        { value: 'exempt', text: common.blockMarkdown('*Exempt* some residents') },
        { value: 'unexempt', text: common.blockMarkdown('*Unexempt* some residents') },
      ],
    },
  ));
  blocks.push(common.blockInput(
    'Teammates',
    {
      action_id: 'residents',
      type: 'multi_users_select',
      placeholder: common.blockPlaintext('Choose some residents'),
    },
  ));

  return {
    type: 'modal',
    callback_id: 'power-exempt-callback',
    title: TITLE,
    close: common.CLOSE,
    submit: common.SUBMIT,
    blocks,
  };
};

// Upload flow

exports.powerRankUploadView = function () {
  const header = 'Upload items';
  const mainText = 'Upload a list of items to prioritize.\n\n' +
    'Items should be uploaded as JSON with the following format:\n\n' +
    '`{"items": ["Item 1", "Item 2", "Item 3"]}`';

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));
  blocks.push(common.blockDivider());
  blocks.push(common.blockInput(
    'Items',
    {
      type: 'file_input',
      action_id: 'items',
      filetypes: [ 'json' ],
      max_files: 1,
    },
  ));

  return {
    type: 'modal',
    callback_id: 'power-upload-callback',
    title: TITLE,
    close: common.CLOSE,
    submit: common.SUBMIT,
    blocks,
  };
};

// Download flow

exports.powerRankDownloadView = function () {
  const header = 'Download results';
  const mainText = 'Generates a JSON file with the current item rankings.';

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));

  return {
    type: 'modal',
    callback_id: 'power-download-callback',
    title: TITLE,
    close: common.CLOSE,
    submit: common.SUBMIT,
    blocks,
  };
};

// Ranking flow

exports.powerRankViewNoItems = function () {
  const header = 'Set item priorities';
  const mainText = 'No items have been added yet.\n\n' +
    'Upload a list of items using `Upload items`.';

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));

  return {
    type: 'modal',
    title: TITLE,
    close: common.CLOSE,
    blocks,
  };
};

exports.powerRankView = function (itemRankings) {
  const header = 'Set item priorities';
  const mainText = 'If you feel a item should be worth more (or less), you can change it\'s *priority*.\n\n' +
    'Priority-setting is a *cumulative, collaborative, and ongoing* process, ' +
    'where every input makes a difference, and anyone can make small (or large) changes at any time.';

  const actions = [
    { value: 'prioritize', text: common.blockPlaintext('prioritize (higher value)') },
    { value: 'deprioritize', text: common.blockPlaintext('deprioritize (lower value)') },
  ];

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));
  blocks.push(common.blockDivider());
  blocks.push(common.blockInput(
    'I want to',
    {
      action_id: 'action',
      type: 'static_select',
      initial_option: actions[0],
      options: actions,
    },
  ));
  blocks.push(common.blockInput(
    'the following item:',
    {
      action_id: 'item',
      type: 'static_select',
      placeholder: common.blockPlaintext('Choose a item'),
      options: mapItemRankings(itemRankings),
    },
  ));
  return {
    type: 'modal',
    callback_id: 'power-rank-2',
    title: TITLE,
    close: common.CLOSE,
    submit: common.NEXT,
    blocks,
  };
};

exports.powerRankView2 = function (action, targetItem, itemRankings) {
  const prioritize = action === 'prioritize';
  const preferenceOptions = [
    { value: String((prioritize) ? 0.7 : 1 - 0.7), text: common.blockPlaintext('a little') },
    { value: String((prioritize) ? 1.0 : 1 - 1.0), text: common.blockPlaintext('a lot') },
  ];

  const header = 'Set item priorities';
  const mainText = 'Item priorities are measured in *points-per-thousand* (ppt), which always add up to *1000*. ' +
    'You can think of updating as "taking" priority from some items and giving it to others. ' +
    '*Some things to keep in mind:*\n\n' +
    '*1.* A *strong preference* has a bigger effect.\n' +
    '*2.* Taking from *high-priority items* has a bigger effect.\n' +
    '*3.* Taking from *more items* has a bigger effect.\n' +
    '*4.* *More participants* have a bigger effect.\n\n' +
    'It\'s more involved than just "subtracting" ppt, but not by much.';

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));
  blocks.push(common.blockDivider());
  blocks.push(common.blockInput(
    `I want to ${action} ${targetItem.name}`,
    {
      action_id: 'preference',
      type: 'static_select',
      initial_option: preferenceOptions[0],
      options: preferenceOptions,
    },
  ));
  blocks.push(common.blockInput(
    `by ${(prioritize) ? 'deprioritizing' : 'prioritizing'}`,
    {
      action_id: 'items',
      type: 'multi_static_select',
      placeholder: common.blockPlaintext('Choose some items'),
      options: mapItemRankings(
        itemRankings.filter(item => item.id !== targetItem.id),
      ),
    },
  ));

  return {
    type: 'modal',
    callback_id: 'power-rank-3',
    private_metadata: JSON.stringify({ targetItem }),
    title: TITLE,
    close: common.BACK,
    submit: common.NEXT,
    blocks,
  };
};

exports.powerRankView3 = function (targetItem, targetItemRanking, prefsMetadata) {
  const newPriority = Math.round(targetItemRanking.ranking * 1000);
  const change = newPriority - targetItem.priority;

  const effect = change >= 0 ? 'an *increase*' : 'a *decrease*';
  const emoji = change >= 0 ? ':rocket:' : ':snail:';

  const header = 'Set item priorities';
  const mainText = (change !== 0)
    ? 'After your update, ' +
      `*${targetItem.name}* will have a priority of *${newPriority} ppt*, ` +
      `${effect} of *${Math.abs(change)} ppt* ${emoji}\n\n` +
      '*Submit* to confirm, or go *back* to change your update.'
    : 'These are your current preferences, so this update will have *no effect*.\n\n' +
      'For additional effect, *choose more or different items* or a *stronger preference*. ' +
      'Alternatively, try and *convince others* to support your priorities.';

  const blocks = [];
  blocks.push(common.blockHeader(header));
  blocks.push(common.blockSection(mainText));

  return {
    type: 'modal',
    callback_id: 'power-rank-callback',
    private_metadata: prefsMetadata,
    title: TITLE,
    close: common.BACK,
    submit: common.SUBMIT,
    blocks,
  };
};

// Internal

function mapItemRankings (itemRankings) {
  return itemRankings.map((item) => {
    const priority = Math.round(item.ranking * 1000);
    return {
      value: JSON.stringify({ id: item.id, name: item.name, priority }),
      text: common.blockPlaintext(`${item.name} - ${priority} ppt`),
    };
  });
}
