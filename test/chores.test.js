const { expect } = require('chai');
const chai = require('chai');
const BN = require('bn.js');
const bnChai = require('bn-chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(bnChai(BN));
chai.use(chaiAsPromised);

const { YAY, NAY } = require('../src/constants');
const { sleep } = require('../src/utils');
const { db } = require('../src/db');

const Chores = require('../src/modules/chores');
const Polls = require('../src/modules/polls');
const Admin = require('../src/modules/admin');

describe('Chores', async () => {
  const HOUSE = 'house123';

  const RESIDENT1 = 'RESIDENT1';
  const RESIDENT2 = 'RESIDENT2';
  const RESIDENT3 = 'RESIDENT3';
  const RESIDENT4 = 'RESIDENT4';

  let dishes;
  let sweeping;
  let restock;

  const POLL_LENGTH = 35;

  before(async () => {
    await db('chore').del();
    await db('resident').del();
    await db('house').del();

    await Admin.addHouse(HOUSE);

    await db('chore').del();
    [ dishes ] = await Chores.addChore(HOUSE, 'dishes');
    [ sweeping ] = await Chores.addChore(HOUSE, 'sweeping');
    [ restock ] = await Chores.addChore(HOUSE, 'restock');
  });

  afterEach(async () => {
    await db('chore_claim').del();
    await db('chore_value').del();
    await db('chore_pref').del();
    await db('poll_vote').del();
    await db('poll').del();
    await db('resident').del();
  });

  describe('managing chore preferences', async () => {
    beforeEach(async () => {
      await Admin.addResident(HOUSE, RESIDENT1);
      await Admin.addResident(HOUSE, RESIDENT2);
    });

    it('can list the existing chores', async () => {
      const allChores = await Chores.getChores(HOUSE);

      expect(allChores.length).to.eq.BN(3);
    });

    it('can set and query for the latest chore values', async () => {
      await db('chore_value').insert([
        { chore_id: dishes.id, valued_at: new Date(), value: 10 },
        { chore_id: dishes.id, valued_at: new Date(), value: 5 },
        { chore_id: sweeping.id, valued_at: new Date(), value: 20 }
      ]);

      const now = new Date();
      const endTime = new Date(now.getTime() + 1000);
      const startTime = new Date(now.getTime() - 1000);

      const dishesValue = await Chores.getChoreValue(dishes.id, startTime, endTime);
      expect(dishesValue.sum).to.eq.BN(15);

      const sweepingValue = await Chores.getChoreValue(sweeping.id, startTime, endTime);
      expect(sweepingValue.sum).to.eq.BN(20);
    });

    it('can set a chore preference', async () => {
      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 1);
      await Chores.setChorePreference(HOUSE, RESIDENT2, dishes.id, sweeping.id, 0);

      const preferences = await Chores.getChorePreferences(HOUSE);
      expect(preferences[0].preference).to.equal(1);
      expect(preferences[1].preference).to.equal(0);
    });

    it('can update a chore preference', async () => {
      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 1);
      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 0);

      const preferences = await Chores.getChorePreferences(HOUSE);
      expect(preferences.length).to.eq.BN(1);
      expect(preferences[0].preference).to.equal(0);
    });

    it('can query for active chore preferences', async () => {
      await Admin.addResident(HOUSE, RESIDENT3);
      await sleep(1);

      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 0.0);
      await Chores.setChorePreference(HOUSE, RESIDENT2, dishes.id, restock.id, 0.5);
      await Chores.setChorePreference(HOUSE, RESIDENT3, sweeping.id, restock.id, 1.0);

      let preferences;
      preferences = await Chores.getActiveChorePreferences(HOUSE);
      expect(preferences.length).to.eq.BN(3);

      // Remove the third preference
      await Admin.deleteResident(RESIDENT3);
      await sleep(1);

      preferences = await Chores.getActiveChorePreferences(HOUSE);
      expect(preferences.length).to.eq.BN(2);

      // Restore the third preference
      await Admin.addResident(HOUSE, RESIDENT3);
      await sleep(1);

      preferences = await Chores.getActiveChorePreferences(HOUSE);
      expect(preferences.length).to.eq.BN(3);

      // Remove the last two preferences
      await Chores.deleteChore(HOUSE, restock.name);
      await sleep(1);

      preferences = await Chores.getActiveChorePreferences(HOUSE);
      expect(preferences.length).to.eq.BN(1);

      // Restore the last two preferences
      await Chores.addChore(HOUSE, restock.name);
      await sleep(1);

      preferences = await Chores.getActiveChorePreferences(HOUSE);
      expect(preferences.length).to.eq.BN(3);
    });
  });

  describe('managing chore values', async () => {
    beforeEach(async () => {
      await Admin.addResident(HOUSE, RESIDENT1);
      await Admin.addResident(HOUSE, RESIDENT2);
    });

    it('can return uniform preferences implicitly', async () => {
      const labeledWeights = await Chores.getCurrentChoreRankings(HOUSE);

      expect(labeledWeights.get(dishes.id)).to.equal(0.3333333333333333);
      expect(labeledWeights.get(sweeping.id)).to.equal(0.3333333333333333);
      expect(labeledWeights.get(restock.id)).to.equal(0.3333333333333333);
    });

    it('can use preferences to determine chore values', async () => {
      // Prefer dishes to sweeping, and sweeping to restock
      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 1);
      await Chores.setChorePreference(HOUSE, RESIDENT2, sweeping.id, restock.id, 1);

      const labeledWeights = await Chores.getCurrentChoreRankings(HOUSE);

      expect(labeledWeights.get(dishes.id)).to.equal(0.42564666666666673);
      expect(labeledWeights.get(sweeping.id)).to.equal(0.31288000000000005);
      expect(labeledWeights.get(restock.id)).to.equal(0.2614733333333334);
    });

    it('can use preferences to determine mild chore values', async () => {
      // Slightly prefer dishes to sweeping, and sweeping to restock
      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 0.7);
      await Chores.setChorePreference(HOUSE, RESIDENT2, sweeping.id, restock.id, 0.7);

      const labeledWeights = await Chores.getCurrentChoreRankings(HOUSE);

      expect(labeledWeights.get(dishes.id)).to.equal(0.36816469333333335);
      expect(labeledWeights.get(sweeping.id)).to.equal(0.33009407999999996);
      expect(labeledWeights.get(restock.id)).to.equal(0.3017412266666667);
    });

    it('can use preferences to determine complex chore values', async () => {
      // Prefer both dishes and restock to sweeping
      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 1);
      await Chores.setChorePreference(HOUSE, RESIDENT2, sweeping.id, restock.id, 0);

      const labeledWeights = await Chores.getCurrentChoreRankings(HOUSE);

      expect(labeledWeights.get(dishes.id)).to.equal(0.40740000000000004);
      expect(labeledWeights.get(sweeping.id)).to.equal(0.1852);
      expect(labeledWeights.get(restock.id)).to.equal(0.4074);
    });

    it('can calculate the interval since the last chore valuation', async () => {
      const firstValuationTime = new Date(2000, 0, 1); // January 1
      const secondValuationTime = new Date(2000, 0, 2); // January 2

      await db('chore_value').insert([
        { chore_id: dishes.id, valued_at: firstValuationTime, value: 10 },
        { chore_id: dishes.id, valued_at: secondValuationTime, value: 10 }
      ]);

      const queryTime = new Date(secondValuationTime.getTime() + 60 * 60 * 1000); // 1 hour
      const intervalScalar = await Chores.getChoreValueIntervalScalar(HOUSE, queryTime);
      expect(intervalScalar).to.equal(0.0013440860215053765);
    });

    it('can calculate the interval on an hourly basis', async () => {
      const valuationTime = new Date(2000, 0, 1);

      await db('chore_value').insert([
        { chore_id: dishes.id, valued_at: valuationTime, value: 10 }
      ]);

      let queryTime;
      let intervalScalar;

      queryTime = new Date(valuationTime.getTime() + (60 + 10) * 60 * 1000); // 1 hour, 10 minutes
      intervalScalar = await Chores.getChoreValueIntervalScalar(HOUSE, queryTime);
      expect(intervalScalar).to.equal(0.0013440860215053765);

      queryTime = new Date(valuationTime.getTime() + (60 + 45) * 60 * 1000); // 1 hour, 45 minutes
      intervalScalar = await Chores.getChoreValueIntervalScalar(HOUSE, queryTime);
      expect(intervalScalar).to.equal(0.0013440860215053765);

      queryTime = new Date(valuationTime.getTime() + (60 + 60) * 60 * 1000); // 2 hours
      intervalScalar = await Chores.getChoreValueIntervalScalar(HOUSE, queryTime);
      expect(intervalScalar).to.equal(0.002688172043010753);
    });

    it('can do an end-to-end update of chore values', async () => {
      // Prefer dishes to sweeping, and sweeping to restock
      await Chores.setChorePreference(HOUSE, RESIDENT1, dishes.id, sweeping.id, 1);
      await Chores.setChorePreference(HOUSE, RESIDENT2, sweeping.id, restock.id, 1);
      await sleep(1);

      const pointsPerResident = 100;
      const updateTime1 = new Date(2000, 3, 1); // April (30 days), first update gives 1 hour of value
      const updateTime2 = new Date(updateTime1.getTime() + 11 * 60 * 60 * 1000); // 11 hours later

      const intervalScalar1 = await Chores.getChoreValueIntervalScalar(HOUSE, updateTime1);
      const choreValues1 = await Chores.updateChoreValues(HOUSE, updateTime1, pointsPerResident);
      expect(choreValues1.length).to.eq.BN(3);

      await sleep(1);

      const intervalScalar2 = await Chores.getChoreValueIntervalScalar(HOUSE, updateTime2);
      const choreValues2 = await Chores.updateChoreValues(HOUSE, updateTime2, pointsPerResident);
      expect(choreValues2.length).to.eq.BN(3);

      expect(intervalScalar1 * 11).to.equal(intervalScalar2); // 1 hour vs 11 hours
      expect(intervalScalar1 + intervalScalar2).to.equal(1 / 60); // 12 hours = 1/60th of the monthly allocation

      const sumPoints1 = choreValues1.map(cv => cv.value).reduce((sum, val) => sum + val, 0);
      const sumPoints2 = choreValues2.map(cv => cv.value).reduce((sum, val) => sum + val, 0);
      expect(sumPoints1 + sumPoints2).to.equal(pointsPerResident * 2 / 60);
    });
  });

  describe('claiming chores', async () => {
    beforeEach(async () => {
      await Admin.addResident(HOUSE, RESIDENT1);
      await Admin.addResident(HOUSE, RESIDENT2);
      await Admin.addResident(HOUSE, RESIDENT3);
      await Admin.addResident(HOUSE, RESIDENT4);
    });

    it('can claim a chore', async () => {
      await db('chore_value').insert([
        { chore_id: dishes.id, valued_at: new Date(), value: 10 },
        { chore_id: dishes.id, valued_at: new Date(), value: 5 }
      ]);
      await sleep(1);

      await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      const choreClaims = await Chores.getValidChoreClaims(dishes.id);
      expect(choreClaims[0].claimed_by).to.equal(RESIDENT1);
      expect(choreClaims[0].value).to.eq.BN(15);
    });

    it('can get a chore claim by messageId', async () => {
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);

      const messageId = 'xyz';

      await Chores.claimChore(dishes.id, RESIDENT1, new Date(), messageId, POLL_LENGTH);
      await sleep(1);

      const choreClaim = await Chores.getChoreClaimByMessageId(messageId);
      expect(choreClaim.claimed_by).to.equal(RESIDENT1);
      expect(choreClaim.value).to.eq.BN(10);
    });

    it('can claim a chore incrementally', async () => {
      // Two separate events
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 5 } ]);
      await sleep(1);

      await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 20 } ]);
      await sleep(1);

      await Chores.claimChore(dishes.id, RESIDENT2, new Date(), '', POLL_LENGTH);
      await sleep(1);

      const choreClaims = await Chores.getValidChoreClaims(dishes.id);
      expect(choreClaims[0].claimed_by).to.equal(RESIDENT1);
      expect(choreClaims[0].value).to.eq.BN(15);
      expect(choreClaims[1].claimed_by).to.equal(RESIDENT2);
      expect(choreClaims[1].value).to.eq.BN(20);
    });

    it('can successfully resolve a claim', async () => {
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Polls.submitVote(choreClaim.poll_id, RESIDENT1, new Date(), YAY);
      await Polls.submitVote(choreClaim.poll_id, RESIDENT2, new Date(), YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim ] = await Chores.resolveChoreClaim(choreClaim.id);
      expect(resolvedClaim.valid).to.be.true;
      expect(resolvedClaim.value).to.eq.BN(10);
    });

    it('cannot resolve a claim before the poll closes ', async () => {
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await expect(Chores.resolveChoreClaim(choreClaim.id))
        .to.be.rejectedWith('Poll not closed!');
    });

    it('cannot successfully resolve a claim without two positive votes', async () => {
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Polls.submitVote(choreClaim.poll_id, RESIDENT1, new Date(), YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim ] = await Chores.resolveChoreClaim(choreClaim.id);
      expect(resolvedClaim.valid).to.be.false;
    });

    it('cannot successfully resolve a claim without a passing vote', async () => {
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Polls.submitVote(choreClaim.poll_id, RESIDENT1, new Date(), YAY);
      await Polls.submitVote(choreClaim.poll_id, RESIDENT2, new Date(), YAY);
      await Polls.submitVote(choreClaim.poll_id, RESIDENT3, new Date(), NAY);
      await Polls.submitVote(choreClaim.poll_id, RESIDENT4, new Date(), NAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim ] = await Chores.resolveChoreClaim(choreClaim.id);
      expect(resolvedClaim.valid).to.be.false;
    });

    it('can claim the incremental value if a prior claim is approved', async () => {
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);

      const [ choreClaim1 ] = await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 5 } ]);
      await sleep(1);

      const [ choreClaim2 ] = await Chores.claimChore(dishes.id, RESIDENT2, new Date(), '', POLL_LENGTH);
      await sleep(1);

      // Both claims are approved
      await Polls.submitVote(choreClaim1.poll_id, RESIDENT1, new Date(), YAY);
      await Polls.submitVote(choreClaim1.poll_id, RESIDENT2, new Date(), YAY);

      await Polls.submitVote(choreClaim2.poll_id, RESIDENT1, new Date(), YAY);
      await Polls.submitVote(choreClaim2.poll_id, RESIDENT2, new Date(), YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim1 ] = await Chores.resolveChoreClaim(choreClaim1.id);
      expect(resolvedClaim1.valid).to.be.true;
      expect(resolvedClaim1.value).to.eq.BN(10);

      const [ resolvedClaim2 ] = await Chores.resolveChoreClaim(choreClaim2.id);
      expect(resolvedClaim2.valid).to.be.true;
      expect(resolvedClaim2.value).to.eq.BN(5);
    });

    it('can claim the entire value if a prior claim is denied', async () => {
      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 10 } ]);
      await sleep(1);

      const [ choreClaim1 ] = await Chores.claimChore(dishes.id, RESIDENT1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await db('chore_value').insert([ { chore_id: dishes.id, valued_at: new Date(), value: 5 } ]);
      await sleep(1);

      const [ choreClaim2 ] = await Chores.claimChore(dishes.id, RESIDENT2, new Date(), '', POLL_LENGTH);
      await sleep(1);

      // First claim is rejected
      await Polls.submitVote(choreClaim1.poll_id, RESIDENT1, new Date(), YAY);
      await Polls.submitVote(choreClaim1.poll_id, RESIDENT2, new Date(), NAY);

      // Second claim is approved
      await Polls.submitVote(choreClaim2.poll_id, RESIDENT1, new Date(), YAY);
      await Polls.submitVote(choreClaim2.poll_id, RESIDENT2, new Date(), YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim1 ] = await Chores.resolveChoreClaim(choreClaim1.id);
      expect(resolvedClaim1.valid).to.be.false;
      expect(resolvedClaim1.value).to.be.zero;

      const [ resolvedClaim2 ] = await Chores.resolveChoreClaim(choreClaim2.id);
      expect(resolvedClaim2.valid).to.be.true;
      expect(resolvedClaim2.value).to.eq.BN(15);
    });
  });
});
