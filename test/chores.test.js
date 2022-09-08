const { expect } = require('chai');
const chai = require('chai');
const BN = require('bn.js');
const bnChai = require('bn-chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(bnChai(BN));
chai.use(chaiAsPromised);

const { USER1, USER2, USER3, USER4, YAY, NAY, FIRST, SECOND, DISHES, SWEEPING, RESTOCK } = require('../src/constants');

const { db } = require('../src/db');
const Chores = require('../src/modules/chores/chores');
const Power = require('../src/modules/chores/power');
const Polls = require('../src/modules/polls/polls');

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Chores', async () => {
  const POLL_LENGTH = 35;

  afterEach(async () => {
    await db('chore_claim').del();
    await db('chore_value').del();
    await db('chore_pref').del();
    await db('poll_vote').del();
    await db('poll').del();
  });

  describe('managing chore values', async () => {
    it('can list the existing chores', async () => {
      const allChores = await Chores.getChores();

      expect(allChores.length).to.eq.BN(3);
    });

    it('can set and query for the latest chore values', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await Chores.setChoreValues([ { chore_name: DISHES, value: 5 } ]);
      await Chores.setChoreValues([ { chore_name: SWEEPING, value: 20 } ]);

      const now = new Date();
      const endTime = new Date(now.getTime() + 1000);
      const startTime = new Date(now.getTime() - 1000);

      const dishesValue = await Chores.getChoreValue(DISHES, startTime, endTime);
      expect(dishesValue.sum).to.eq.BN(15);

      const sweepingValue = await Chores.getChoreValue(SWEEPING, startTime, endTime);
      expect(sweepingValue.sum).to.eq.BN(20);
    });

    it('can set a chore preference', async () => {
      await Chores.setChorePreference(USER1, DISHES, SWEEPING, FIRST);
      await Chores.setChorePreference(USER2, DISHES, SWEEPING, SECOND);

      const preferences = await Chores.getChorePreferences();
      expect(preferences[0].preference).to.equal(FIRST);
      expect(preferences[1].preference).to.equal(SECOND);
    });

    it('can update a chore preference', async () => {
      await Chores.setChorePreference(USER1, DISHES, SWEEPING, FIRST);
      await Chores.setChorePreference(USER1, DISHES, SWEEPING, SECOND);

      const preferences = await Chores.getChorePreferences();
      expect(preferences.length).to.eq.BN(1);
      expect(preferences[0].preference).to.equal(SECOND);
    });

    it('cannot set a chore preference in a bad order', async () => {
      await expect(Chores.setChorePreference(USER1, SWEEPING, DISHES, FIRST))
        .to.be.rejectedWith('Chores out of order');
    });

    it('can use preferences to determine chore values', async () => {
      // Prefer dishes to sweeping, and sweeping to restock
      await Chores.setChorePreference(USER1, DISHES, SWEEPING, FIRST);
      await Chores.setChorePreference(USER2, RESTOCK, SWEEPING, SECOND);

      const preferences = await Chores.getChorePreferences();

      const directedPreferences = Power.convertPreferences(preferences);
      const matrix = Power.toMatrix(directedPreferences);
      const weights = Power.powerMethod(matrix, d = 0.8); // eslint-disable-line no-undef
      const labeledWeights = Power.applyLabels(directedPreferences, weights);

      expect(labeledWeights.get('dishes')).to.equal(0.7328964266666669);
      expect(labeledWeights.get('sweeping')).to.equal(0.2004369066666667);
      expect(labeledWeights.get('restock')).to.equal(0.06666666666666667);
    });
  });

  describe('claiming chores', async () => {
    it('can claim a chore', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await Chores.setChoreValues([ { chore_name: DISHES, value: 5 } ]);
      await sleep(1);

      await Chores.claimChore(DISHES, USER1, new Date(), '');
      await sleep(1);

      const choreClaims = await Chores.getChoreClaims(DISHES);
      expect(choreClaims[0].claimed_by).to.equal(USER1);
      expect(choreClaims[0].value).to.eq.BN(15);
    });

    it('can claim a chore incrementally', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await Chores.setChoreValues([ { chore_name: DISHES, value: 5 } ]);
      await sleep(1);

      await Chores.claimChore(DISHES, USER1, new Date(), '');
      await sleep(1);

      await Chores.setChoreValues([ { chore_name: DISHES, value: 20 } ]);
      await sleep(1);

      await Chores.claimChore(DISHES, USER2, new Date(), '');
      await sleep(1);

      const choreClaims = await Chores.getChoreClaims(DISHES);
      expect(choreClaims[0].claimed_by).to.equal(USER1);
      expect(choreClaims[0].value).to.eq.BN(15);
      expect(choreClaims[1].claimed_by).to.equal(USER2);
      expect(choreClaims[1].value).to.eq.BN(20);
    });

    it('can successfully resolve a claim', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(DISHES, USER1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Polls.submitVote(choreClaim.poll_id, USER1, YAY);
      await Polls.submitVote(choreClaim.poll_id, USER2, YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim ] = await Chores.resolveChoreClaim(choreClaim.id);
      expect(resolvedClaim.result).to.equal('pass');
      expect(resolvedClaim.value).to.eq.BN(10);
    });

    it('cannot resolve a claim before the poll closes ', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(DISHES, USER1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await expect(Chores.resolveChoreClaim(choreClaim.id))
        .to.be.rejectedWith('Poll not closed!');
    });

    it('cannot resolve a claim twice', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(DISHES, USER1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await sleep(POLL_LENGTH);

      await Chores.resolveChoreClaim(choreClaim.id);
      await sleep(1);

      await expect(Chores.resolveChoreClaim(choreClaim.id))
        .to.be.rejectedWith('Claim already resolved!');
    });

    it('cannot successfully resolve a claim without two positive votes', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(DISHES, USER1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Polls.submitVote(choreClaim.poll_id, USER1, YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim ] = await Chores.resolveChoreClaim(choreClaim.id);
      expect(resolvedClaim.result).to.equal('fail');
    });

    it('cannot successfully resolve a claim without a passing vote', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await sleep(1);

      const [ choreClaim ] = await Chores.claimChore(DISHES, USER1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Polls.submitVote(choreClaim.poll_id, USER1, YAY);
      await Polls.submitVote(choreClaim.poll_id, USER2, YAY);
      await Polls.submitVote(choreClaim.poll_id, USER3, NAY);
      await Polls.submitVote(choreClaim.poll_id, USER4, NAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim ] = await Chores.resolveChoreClaim(choreClaim.id);
      expect(resolvedClaim.result).to.equal('fail');
    });

    it('can claim the incremental value if a prior claim is approved', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await sleep(1);

      const [ choreClaim1 ] = await Chores.claimChore(DISHES, USER1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Chores.setChoreValues([ { chore_name: DISHES, value: 5 } ]);
      await sleep(1);

      const [ choreClaim2 ] = await Chores.claimChore(DISHES, USER2, new Date(), '', POLL_LENGTH);
      await sleep(1);

      // Both claims are approved
      await Polls.submitVote(choreClaim1.poll_id, USER1, YAY);
      await Polls.submitVote(choreClaim1.poll_id, USER2, YAY);

      await Polls.submitVote(choreClaim2.poll_id, USER1, YAY);
      await Polls.submitVote(choreClaim2.poll_id, USER2, YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim1 ] = await Chores.resolveChoreClaim(choreClaim1.id);
      expect(resolvedClaim1.result).to.equal('pass');
      expect(resolvedClaim1.value).to.eq.BN(10);

      const [ resolvedClaim2 ] = await Chores.resolveChoreClaim(choreClaim2.id);
      expect(resolvedClaim2.result).to.equal('pass');
      expect(resolvedClaim2.value).to.eq.BN(5);
    });

    it('can claim the entire value if a prior claim is denied', async () => {
      await Chores.setChoreValues([ { chore_name: DISHES, value: 10 } ]);
      await sleep(1);

      const [ choreClaim1 ] = await Chores.claimChore(DISHES, USER1, new Date(), '', POLL_LENGTH);
      await sleep(1);

      await Chores.setChoreValues([ { chore_name: DISHES, value: 5 } ]);
      await sleep(1);

      const [ choreClaim2 ] = await Chores.claimChore(DISHES, USER2, new Date(), '', POLL_LENGTH);
      await sleep(1);

      // First claim is rejected
      await Polls.submitVote(choreClaim1.poll_id, USER1, YAY);
      await Polls.submitVote(choreClaim1.poll_id, USER2, NAY);

      // Second claim is approved
      await Polls.submitVote(choreClaim2.poll_id, USER1, YAY);
      await Polls.submitVote(choreClaim2.poll_id, USER2, YAY);

      await sleep(POLL_LENGTH);

      const [ resolvedClaim1 ] = await Chores.resolveChoreClaim(choreClaim1.id);
      expect(resolvedClaim1.result).to.equal('fail');
      expect(resolvedClaim1.value).to.be.zero;

      const [ resolvedClaim2 ] = await Chores.resolveChoreClaim(choreClaim2.id);
      expect(resolvedClaim2.result).to.equal('pass');
      expect(resolvedClaim2.value).to.eq.BN(15);
    });
  });
});
