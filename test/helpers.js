const randomstring = require('randomstring');
const { Admin } = require('../src/core/index');
const { db } = require('../src/core/db');

exports.generateSlackId = function () {
  return randomstring.generate({
    charset: 'alphanumeric',
    capitalization: 'uppercase',
    length: 11,
  });
};

exports.createExemptUsers = async function (workspaceId, num, now) {
  for (let i = 0; i < num; i++) {
    const teammateId = exports.generateSlackId();
    await Admin.activateTeammate(workspaceId, teammateId, now);
    await Admin.exemptTeammate(workspaceId, teammateId, now);
  }
};

exports.resetDb = async function () {
  await db('Preference').del();
  await db('Item').del();
  await db('Teammate').del();
  await db('Workspace').del();
};
