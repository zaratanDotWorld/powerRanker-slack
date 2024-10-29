const { expect } = require('chai');
const chai = require('chai');
const chaiAlmost = require('chai-almost');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAlmost());
chai.use(chaiAsPromised);

const { Items, Admin } = require('../src/core/index');

const testHelpers = require('./helpers');

describe('Items', async () => {
  const WORKSPACE = testHelpers.generateSlackId();
  const TEAMMATE1 = testHelpers.generateSlackId();
  const TEAMMATE2 = testHelpers.generateSlackId();
  const TEAMMATE3 = testHelpers.generateSlackId();

  let dishes;
  let sweeping;
  let restock;

  let now;

  async function setPreference (workspaceId, teammateId, targetItemId, sourceItemId, value) {
    const normalizedPref = Items.normalizePreference({ targetItemId, sourceItemId, value });
    return Items.setPreferences(workspaceId, [ { teammateId, ...normalizedPref } ]);
  }

  beforeEach(async () => {
    now = new Date();

    await Admin.addWorkspace(WORKSPACE);
  });

  afterEach(async () => {
    await testHelpers.resetDb();
  });

  describe('managing items and preferences', async () => {
    beforeEach(async () => {
      await Admin.activateTeammate(WORKSPACE, TEAMMATE1, now);
      await Admin.activateTeammate(WORKSPACE, TEAMMATE2, now);

      [ dishes ] = await Items.activateItems(WORKSPACE, [ 'dishes' ]);
      [ sweeping ] = await Items.activateItems(WORKSPACE, [ 'sweeping' ]);
      [ restock ] = await Items.activateItems(WORKSPACE, [ 'restock' ]);
    });

    it('can get existing items', async () => {
      let items;

      items = await Items.getItem(dishes.id);
      expect(items.workspaceId).to.equal(WORKSPACE);

      items = await Items.getItems(WORKSPACE);
      expect(items.length).to.equal(3);
    });

    it('can set a preference', async () => {
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 1);

      let preferences;
      preferences = await Items.getPreferences(WORKSPACE, now);
      expect(preferences[0].value).to.equal(1);
      expect(preferences[0].alphaItemId).to.equal(dishes.id);
      expect(preferences[0].betaItemId).to.equal(sweeping.id);

      await setPreference(WORKSPACE, TEAMMATE2, dishes.id, sweeping.id, 1);

      preferences = await Items.getPreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(2);

      preferences = await Items.getTeammatePreferences(WORKSPACE, TEAMMATE1, now);
      expect(preferences.length).to.equal(1);
    });

    it('can set multiple preferences', async () => {
      const prefs = [
        { teammateId: TEAMMATE1, alphaItemId: dishes.id, betaItemId: sweeping.id, value: 0.9 },
        { teammateId: TEAMMATE1, alphaItemId: sweeping.id, betaItemId: restock.id, value: 0.8 },
      ];
      await Items.setPreferences(WORKSPACE, prefs);

      const preferences = await Items.getPreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(2);
      expect(preferences.find(x => x.alphaItemId === dishes.id).value).to.equal(0.9);
      expect(preferences.find(x => x.alphaItemId === sweeping.id).value).to.equal(0.8);
    });

    it('can update a preference', async () => {
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 1);
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 0);

      const preferences = await Items.getPreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(1);
      expect(preferences[0].value).to.equal(0);
    });

    it('can query for active preferences', async () => {
      await Admin.activateTeammate(WORKSPACE, TEAMMATE3, now);

      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 0.0);
      await setPreference(WORKSPACE, TEAMMATE2, dishes.id, restock.id, 0.5);
      await setPreference(WORKSPACE, TEAMMATE3, sweeping.id, restock.id, 1.0);

      let preferences;
      preferences = await Items.getActivePreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(3);

      // Remove the third preference
      await Admin.deactivateTeammate(WORKSPACE, TEAMMATE3);

      preferences = await Items.getActivePreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(2);

      // Restore the third preference
      await Admin.activateTeammate(WORKSPACE, TEAMMATE3, now);

      preferences = await Items.getActivePreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(3);

      // Remove the last two preferences
      await Items.deactivateItems(WORKSPACE, [ restock.name ]);

      preferences = await Items.getActivePreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(1);

      // Restore the last two preferences
      await Items.activateItems(WORKSPACE, [ restock.name ]);

      preferences = await Items.getActivePreferences(WORKSPACE, now);
      expect(preferences.length).to.equal(3);
    });

    it('can normalize a preference', async () => {
      let preference;

      preference = Items.normalizePreference({ targetItemId: dishes.id, sourceItemId: sweeping.id, value: 0.7 });
      expect(preference.alphaItemId).to.equal(dishes.id);
      expect(preference.betaItemId).to.equal(sweeping.id);
      expect(preference.value).to.almost.equal(0.7);

      expect(dishes.id).to.be.lt(sweeping.id);

      preference = Items.normalizePreference({ targetItemId: sweeping.id, sourceItemId: dishes.id, value: 0.7 });
      expect(preference.alphaItemId).to.equal(dishes.id);
      expect(preference.betaItemId).to.equal(sweeping.id);
      expect(preference.value).to.almost.equal(0.3);

      expect(() => Items.normalizePreference({ alphaItemId: sweeping.id, betaItemId: dishes.id }))
        .to.throw('Invalid preference!');

      // If already normalized, no-op
      preference = Items.normalizePreference({ alphaItemId: dishes.id, betaItemId: sweeping.id, value: 0.7 });
      expect(preference.alphaItemId).to.equal(dishes.id);
      expect(preference.betaItemId).to.equal(sweeping.id);
      expect(preference.value).to.almost.equal(0.7);
    });

    it('can merge two sets of preferences', async () => {
      const currentPrefs = [
        { teammateId: TEAMMATE1, alphaItemId: dishes.id, betaItemId: sweeping.id, value: 1 },
        { teammateId: TEAMMATE1, alphaItemId: sweeping.id, betaItemId: restock.id, value: 1 },
        { teammateId: TEAMMATE2, alphaItemId: dishes.id, betaItemId: sweeping.id, value: 1 },
        { teammateId: TEAMMATE2, alphaItemId: dishes.id, betaItemId: restock.id, value: 1 },
      ];

      const newPrefs = [
        // Same teammate & preference, new item
        { teammateId: TEAMMATE1, alphaItemId: dishes.id, betaItemId: restock.id, value: 0 },
        // Same teammate & item, new preference
        { teammateId: TEAMMATE1, alphaItemId: sweeping.id, betaItemId: restock.id, value: 0 },
        // Same teammate & item, new preference
        { teammateId: TEAMMATE2, alphaItemId: dishes.id, betaItemId: sweeping.id, value: 0 },
        // Same item, preference, & teammate
        { teammateId: TEAMMATE2, alphaItemId: dishes.id, betaItemId: restock.id, value: 1 },
      ];

      const mergedPrefs = Items.mergePreferences(currentPrefs, newPrefs);
      const mergedPrefsMap = Items.toPreferenceMap(mergedPrefs);

      expect(mergedPrefs.length).to.equal(5);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(currentPrefs[0])).value).to.equal(1);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(currentPrefs[1])).value).to.equal(0);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(currentPrefs[2])).value).to.equal(0);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(currentPrefs[3])).value).to.equal(1);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(newPrefs[0])).value).to.equal(0);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(newPrefs[1])).value).to.equal(0);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(newPrefs[2])).value).to.equal(0);
      expect(mergedPrefsMap.get(Items.toPreferenceKey(newPrefs[3])).value).to.equal(1);
    });
  });

  describe('managing item rankings', async () => {
    beforeEach(async () => {
      await Admin.activateTeammate(WORKSPACE, TEAMMATE1, now);
      await Admin.activateTeammate(WORKSPACE, TEAMMATE2, now);
      await Admin.activateTeammate(WORKSPACE, TEAMMATE3, now);

      [ dishes ] = await Items.activateItems(WORKSPACE, [ 'dishes' ]);
      [ sweeping ] = await Items.activateItems(WORKSPACE, [ 'sweeping' ]);
      [ restock ] = await Items.activateItems(WORKSPACE, [ 'restock' ]);
    });

    it('can return uniform rankings implicitly', async () => {
      const itemRankings = await Items.getCurrentItemRankings(WORKSPACE, now);

      expect(itemRankings.find(x => x.id === dishes.id).ranking).to.almost.equal(0.3333333333333333);
      expect(itemRankings.find(x => x.id === sweeping.id).ranking).to.almost.equal(0.3333333333333333);
      expect(itemRankings.find(x => x.id === restock.id).ranking).to.almost.equal(0.3333333333333333);
    });

    it('can use preferences to determine item rankings', async () => {
      // Prefer dishes to sweeping, and sweeping to restock
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 1);
      await setPreference(WORKSPACE, TEAMMATE2, sweeping.id, restock.id, 1);

      const itemRankings = await Items.getCurrentItemRankings(WORKSPACE, now);

      expect(itemRankings.find(x => x.id === dishes.id).ranking).to.almost.equal(0.5038945471248252);
      expect(itemRankings.find(x => x.id === sweeping.id).ranking).to.almost.equal(0.31132043857597014);
      expect(itemRankings.find(x => x.id === restock.id).ranking).to.almost.equal(0.18478501429920438);
    });

    it('can use preferences to determine mild item rankings', async () => {
      // Slightly prefer dishes to sweeping, and sweeping to restock
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 0.7);
      await setPreference(WORKSPACE, TEAMMATE2, sweeping.id, restock.id, 0.7);

      const itemRankings = await Items.getCurrentItemRankings(WORKSPACE, now);

      expect(itemRankings.find(x => x.id === dishes.id).ranking).to.almost.equal(0.37949915168275505);
      expect(itemRankings.find(x => x.id === sweeping.id).ranking).to.almost.equal(0.3721885654420433);
      expect(itemRankings.find(x => x.id === restock.id).ranking).to.almost.equal(0.24831228287520143);
    });

    it('can use preferences to determine complex item rankings', async () => {
      // Prefer both dishes and restock to sweeping
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 1);
      await setPreference(WORKSPACE, TEAMMATE2, restock.id, sweeping.id, 1);

      const itemRankings = await Items.getCurrentItemRankings(WORKSPACE, now);

      expect(itemRankings.find(x => x.id === dishes.id).ranking).to.almost.equal(0.43135897930403255);
      expect(itemRankings.find(x => x.id === sweeping.id).ranking).to.almost.equal(0.13728204139193492);
      expect(itemRankings.find(x => x.id === restock.id).ranking).to.almost.equal(0.43135897930403255);
    });

    it('can handle circular item rankings', async () => {
      // A cycle of preferences
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 1);
      await setPreference(WORKSPACE, TEAMMATE1, sweeping.id, restock.id, 1);
      await setPreference(WORKSPACE, TEAMMATE1, restock.id, dishes.id, 1);

      const itemRankings = await Items.getCurrentItemRankings(WORKSPACE, now);

      expect(itemRankings[0].ranking).to.almost.equal(0.3333333333333333);
      expect(itemRankings[1].ranking).to.almost.equal(0.3333333333333333);
      expect(itemRankings[2].ranking).to.almost.equal(0.3333333333333333);
    });

    it('can get proposed item rankings', async () => {
      // Dishes <- Sweeping <- Restock
      await setPreference(WORKSPACE, TEAMMATE1, dishes.id, sweeping.id, 1);
      await setPreference(WORKSPACE, TEAMMATE2, sweeping.id, restock.id, 1);

      let itemRankings;

      const newPrefs = [];
      itemRankings = await Items.getProposedItemRankings(WORKSPACE, newPrefs, now);

      expect(itemRankings.find(x => x.id === dishes.id).ranking).to.almost.equal(0.5038945471248252);
      expect(itemRankings.find(x => x.id === sweeping.id).ranking).to.almost.equal(0.31132043857597014);
      expect(itemRankings.find(x => x.id === restock.id).ranking).to.almost.equal(0.18478501429920438);

      // Shift priority from dishes to sweeping
      newPrefs.push({ teammateId: TEAMMATE1, alphaItemId: dishes.id, betaItemId: sweeping.id, value: 0.7 });
      itemRankings = await Items.getProposedItemRankings(WORKSPACE, newPrefs, now);

      expect(itemRankings.find(x => x.id === dishes.id).ranking).to.almost.equal(0.3921602623439877);
      expect(itemRankings.find(x => x.id === sweeping.id).ranking).to.almost.equal(0.43526893223314683);
      expect(itemRankings.find(x => x.id === restock.id).ranking).to.almost.equal(0.17257080542286504);

      // Shift priority from sweeping to restock
      newPrefs.push({ teammateId: TEAMMATE2, alphaItemId: sweeping.id, betaItemId: restock.id, value: 0.7 });
      itemRankings = await Items.getProposedItemRankings(WORKSPACE, newPrefs, now);

      expect(itemRankings.find(x => x.id === dishes.id).ranking).to.almost.equal(0.37949915168275505);
      expect(itemRankings.find(x => x.id === sweeping.id).ranking).to.almost.equal(0.3721885654420433);
      expect(itemRankings.find(x => x.id === restock.id).ranking).to.almost.equal(0.24831228287520143);
    });
  });
});
