const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const loreManager = require('../lore/loreManager');
const { ephemeral } = require('../utils/discordReply');

const IDS = {
  ADD: 'wren_lore_add',
  SEARCH: 'wren_lore_search',
  EDIT: 'wren_lore_edit',
  REMOVE: 'wren_lore_remove',
  ADD_MODAL: 'wren_lore_add_modal',
  SEARCH_MODAL: 'wren_lore_search_modal',
  EDIT_MODAL: 'wren_lore_edit_modal',
  REMOVE_MODAL: 'wren_lore_remove_modal',
  CATEGORY_INPUT: 'wren_lore_category_input',
  TITLE_INPUT: 'wren_lore_title_input',
  CONTENT_INPUT: 'wren_lore_content_input',
  QUERY_INPUT: 'wren_lore_query_input',
  LORE_ID_INPUT: 'wren_lore_id_input',
};

async function buildLorePanel() {
  const count = await loreManager.getLoreCount();

  const embed = new EmbedBuilder()
    .setTitle('📖 Wren Lore Archive')
    .setColor(0x5865f2)
    .setDescription("Manage Wren's knowledge of the Whisper universe.")
    .addFields({ name: 'Total Lore Entries', value: String(count), inline: true })
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.ADD).setLabel('Add Lore').setEmoji('📖').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(IDS.SEARCH).setLabel('Search Lore').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(IDS.EDIT).setLabel('Edit Lore').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(IDS.REMOVE).setLabel('Remove Lore').setEmoji('🗑').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

function buildAddModal() {
  const modal = new ModalBuilder().setCustomId(IDS.ADD_MODAL).setTitle('Add Lore');

  const category = new TextInputBuilder()
    .setCustomId(IDS.CATEGORY_INPUT)
    .setLabel('Category')
    .setPlaceholder(loreManager.CATEGORIES.join(', '))
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const title = new TextInputBuilder()
    .setCustomId(IDS.TITLE_INPUT)
    .setLabel('Title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const content = new TextInputBuilder()
    .setCustomId(IDS.CONTENT_INPUT)
    .setLabel('Information')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(category),
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(content),
  );

  return modal;
}

function buildSearchModal() {
  const modal = new ModalBuilder().setCustomId(IDS.SEARCH_MODAL).setTitle('Search Lore');
  const query = new TextInputBuilder()
    .setCustomId(IDS.QUERY_INPUT)
    .setLabel('Search query')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(query));
  return modal;
}

// Same constraint as memoryPanel's edit modal: Discord can't chain a second
// modal off a modal submit, so this asks for the ID (from Search) plus
// whichever fields should change — blank fields keep their current value.
function buildEditModal() {
  const modal = new ModalBuilder().setCustomId(IDS.EDIT_MODAL).setTitle('Edit Lore');

  const loreId = new TextInputBuilder()
    .setCustomId(IDS.LORE_ID_INPUT)
    .setLabel('Lore ID (from Search)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const title = new TextInputBuilder()
    .setCustomId(IDS.TITLE_INPUT)
    .setLabel('New title (blank to keep)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const content = new TextInputBuilder()
    .setCustomId(IDS.CONTENT_INPUT)
    .setLabel('New information (blank to keep)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  const category = new TextInputBuilder()
    .setCustomId(IDS.CATEGORY_INPUT)
    .setLabel('New category (blank to keep)')
    .setPlaceholder(loreManager.CATEGORIES.join(', '))
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(loreId),
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(content),
    new ActionRowBuilder().addComponents(category),
  );

  return modal;
}

function buildRemoveModal() {
  const modal = new ModalBuilder().setCustomId(IDS.REMOVE_MODAL).setTitle('Remove Lore');
  const loreId = new TextInputBuilder()
    .setCustomId(IDS.LORE_ID_INPUT)
    .setLabel('Lore ID (from Search)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(loreId));
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
    case IDS.EDIT:
      await interaction.showModal(buildEditModal());
      return;
    case IDS.REMOVE:
      await interaction.showModal(buildRemoveModal());
      return;
    default:
  }
}

function formatLoreRow(row) {
  return `**#${row.id}** [${row.category}] **${row.title}** — ${row.content}`;
}

async function handleModalSubmit(interaction) {
  switch (interaction.customId) {
    case IDS.ADD_MODAL: {
      const categoryRaw = interaction.fields.getTextInputValue(IDS.CATEGORY_INPUT);
      const title = interaction.fields.getTextInputValue(IDS.TITLE_INPUT);
      const content = interaction.fields.getTextInputValue(IDS.CONTENT_INPUT);

      const category = categoryRaw.trim().toLowerCase();
      if (!loreManager.isValidCategory(category)) {
        await interaction.reply(ephemeral({ content: `Category must be one of: ${loreManager.CATEGORIES.join(', ')}.` }));
        return;
      }

      const id = await loreManager.addLore({ category, title, content, createdBy: interaction.user.id });
      await interaction.reply(ephemeral({ content: `Lore #${id} — "${title}" saved.` }));
      return;
    }

    case IDS.SEARCH_MODAL: {
      const query = interaction.fields.getTextInputValue(IDS.QUERY_INPUT);
      const results = await loreManager.searchLore(query, 10);

      if (results.length === 0) {
        await interaction.reply(ephemeral({ content: `No lore matches "${query}".` }));
        return;
      }

      const lines = results.map(formatLoreRow);
      await interaction.reply(ephemeral({ content: `**Results for "${query}":**\n${lines.join('\n')}` }));
      return;
    }

    case IDS.EDIT_MODAL: {
      const idRaw = interaction.fields.getTextInputValue(IDS.LORE_ID_INPUT);
      const id = Number.parseInt(idRaw, 10);
      if (!Number.isInteger(id)) {
        await interaction.reply(ephemeral({ content: 'That lore ID is not a number.' }));
        return;
      }

      const titleRaw = interaction.fields.getTextInputValue(IDS.TITLE_INPUT);
      const contentRaw = interaction.fields.getTextInputValue(IDS.CONTENT_INPUT);
      const categoryRaw = interaction.fields.getTextInputValue(IDS.CATEGORY_INPUT);

      const changes = {};
      if (titleRaw) changes.title = titleRaw;
      if (contentRaw) changes.content = contentRaw;
      if (categoryRaw) {
        const category = categoryRaw.trim().toLowerCase();
        if (!loreManager.isValidCategory(category)) {
          await interaction.reply(ephemeral({ content: `Category must be one of: ${loreManager.CATEGORIES.join(', ')}.` }));
          return;
        }
        changes.category = category;
      }

      if (Object.keys(changes).length === 0) {
        await interaction.reply(
          ephemeral({ content: 'Nothing to change — fill in at least one field, or leave all blank to cancel.' }),
        );
        return;
      }

      const updated = await loreManager.updateLore(id, changes, interaction.user.id);
      await interaction.reply(ephemeral({ content: updated ? `Lore #${id} updated.` : `No lore found with ID #${id}.` }));
      return;
    }

    case IDS.REMOVE_MODAL: {
      const idRaw = interaction.fields.getTextInputValue(IDS.LORE_ID_INPUT);
      const id = Number.parseInt(idRaw, 10);
      if (!Number.isInteger(id)) {
        await interaction.reply(ephemeral({ content: 'That lore ID is not a number.' }));
        return;
      }

      const removed = await loreManager.removeLore(id, interaction.user.id);
      await interaction.reply(ephemeral({ content: removed ? `Lore #${id} removed.` : `No lore found with ID #${id}.` }));
      return;
    }

    default:
  }
}

module.exports = { buildLorePanel, handleComponent, handleModalSubmit, IDS };
