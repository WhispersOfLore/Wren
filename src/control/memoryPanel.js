const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const memoryManager = require('../memory/memoryManager');
const playerManager = require('../memory/playerManager');
const { ephemeral } = require('../utils/discordReply');

const IDS = {
  ADD: 'wren_memory_add',
  SEARCH: 'wren_memory_search',
  VIEW: 'wren_memory_view',
  EDIT: 'wren_memory_edit',
  REMOVE: 'wren_memory_remove',
  ADD_MODAL: 'wren_memory_add_modal',
  SEARCH_MODAL: 'wren_memory_search_modal',
  VIEW_MODAL: 'wren_memory_view_modal',
  EDIT_MODAL: 'wren_memory_edit_modal',
  REMOVE_MODAL: 'wren_memory_remove_modal',
  PLAYER_INPUT: 'wren_memory_player_input',
  CONTENT_INPUT: 'wren_memory_content_input',
  IMPORTANCE_INPUT: 'wren_memory_importance_input',
  CATEGORY_INPUT: 'wren_memory_category_input',
  QUERY_INPUT: 'wren_memory_query_input',
  MEMORY_ID_INPUT: 'wren_memory_id_input',
};

async function buildMemoryPanel() {
  const [count, linked] = await Promise.all([memoryManager.getMemoryCount(), playerManager.getLinkedPlayerCount()]);

  const embed = new EmbedBuilder()
    .setTitle('🧠 Wren Memory')
    .setColor(0x5865f2)
    .setDescription('Manage what Wren remembers about players.')
    .addFields(
      { name: 'Total Memories', value: String(count), inline: true },
      { name: 'Linked Players', value: String(linked), inline: true },
    )
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.ADD).setLabel('Add Memory').setEmoji('🧠').setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(IDS.SEARCH)
      .setLabel('Search Memory')
      .setEmoji('🔎')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(IDS.VIEW)
      .setLabel('View Player Memories')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(IDS.EDIT).setLabel('Edit Memory').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(IDS.REMOVE).setLabel('Remove Memory').setEmoji('🗑').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

function buildAddModal() {
  const modal = new ModalBuilder().setCustomId(IDS.ADD_MODAL).setTitle('Add Memory');

  const player = new TextInputBuilder()
    .setCustomId(IDS.PLAYER_INPUT)
    .setLabel('Player (@mention or Discord ID)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const content = new TextInputBuilder()
    .setCustomId(IDS.CONTENT_INPUT)
    .setLabel('Memory')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const importance = new TextInputBuilder()
    .setCustomId(IDS.IMPORTANCE_INPUT)
    .setLabel('Importance (1-5, 5 = legendary)')
    .setStyle(TextInputStyle.Short)
    .setValue('3')
    .setRequired(true);

  const category = new TextInputBuilder()
    .setCustomId(IDS.CATEGORY_INPUT)
    .setLabel('Category')
    .setPlaceholder(memoryManager.CATEGORIES.join(', '))
    .setStyle(TextInputStyle.Short)
    .setValue('personal')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(player),
    new ActionRowBuilder().addComponents(content),
    new ActionRowBuilder().addComponents(importance),
    new ActionRowBuilder().addComponents(category),
  );

  return modal;
}

function buildSearchModal() {
  const modal = new ModalBuilder().setCustomId(IDS.SEARCH_MODAL).setTitle('Search Memories');
  const query = new TextInputBuilder()
    .setCustomId(IDS.QUERY_INPUT)
    .setLabel('Search query')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(query));
  return modal;
}

function buildViewModal() {
  const modal = new ModalBuilder().setCustomId(IDS.VIEW_MODAL).setTitle('View Player Memories');
  const player = new TextInputBuilder()
    .setCustomId(IDS.PLAYER_INPUT)
    .setLabel('Player (@mention or Discord ID)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(player));
  return modal;
}

// Discord can't show a modal in response to a modal submit, so editing can't
// pre-fill from the memory's current values in one step. Instead this asks
// for the ID (found via Search or View first) plus whichever fields should
// change — any field left blank keeps its current value, matching how
// memoryManager.updateMemory() applies a partial update.
function buildEditModal() {
  const modal = new ModalBuilder().setCustomId(IDS.EDIT_MODAL).setTitle('Edit Memory');

  const memoryId = new TextInputBuilder()
    .setCustomId(IDS.MEMORY_ID_INPUT)
    .setLabel('Memory ID (from Search or View)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const content = new TextInputBuilder()
    .setCustomId(IDS.CONTENT_INPUT)
    .setLabel('New memory (leave blank to keep as-is)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  const importance = new TextInputBuilder()
    .setCustomId(IDS.IMPORTANCE_INPUT)
    .setLabel('New importance 1-5 (blank to keep)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const category = new TextInputBuilder()
    .setCustomId(IDS.CATEGORY_INPUT)
    .setLabel('New category (blank to keep)')
    .setPlaceholder(memoryManager.CATEGORIES.join(', '))
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(memoryId),
    new ActionRowBuilder().addComponents(content),
    new ActionRowBuilder().addComponents(importance),
    new ActionRowBuilder().addComponents(category),
  );

  return modal;
}

function buildRemoveModal() {
  const modal = new ModalBuilder().setCustomId(IDS.REMOVE_MODAL).setTitle('Remove Memory');
  const memoryId = new TextInputBuilder()
    .setCustomId(IDS.MEMORY_ID_INPUT)
    .setLabel('Memory ID (from Search or View)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(memoryId));
  return modal;
}

async function handleComponent(interaction) {
  switch (interaction.customId) {
    case IDS.ADD:
      await interaction.showModal(buildAddModal());
      return;
    case IDS.SEARCH:
      await interaction.showModal(buildSearchModal());
      return;
    case IDS.VIEW:
      await interaction.showModal(buildViewModal());
      return;
    case IDS.EDIT:
      await interaction.showModal(buildEditModal());
      return;
    case IDS.REMOVE:
      await interaction.showModal(buildRemoveModal());
      return;
    default:
  }
}

function formatMemoryRow(row) {
  const label = memoryManager.IMPORTANCE_LABELS[row.importance] || row.importance;
  return `**#${row.id}** [${row.category}/${label}] ${row.content}`;
}

async function handleModalSubmit(interaction) {
  switch (interaction.customId) {
    case IDS.ADD_MODAL: {
      const playerRaw = interaction.fields.getTextInputValue(IDS.PLAYER_INPUT);
      const content = interaction.fields.getTextInputValue(IDS.CONTENT_INPUT);
      const importanceRaw = interaction.fields.getTextInputValue(IDS.IMPORTANCE_INPUT);
      const categoryRaw = interaction.fields.getTextInputValue(IDS.CATEGORY_INPUT);

      const discordId = playerManager.parseDiscordId(playerRaw);
      if (!discordId) {
        await interaction.reply(
          ephemeral({ content: "I couldn't tell who that player is, sugar. Use an @mention or their Discord ID." }),
        );
        return;
      }

      const importance = Number.parseInt(importanceRaw, 10);
      if (!memoryManager.isValidImportance(importance)) {
        await interaction.reply(ephemeral({ content: 'Importance must be a whole number from 1 to 5.' }));
        return;
      }

      const id = await memoryManager.addMemory({
        discordId,
        category: categoryRaw?.trim().toLowerCase(),
        content,
        importance,
        createdBy: interaction.user.id,
      });

      await interaction.reply(ephemeral({ content: `Memory #${id} saved for <@${discordId}>.` }));
      return;
    }

    case IDS.SEARCH_MODAL: {
      const query = interaction.fields.getTextInputValue(IDS.QUERY_INPUT);
      const results = await memoryManager.searchMemories(query, 10);

      if (results.length === 0) {
        await interaction.reply(ephemeral({ content: `No memories match "${query}".` }));
        return;
      }

      const lines = results.map(
        (row) => `${formatMemoryRow(row)} — ${row.display_name || row.minecraft_username || `<@${row.discord_id}>`}`,
      );
      await interaction.reply(ephemeral({ content: `**Results for "${query}":**\n${lines.join('\n')}` }));
      return;
    }

    case IDS.VIEW_MODAL: {
      const playerRaw = interaction.fields.getTextInputValue(IDS.PLAYER_INPUT);
      const discordId = playerManager.parseDiscordId(playerRaw);
      if (!discordId) {
        await interaction.reply(
          ephemeral({ content: "I couldn't tell who that player is, sugar. Use an @mention or their Discord ID." }),
        );
        return;
      }

      const results = await memoryManager.getMemoriesForUser(discordId);
      if (results.length === 0) {
        await interaction.reply(ephemeral({ content: `I don't have any memories of <@${discordId}> yet.` }));
        return;
      }

      const lines = results.map(formatMemoryRow);
      await interaction.reply(ephemeral({ content: `**Memories of <@${discordId}>:**\n${lines.join('\n')}` }));
      return;
    }

    case IDS.EDIT_MODAL: {
      const idRaw = interaction.fields.getTextInputValue(IDS.MEMORY_ID_INPUT);
      const id = Number.parseInt(idRaw, 10);
      if (!Number.isInteger(id)) {
        await interaction.reply(ephemeral({ content: 'That memory ID is not a number.' }));
        return;
      }

      const contentRaw = interaction.fields.getTextInputValue(IDS.CONTENT_INPUT);
      const importanceRaw = interaction.fields.getTextInputValue(IDS.IMPORTANCE_INPUT);
      const categoryRaw = interaction.fields.getTextInputValue(IDS.CATEGORY_INPUT);

      const changes = {};
      if (contentRaw) changes.content = contentRaw;
      if (categoryRaw) changes.category = categoryRaw.trim().toLowerCase();
      if (importanceRaw) {
        const importance = Number.parseInt(importanceRaw, 10);
        if (!memoryManager.isValidImportance(importance)) {
          await interaction.reply(ephemeral({ content: 'Importance must be a whole number from 1 to 5.' }));
          return;
        }
        changes.importance = importance;
      }

      if (Object.keys(changes).length === 0) {
        await interaction.reply(
          ephemeral({ content: 'Nothing to change — fill in at least one field, or leave all blank to cancel.' }),
        );
        return;
      }

      const updated = await memoryManager.updateMemory(id, changes, interaction.user.id);
      await interaction.reply(
        ephemeral({ content: updated ? `Memory #${id} updated.` : `No memory found with ID #${id}.` }),
      );
      return;
    }

    case IDS.REMOVE_MODAL: {
      const idRaw = interaction.fields.getTextInputValue(IDS.MEMORY_ID_INPUT);
      const id = Number.parseInt(idRaw, 10);
      if (!Number.isInteger(id)) {
        await interaction.reply(ephemeral({ content: 'That memory ID is not a number.' }));
        return;
      }

      const removed = await memoryManager.removeMemory(id, interaction.user.id);
      await interaction.reply(
        ephemeral({ content: removed ? `Memory #${id} removed.` : `No memory found with ID #${id}.` }),
      );
      return;
    }

    default:
  }
}

module.exports = { buildMemoryPanel, handleComponent, handleModalSubmit, IDS };
