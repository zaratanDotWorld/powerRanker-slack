/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('Preference', function(t) {
        t.increments('id').unsigned().primary();
        t.timestamps(useTimestamps = true, defaultToNow = true, useCamelCase = true);
        t.string('workspaceId').references('Workspace.slackId').notNull();
        t.string('teammateId').references('Teammate.slackId').notNull();
        t.integer('alphaItemId').references('Item.id').notNull();
        t.integer('betaItemId').references('Item.id').notNull();
        t.float('value').notNull().checkBetween([0, 1]);
        t.unique(['workspaceId', 'teammateId', 'alphaItemId', 'betaItemId']);
        t.check('?? < ??', ['alphaItemId', 'betaItemId']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.dropTable('Preference');
};
