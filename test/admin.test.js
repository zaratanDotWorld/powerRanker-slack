const { expect } = require('chai');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

const { Admin } = require('../src/core/index');
const { HOUR, DAY } = require('../src/constants');
const { getMonthStart, getMonthEnd, getNextMonthStart, getPrevMonthEnd, getDateStart } = require('../src/utils');
const testHelpers = require('./helpers');
const { db } = require('../src/core/db');

describe('Admin', async () => {
  const WORKSPACE1 = testHelpers.generateSlackId();
  const WORKSPACE2 = testHelpers.generateSlackId();
  const TEAMMATE1 = testHelpers.generateSlackId();
  const TEAMMATE2 = testHelpers.generateSlackId();

  let now;
  let soon;

  beforeEach(async () => {
    now = new Date();
    soon = new Date(now.getTime() + HOUR);
  });

  afterEach(async () => {
    await testHelpers.resetDb();
  });

  describe('keeping track of workspaces', async () => {
    it('can add a workspace', async () => {
      let numWorkspaces;

      [ numWorkspaces ] = await db('Workspace').count('*');
      expect(parseInt(numWorkspaces.count)).to.equal(0);

      await Admin.addWorkspace(WORKSPACE1);

      [ numWorkspaces ] = await db('Workspace').count('*');
      expect(parseInt(numWorkspaces.count)).to.equal(1);

      await Admin.addWorkspace(WORKSPACE2);

      [ numWorkspaces ] = await db('Workspace').count('*');
      expect(parseInt(numWorkspaces.count)).to.equal(2);
    });

    it('can add a workspace idempotently', async () => {
      let numWorkspaces;
      [ numWorkspaces ] = await db('Workspace').count('*');
      expect(parseInt(numWorkspaces.count)).to.equal(0);

      await Admin.addWorkspace(WORKSPACE1);
      await Admin.addWorkspace(WORKSPACE2);

      [ numWorkspaces ] = await db('Workspace').count('*');
      expect(parseInt(numWorkspaces.count)).to.equal(2);

      await Admin.addWorkspace(WORKSPACE1);
      await Admin.addWorkspace(WORKSPACE2);

      [ numWorkspaces ] = await db('Workspace').count('*');
      expect(parseInt(numWorkspaces.count)).to.equal(2);
    });

    it('can update workspace info', async () => {
      await Admin.addWorkspace(WORKSPACE1, 'h1');

      const oauth = 'oauth';
      const channel = 'channel';

      await Admin.updateWorkspaceConfig(WORKSPACE1, { channel, oauth });

      let workspace;

      workspace = await Admin.getWorkspace(WORKSPACE1);
      expect(workspace.name).to.equal('h1');
      expect(workspace.config.channel).to.equal(channel);
      expect(workspace.config.oauth).to.equal(oauth);

      await Admin.updateWorkspaceConfig(WORKSPACE1, { channel: null });

      workspace = await Admin.getWorkspace(WORKSPACE1);
      expect(workspace.config.channel).to.be.null;
      expect(workspace.config.oauth).to.equal(oauth);
    });
  });

  describe('keeping track of teammates', async () => {
    beforeEach(async () => {
      await Admin.addWorkspace(WORKSPACE1);
      await Admin.addWorkspace(WORKSPACE2);
    });

    it('can activate a teammate', async () => {
      let teammates;
      teammates = await Admin.getTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(0);

      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);

      teammates = await Admin.getTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(1);

      await Admin.activateTeammate(WORKSPACE1, TEAMMATE2, now);

      teammates = await Admin.getTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(2);

      const teammate1 = await Admin.getTeammate(TEAMMATE1);
      expect(teammate1.activeAt.getTime()).to.equal(now.getTime());
    });

    it('can activate a teammate idempotently', async () => {
      let teammates;
      teammates = await Admin.getTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(0);

      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, soon);

      teammates = await Admin.getTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(1);
      expect(teammates[0].activeAt.getTime()).to.equal(now.getTime());
    });

    it('can deactivate a teammate', async () => {
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);

      let teammates;
      teammates = await Admin.getTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(1);

      await Admin.deactivateTeammate(WORKSPACE1, TEAMMATE1);

      teammates = await Admin.getTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(0);

      const teammate = await Admin.getTeammate(TEAMMATE1);
      expect(teammate.activeAt).to.equal(null);
    });

    it('can exempt a teammate', async () => {
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);

      let teammate;
      let isExempt;

      teammate = await Admin.getTeammate(TEAMMATE1);
      isExempt = await Admin.isExempt(TEAMMATE1, now);
      expect(teammate.activeAt.getTime()).to.equal(now.getTime());
      expect(teammate.exemptAt).to.equal(null);
      expect(isExempt).to.be.false;

      await Admin.exemptTeammate(WORKSPACE1, TEAMMATE1, soon);

      teammate = await Admin.getTeammate(TEAMMATE1);
      isExempt = await Admin.isExempt(TEAMMATE1, soon);
      expect(teammate.activeAt.getTime()).to.equal(now.getTime());
      expect(teammate.exemptAt.getTime()).to.equal(soon.getTime());
      expect(isExempt).to.be.true;

      await Admin.unexemptTeammate(WORKSPACE1, TEAMMATE1, soon);

      teammate = await Admin.getTeammate(TEAMMATE1);
      isExempt = await Admin.isExempt(TEAMMATE1, soon);
      expect(teammate.activeAt.getTime()).to.equal(soon.getTime());
      expect(teammate.exemptAt).to.equal(null);
      expect(isExempt).to.be.false;
    });

    it('cannot activate a teammate if exempt', async () => {
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);
      await Admin.exemptTeammate(WORKSPACE1, TEAMMATE1, soon);
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, soon);

      const teammate = await Admin.getTeammate(TEAMMATE1);
      expect(teammate.activeAt.getTime()).to.equal(now.getTime());
      expect(teammate.exemptAt.getTime()).to.equal(soon.getTime());
    });

    it('can exempt a teammate idempotently if prior exemption exists', async () => {
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);
      await Admin.exemptTeammate(WORKSPACE1, TEAMMATE1, now);

      let teammate;
      teammate = await Admin.getTeammate(TEAMMATE1);
      expect(teammate.exemptAt.getTime()).to.equal(now.getTime());

      // Later exemption has no effect
      await Admin.exemptTeammate(WORKSPACE1, TEAMMATE1, soon);

      teammate = await Admin.getTeammate(TEAMMATE1);
      expect(teammate.exemptAt.getTime()).to.equal(now.getTime());

      // Earlier exemption overwrites current exemption
      const yesterday = new Date(now.getTime() - DAY);
      await Admin.exemptTeammate(WORKSPACE1, TEAMMATE1, yesterday);

      teammate = await Admin.getTeammate(TEAMMATE1);
      expect(teammate.exemptAt.getTime()).to.equal(yesterday.getTime());
    });

    it('can get voting teammates', async () => {
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE2, now);

      let votingTeammates;
      votingTeammates = await Admin.getVotingTeammates(WORKSPACE1, now);
      expect(votingTeammates.length).to.equal(2);

      await Admin.exemptTeammate(WORKSPACE1, TEAMMATE2, soon);

      // Exemption takes effect after exemptAt
      votingTeammates = await Admin.getVotingTeammates(WORKSPACE1, now);
      expect(votingTeammates.length).to.equal(2);
      votingTeammates = await Admin.getVotingTeammates(WORKSPACE1, soon);
      expect(votingTeammates.length).to.equal(1);
    });

    it('can handle many exempt users', async () => {
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE1, now);
      await Admin.activateTeammate(WORKSPACE1, TEAMMATE2, now);

      let teammates;
      let votingTeammates;

      teammates = await Admin.getTeammates(WORKSPACE1, now);
      votingTeammates = await Admin.getVotingTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(2);
      expect(votingTeammates.length).to.equal(2);

      await testHelpers.createExemptUsers(WORKSPACE1, 10, now);

      teammates = await Admin.getTeammates(WORKSPACE1, now);
      votingTeammates = await Admin.getVotingTeammates(WORKSPACE1, now);
      expect(teammates.length).to.equal(12);
      expect(votingTeammates.length).to.equal(2);
    });
  });

  describe('utility functions', async () => {
    it('can manipulate timestamps correctly', async () => {
      const feb1 = new Date(2022, 1, 1);
      const feb14 = new Date(2022, 1, 14);
      const feb28 = new Date(2022, 1, 28);
      const mar1 = new Date(2022, 2, 1);
      const mar15 = new Date(2022, 2, 15);
      const mar31 = new Date(2022, 2, 31);

      expect(getMonthStart(feb1).getTime()).to.equal(feb1.getTime());
      expect(getMonthStart(feb14).getTime()).to.equal(feb1.getTime());
      expect(getMonthStart(feb28).getTime()).to.equal(feb1.getTime());
      expect(getMonthStart(mar1).getTime()).to.equal(mar1.getTime());
      expect(getMonthStart(mar15).getTime()).to.equal(mar1.getTime());
      expect(getMonthStart(mar31).getTime()).to.equal(mar1.getTime());

      expect(getMonthEnd(feb1).getTime()).to.equal(feb28.getTime() + DAY - 1);
      expect(getMonthEnd(feb14).getTime()).to.equal(feb28.getTime() + DAY - 1);
      expect(getMonthEnd(feb28).getTime()).to.equal(feb28.getTime() + DAY - 1);
      expect(getMonthEnd(mar1).getTime()).to.equal(mar31.getTime() + DAY - 1);
      expect(getMonthEnd(mar15).getTime()).to.equal(mar31.getTime() + DAY - 1);
      expect(getMonthEnd(mar31).getTime()).to.equal(mar31.getTime() + DAY - 1);

      expect(getPrevMonthEnd(mar1).getTime()).to.equal(feb28.getTime() + DAY - 1);
      expect(getPrevMonthEnd(mar15).getTime()).to.equal(feb28.getTime() + DAY - 1);
      expect(getPrevMonthEnd(mar31).getTime()).to.equal(feb28.getTime() + DAY - 1);

      expect(getNextMonthStart(feb1).getTime()).to.equal(mar1.getTime());
      expect(getNextMonthStart(feb14).getTime()).to.equal(mar1.getTime());
      expect(getNextMonthStart(feb28).getTime()).to.equal(mar1.getTime());

      expect(getDateStart(now).getHours()).to.equal(0);
      expect(getDateStart(now).getMinutes()).to.equal(0);
      expect(getDateStart(now).getSeconds()).to.equal(0);
    });
  });
});
