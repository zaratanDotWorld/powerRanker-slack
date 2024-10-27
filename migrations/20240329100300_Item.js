/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('Item', function(t) {
        t.increments('id').unsigned().primary();
        t.timestamps(useTimestamps = true, defaultToNow = true, useCamelCase = true);
        t.string('workspaceId').references('Workspace.slackId').notNull();
        t.string('name').notNull();
        t.boolean('active').notNull().defaultTo(true);
        t.jsonb('metadata').notNull().defaultTo({});
        t.unique(['workspaceId', 'name']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.dropTable('Item');
};
