const { expect } = require('chai');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { Things, Polls, Admin } = require('../src/core/index');
const { NAY, YAY, HOUR, DAY } = require('../src/constants');
const { thingsPollLength } = require('../src/config');
const { db } = require('../src/core/db');

describe('Things', async () => {
  const HOUSE = 'house123';

  const RESIDENT1 = 'RESIDENT1';
  const RESIDENT2 = 'RESIDENT2';
  const RESIDENT3 = 'RESIDENT3';

  const PANTRY = 'pantry';
  const SOAP = 'soap';
  const RICE = 'rice';

  let now;
  let soon;
  let challengeEnd;

  before(async () => {
    await db('Thing').del();
    await db('Resident').del();
    await db('House').del();

    now = new Date();
    soon = new Date(now.getTime() + HOUR);
    challengeEnd = new Date(now.getTime() + thingsPollLength);

    await Admin.updateHouse({ slackId: HOUSE });
    await Admin.addResident(HOUSE, RESIDENT1, now);
    await Admin.addResident(HOUSE, RESIDENT2, now);
    await Admin.addResident(HOUSE, RESIDENT3, now);
  });

  afterEach(async () => {
    await db('ThingBuy').del();
    await db('Thing').del();
    await db('PollVote').del();
    await db('Poll').del();
  });

  describe('managing the list', async () => {
    it('can manage items on the list', async () => {
      const [ soap ] = await Things.updateThing({ houseId: HOUSE, type: PANTRY, name: SOAP, value: 10 });
      await Things.updateThing({ houseId: HOUSE, type: PANTRY, name: RICE, value: 60 });

      let things;
      things = await Things.getThings(HOUSE);
      expect(things.length).to.equal(2);
      expect(things[0].name).to.equal(RICE);
      expect(things[1].name).to.equal(SOAP);

      await Things.deleteThing(soap.id);
      await Things.updateThing({ houseId: HOUSE, type: PANTRY, name: RICE, value: 20 });

      things = await Things.getThings(HOUSE);
      expect(things.length).to.equal(1);
      expect(things.find(thing => thing.name === RICE).value).to.equal(20);
    });

    it('can get a thing by id', async () => {
      const [ soap ] = await Things.updateThing({ houseId: HOUSE, type: PANTRY, name: SOAP, value: 10 });

      const thing = await Things.getThing(soap.id);
      expect(thing.name).to.equal(soap.name);
    });
  });

  describe('buying things from the list', async () => {
    let soap;
    let rice;

    beforeEach(async () => {
      [ soap ] = await Things.updateThing({ houseId: HOUSE, type: PANTRY, name: SOAP, value: 10 });
      [ rice ] = await Things.updateThing({ houseId: HOUSE, type: PANTRY, name: RICE, value: 60 });
    });

    it('can buy a thing from the list', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      let balance;
      balance = await Things.getHouseBalance(HOUSE, now);
      expect(balance.sum).to.equal(100);

      let buy;
      [ buy ] = await Things.buyThing(HOUSE, rice.id, RESIDENT1, now, 60, 1);
      expect(buy.value).to.equal(-60);
      expect(buy.metadata.quantity).to.equal(1);

      balance = await Things.getHouseBalance(HOUSE, now);
      expect(balance.sum).to.equal(40);

      [ buy ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 3);
      expect(buy.value).to.equal(-30);
      expect(buy.metadata.quantity).to.equal(3);

      balance = await Things.getHouseBalance(HOUSE, now);
      expect(balance.sum).to.equal(10);
    });

    it('cannot buy a thing with insufficient funds', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 20);

      await expect(Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 3))
        .to.be.rejectedWith('Insufficient funds!');

      await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 2);
    });

    it('can affirm a buy', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      let [ buy ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 1);

      await Polls.submitVote(buy.pollId, RESIDENT1, now, YAY);

      await Things.resolveThingBuy(buy.id, challengeEnd);

      const balance = await Things.getHouseBalance(HOUSE, challengeEnd);
      expect(balance.sum).to.equal(90);

      buy = await Things.getThingBuy(buy.id);
      expect(buy.valid).to.be.true;
      expect(buy.resolvedAt.getTime()).to.equal(challengeEnd.getTime());
    });

    it('can reject a buy', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      let [ buy ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 1);

      await Polls.submitVote(buy.pollId, RESIDENT1, now, YAY);
      await Polls.submitVote(buy.pollId, RESIDENT2, now, NAY);

      await Things.resolveThingBuy(buy.id, challengeEnd);

      const balance = await Things.getHouseBalance(HOUSE, challengeEnd);
      expect(balance.sum).to.equal(100);

      buy = await Things.getThingBuy(buy.id);
      expect(buy.valid).to.be.false;
      expect(buy.resolvedAt.getTime()).to.equal(challengeEnd.getTime());
    });

    it('can negate a buy if quorum is not reached', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      // Need 1 affirmative vote per $50
      let [ buy ] = await Things.buyThing(HOUSE, rice.id, RESIDENT1, now, 60, 1);

      await Polls.submitVote(buy.pollId, RESIDENT1, now, YAY);

      await Things.resolveThingBuy(buy.id, challengeEnd);

      buy = await Things.getThingBuy(buy.id);
      expect(buy.valid).to.be.false;
    });

    it('cannot resolve a buy before the poll is closed', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      const [ buy ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 1);

      await expect(Things.resolveThingBuy(buy.id, soon))
        .to.be.rejectedWith('Poll not closed!');
    });

    it('cannot resolve a buy twice', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      let [ buy ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 1);

      await Polls.submitVote(buy.pollId, RESIDENT1, now, YAY);

      await Things.resolveThingBuy(buy.id, challengeEnd);

      [ buy ] = await Things.resolveThingBuy(buy.id, challengeEnd);
      expect(buy).to.be.undefined;
    });

    it('can resolve buys in bulk', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      const [ thingBuy1 ] = await Things.buyThing(HOUSE, rice.id, RESIDENT1, now, 10, 1);
      const [ thingBuy2 ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 1);
      const [ thingBuy3 ] = await Things.buyThing(HOUSE, rice.id, RESIDENT1, soon, 10, 1);

      await Polls.submitVote(thingBuy1.pollId, RESIDENT1, now, YAY);

      await Things.resolveThingBuys(HOUSE, challengeEnd);

      const resolvedBuy1 = await Things.getThingBuy(thingBuy1.id);
      expect(resolvedBuy1.valid).to.be.true;
      expect(resolvedBuy1.resolvedAt.getTime()).to.equal(challengeEnd.getTime());

      const resolvedBuy2 = await Things.getThingBuy(thingBuy2.id);
      expect(resolvedBuy2.valid).to.be.false;
      expect(resolvedBuy2.resolvedAt.getTime()).to.equal(challengeEnd.getTime());

      // This buy was not resolved as poll is not yet closed
      const resolvedBuy3 = await Things.getThingBuy(thingBuy3.id);
      expect(resolvedBuy3.valid).to.be.true;
      expect(resolvedBuy3.resolvedAt).to.equal(null);
    });

    it('can get a list of unfulfilled buys', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      const [ buy ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 1);

      await Polls.submitVote(buy.pollId, RESIDENT1, now, NAY);

      let unfulfilledBuys;
      unfulfilledBuys = await Things.getUnfulfilledThingBuys(HOUSE, challengeEnd);
      expect(unfulfilledBuys.length).to.equal(1);

      await Things.resolveThingBuy(buy.id, challengeEnd);

      unfulfilledBuys = await Things.getUnfulfilledThingBuys(HOUSE, challengeEnd);
      expect(unfulfilledBuys.length).to.equal(0);
    });

    it('can fulfill a buy', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      const [ buy ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, now, 10, 1);

      await Polls.submitVote(buy.pollId, RESIDENT1, now, YAY);
      await Things.resolveThingBuy(buy.id, challengeEnd);

      const [ fulfilledBuy ] = await Things.fulfillThingBuy(buy.id, RESIDENT2, challengeEnd);
      expect(fulfilledBuy.fulfilledAt.getTime()).to.equal(challengeEnd.getTime());
      expect(fulfilledBuy.fulfilledBy).to.equal(RESIDENT2);
    });

    it('can get a list of fulfilled buys within a time range', async () => {
      await Things.loadHouseAccount(HOUSE, RESIDENT1, now, 100);

      const nextWeek = new Date(now.getTime() + 7 * DAY);
      const nextMonth = new Date(now.getTime() + 28 * DAY);

      const [ thingBuy1 ] = await Things.buyThing(HOUSE, rice.id, RESIDENT1, now, 10, 1);
      const [ thingBuy2 ] = await Things.buyThing(HOUSE, soap.id, RESIDENT1, nextWeek, 15, 1);
      const [ thingBuy3 ] = await Things.buyThing(HOUSE, rice.id, RESIDENT1, nextMonth, 20, 1);

      await Polls.submitVote(thingBuy1.pollId, RESIDENT1, now, YAY);
      await Polls.submitVote(thingBuy2.pollId, RESIDENT1, nextWeek, YAY);
      await Polls.submitVote(thingBuy3.pollId, RESIDENT1, nextMonth, YAY);

      const nextWeekChallengeEnd = new Date(nextWeek.getTime() + thingsPollLength);
      const nextMonthChallengeEnd = new Date(nextMonth.getTime() + thingsPollLength);

      await Things.resolveThingBuy(thingBuy1.id, challengeEnd);
      await Things.resolveThingBuy(thingBuy2.id, nextWeekChallengeEnd);
      await Things.resolveThingBuy(thingBuy3.id, nextMonthChallengeEnd);

      let fulfilledBuys;

      fulfilledBuys = await Things.getFulfilledThingBuys(HOUSE, now, nextMonthChallengeEnd);
      expect(fulfilledBuys.length).to.equal(0);

      await Things.fulfillThingBuy(thingBuy1.id, RESIDENT1, challengeEnd);
      await Things.fulfillThingBuy(thingBuy2.id, RESIDENT1, nextWeekChallengeEnd);
      await Things.fulfillThingBuy(thingBuy3.id, RESIDENT1, nextMonthChallengeEnd);

      // first
      fulfilledBuys = await Things.getFulfilledThingBuys(HOUSE, now, challengeEnd);
      expect(fulfilledBuys.length).to.equal(1);
      expect(fulfilledBuys.find(buy => buy.name === RICE).value).to.equal(-10);

      // all three
      fulfilledBuys = await Things.getFulfilledThingBuys(HOUSE, now, nextMonthChallengeEnd);
      expect(fulfilledBuys.length).to.equal(2);
      expect(fulfilledBuys.find(buy => buy.name === RICE).value).to.equal(-30);
      expect(fulfilledBuys.find(buy => buy.name === SOAP).value).to.equal(-15);

      // last two
      fulfilledBuys = await Things.getFulfilledThingBuys(HOUSE, nextWeekChallengeEnd, nextMonthChallengeEnd);
      expect(fulfilledBuys.length).to.equal(2);
      expect(fulfilledBuys.find(buy => buy.name === RICE).value).to.equal(-20);
      expect(fulfilledBuys.find(buy => buy.name === SOAP).value).to.equal(-15);
    });
  });
});
