const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const memoryManager = require('../memory/memoryManager');
const playerManager = require('../memory/playerManager');
// Read-only reuse of the same tokenizer memoryManager.searchMemories()
// already uses internally — lets Search Memory tell "no usable keywords"
// apart from "no matches" without touching searchUtils.js or duplicating
// its stopword/length rules here.
const { tokenize } = require('../memory/searchUtils');
const { ephemeral } = require('../utils/discordReply');

const IDS = {
  ADD: 'wren_memory_add',
  SEARCH: 'wren_memory_search',
  VIEW: 'wren_memory_view',
  EDIT: 'wren_memory_edit',
  REMOVE: 'wren_memory_remove',
  // Add Memory flow — Discord modals can't contain select menus, so the
  // member/category/importance pickers each have to be their own step
  // before the final modal (content only). State (the choices made so far)
  // travels between steps encoded in each component's customId rather than
  // in a server-side session store — stateless, survives a restart between
  // steps, and needs no new shared state module. See ENCODE_SEP below.
  ADD_USER_SELECT: 'wren_memory_add_user_select',
  ADD_CATEGORY_SELECT: 'wren_memory_add_category_select',
  ADD_IMPORTANCE_SELECT: 'wren_memory_add_importance_select',
  ADD_MODAL: 'wren_memory_add_modal',
  // View Player Memories: member select only, no modal (nothing left to
  // enter once a member's picked — the search-vs-duplicate tradeoff of
  // going further was flagged and intentionally left alone, see
  // handleComponent's SEARCH case).
  VIEW_USER_SELECT: 'wren_memory_view_user_select',
  // Edit Memory: member select, then a select of *that member's* memories
  // (reusing memoryManager.getMemoriesForUser, unchanged), then the same
  // content/importance/category modal as before minus the memory-ID field
  // (now known from the selection instead of typed in).
  EDIT_USER_SELECT: 'wren_memory_edit_user_select',
  EDIT_MEMORY_SELECT: 'wren_memory_edit_memory_select',
  // Remove Memory: same member -> memory-list shape as Edit (reuses the
  // same builders), ending in a confirmation button instead of a modal —
  // deletion is permanent, so it gets an explicit are-you-sure step rather
  // than committing straight from the select menu.
  REMOVE_USER_SELECT: 'wren_memory_remove_user_select',
  REMOVE_MEMORY_SELECT: 'wren_memory_remove_memory_select',
  REMOVE_CONFIRM: 'wren_memory_remove_confirm',
  // Generic "return to the main panel" button, reused by every flow below
  // (renamed from the Add-only ADD_CANCEL now that Search/View/Edit/Remove
  // all share it) — same naming convention as controlPanel.js's IDS.BACK.
  BACK: 'wren_memory_back',
  SEARCH_MODAL: 'wren_memory_search_modal',
  EDIT_MODAL: 'wren_memory_edit_modal',
  CONTENT_INPUT: 'wren_memory_content_input',
  IMPORTANCE_INPUT: 'wren_memory_importance_input',
  CATEGORY_INPUT: 'wren_memory_category_input',
  QUERY_INPUT: 'wren_memory_query_input',
};

// Discord IDs are numeric, categories are lowercase words, importance is a
// single digit — none can contain this separator, so a plain split is safe.
const ENCODE_SEP = '|';

const CATEGORY_EMOJI = {
  personal: '👤',
  achievement: '🏆',
  relationship: '💞',
  event: '📅',
  server: '🏰',
};

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function truncate(text, maxLen) {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

/**
 * Renders a SQLite `datetime('now')` string ('YYYY-MM-DD HH:MM:SS', UTC, no
 * timezone suffix) as Discord's native timestamp markup, so it displays in
 * whichever timezone/format the viewer's own client is set to.
 */
function formatTimestamp(sqlDateString) {
  if (!sqlDateString) return 'Unknown';
  const date = new Date(`${sqlDateString.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return sqlDateString;
  return `<t:${Math.floor(date.getTime() / 1000)}:d>`;
}

/** Who a memory concerns, falling back the same way existing code already did. */
function subjectLabel(row) {
  return row.display_name || row.minecraft_username || `<@${row.discord_id}>`;
}

/** Prefers the cached guild member (nickname-aware) over a raw API fetch. */
async function resolveDisplayName(interaction, discordId) {
  const cached = interaction.guild?.members.cache.get(discordId);
  if (cached) return cached.displayName;
  const fetched = await interaction.guild?.members.fetch(discordId).catch(() => null);
  return fetched?.displayName ?? `<@${discordId}>`;
}

/**
 * Shared by View, Edit, and Remove's first select-menu step: resolve the
 * chosen member's display name and their memory list together, in parallel.
 */
async function fetchMemberAndMemories(interaction, discordId) {
  const [displayName, results] = await Promise.all([
    resolveDisplayName(interaction, discordId),
    memoryManager.getMemoriesForUser(discordId),
  ]);
  return { displayName, results };
}

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

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.BACK).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Shared first step for every flow that needs to identify a member —
 * Add Memory, View Player Memories, and Edit Memory all start here rather
 * than each building their own copy of the same User Select Menu screen.
 */
function buildUserSelectScreen({ customId, title, description }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865f2)
    .setDescription(description)
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const select = new UserSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a server member...')
    .setMinValues(1)
    .setMaxValues(1);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), backRow()] };
}

function buildAddCategorySelectScreen(discordId, displayName) {
  const embed = new EmbedBuilder()
    .setTitle('🧠 Add Memory — Step 2 of 3')
    .setColor(0x5865f2)
    .setDescription(`Memory for **${displayName}**. What category does this belong to?`)
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${IDS.ADD_CATEGORY_SELECT}${ENCODE_SEP}${discordId}`)
    .setPlaceholder('Select a category...')
    .addOptions(
      memoryManager.CATEGORIES.map((cat) => ({
        label: capitalize(cat),
        value: cat,
        emoji: CATEGORY_EMOJI[cat],
        // memoryManager doesn't export its DEFAULT_CATEGORY constant, and
        // this change deliberately avoids touching memoryManager.js —
        // CATEGORIES[0] ('personal') matches it today; harmless if it
        // doesn't (just no option is pre-highlighted).
        default: cat === memoryManager.CATEGORIES[0],
      })),
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), backRow()] };
}

function buildAddImportanceSelectScreen(discordId, displayName, category) {
  const embed = new EmbedBuilder()
    .setTitle('🧠 Add Memory — Step 3 of 3')
    .setColor(0x5865f2)
    .setDescription(
      `Memory for **${displayName}** — Category: **${capitalize(category)}**. How important is this?`,
    )
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${IDS.ADD_IMPORTANCE_SELECT}${ENCODE_SEP}${discordId}${ENCODE_SEP}${category}`)
    .setPlaceholder('Select importance...')
    .addOptions(
      [1, 2, 3, 4, 5].map((n) => ({
        label: `${'⭐'.repeat(n)} ${n} — ${capitalize(memoryManager.IMPORTANCE_LABELS[n])}`,
        value: String(n),
        default: n === 3,
      })),
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), backRow()] };
}

function buildAddContentModal(discordId, category, importance) {
  const modal = new ModalBuilder()
    .setCustomId(`${IDS.ADD_MODAL}${ENCODE_SEP}${discordId}${ENCODE_SEP}${category}${ENCODE_SEP}${importance}`)
    .setTitle('Add Memory');

  const content = new TextInputBuilder()
    .setCustomId(IDS.CONTENT_INPUT)
    .setLabel('Memory')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(content));
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

/**
 * Second step of both Edit Memory and Remove Memory — a member's been
 * picked, now pick *which* of their memories to act on. Shared by both
 * flows rather than each building its own copy of the same picker.
 * memoryManager.getMemoriesForUser()'s default limit is 25, which happens
 * to be exactly Discord's max select-menu options, so no separate
 * capping/pagination logic is needed here.
 */
function buildMemorySelectScreen({ customId, title, description, memories }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865f2)
    .setDescription(description)
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a memory...')
    .addOptions(
      memories.map((row) => ({
        label: truncate(row.content, 90),
        value: String(row.id),
        description: `#${row.id} · ${capitalize(row.category)} · ${capitalize(memoryManager.IMPORTANCE_LABELS[row.importance])}`,
        emoji: CATEGORY_EMOJI[row.category],
      })),
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), backRow()] };
}

function buildEditMemorySelectScreen(discordId, displayName, memories) {
  return buildMemorySelectScreen({
    customId: `${IDS.EDIT_MEMORY_SELECT}${ENCODE_SEP}${discordId}`,
    title: '✏️ Edit Memory — Step 2 of 2',
    description: `Which memory of **${displayName}**'s do you want to edit?`,
    memories,
  });
}

function buildRemoveMemorySelectScreen(discordId, displayName, memories) {
  return buildMemorySelectScreen({
    customId: `${IDS.REMOVE_MEMORY_SELECT}${ENCODE_SEP}${discordId}`,
    title: '🗑 Remove Memory — Step 2 of 2',
    description: `Which memory of **${displayName}**'s do you want to remove?`,
    memories,
  });
}

/** Final step of Remove Memory — an explicit are-you-sure, since deletion is permanent. */
function buildRemoveConfirmScreen(memory, displayName) {
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Delete Memory?')
    .setColor(0xed4245)
    .addFields(
      { name: 'Member', value: displayName, inline: true },
      { name: 'Category', value: capitalize(memory.category), inline: true },
      { name: 'Importance', value: '⭐'.repeat(memory.importance), inline: true },
      { name: 'Memory', value: truncate(memory.content, 1000) },
    )
    .setFooter({ text: 'Wren Control Panel · Admin Only — this cannot be undone.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.REMOVE_CONFIRM}${ENCODE_SEP}${memory.id}`)
      .setLabel('Confirm Delete')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(IDS.BACK).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

// Discord can't show a modal in response to a modal submit — but this modal
// is now reached via a select menu instead (the memory picker above), so
// that limitation doesn't apply here. The memory's ID is already known from
// that selection, encoded into this modal's customId (see ENCODE_SEP), so
// unlike the old ID-typed-in-by-hand version, no MEMORY_ID_INPUT field is
// needed. Content/importance/category stay exactly as before: optional,
// blank keeps the current value — memoryManager.updateMemory()'s partial-
// update behavior is unchanged.
function buildEditModal(memoryId) {
  const modal = new ModalBuilder()
    .setCustomId(`${IDS.EDIT_MODAL}${ENCODE_SEP}${memoryId}`)
    .setTitle('Edit Memory');

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
    new ActionRowBuilder().addComponents(content),
    new ActionRowBuilder().addComponents(importance),
    new ActionRowBuilder().addComponents(category),
  );

  return modal;
}

async function handleComponent(interaction) {
  // Remove Memory's confirm button carries the memory ID chosen in the
  // member -> memory select steps before it (see ENCODE_SEP above), so
  // it's matched by prefix rather than the exact-match switch below.
  if (interaction.customId.startsWith(IDS.REMOVE_CONFIRM)) {
    const [, idRaw] = interaction.customId.split(ENCODE_SEP);
    const id = Number.parseInt(idRaw, 10);
    if (!Number.isInteger(id)) {
      await interaction.reply(ephemeral({ content: 'Something went wrong reading which memory this was, sugar — try again.' }));
      return;
    }

    const removed = await memoryManager.removeMemory(id, interaction.user.id);
    const embed = new EmbedBuilder()
      .setTitle('🗑 Wren Memory')
      .setColor(removed ? 0x57f287 : 0xed4245)
      .setDescription(removed ? `Memory #${id} removed.` : `No memory found with ID #${id} — it may already be gone.`)
      .setFooter({ text: 'Wren Control Panel · Admin Only' });

    await interaction.update({ embeds: [embed], components: [backRow()] });
    return;
  }

  switch (interaction.customId) {
    case IDS.ADD:
      await interaction.update(
        buildUserSelectScreen({
          customId: IDS.ADD_USER_SELECT,
          title: '🧠 Add Memory — Step 1 of 3',
          description: 'Who is this memory about?',
        }),
      );
      return;
    case IDS.BACK:
      await interaction.update(await buildMemoryPanel());
      return;
    case IDS.SEARCH:
      await interaction.showModal(buildSearchModal());
      return;
    case IDS.VIEW:
      await interaction.update(
        buildUserSelectScreen({
          customId: IDS.VIEW_USER_SELECT,
          title: '📋 View Player Memories',
          description: 'Select the member whose memories you want to see.',
        }),
      );
      return;
    case IDS.EDIT:
      await interaction.update(
        buildUserSelectScreen({
          customId: IDS.EDIT_USER_SELECT,
          title: '✏️ Edit Memory — Step 1 of 2',
          description: 'Select the member whose memory you want to edit.',
        }),
      );
      return;
    case IDS.REMOVE:
      await interaction.update(
        buildUserSelectScreen({
          customId: IDS.REMOVE_USER_SELECT,
          title: '🗑 Remove Memory — Step 1 of 2',
          description: 'Select the member whose memory you want to remove.',
        }),
      );
      return;
    default:
  }
}

/** Shared "this member has no memories yet" screen for View and Edit. */
function buildNoMemoriesScreen(displayName) {
  const embed = new EmbedBuilder()
    .setTitle('🧠 Wren Memory')
    .setColor(0x5865f2)
    .setDescription(`I don't have any memories of **${displayName}** yet.`)
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  return { embeds: [embed], components: [backRow()] };
}

/**
 * Handles every select-menu step across the Add, View, and Edit flows.
 * Each step's customId carries the choices made so far (see ENCODE_SEP
 * above) — the base id (before the first separator) says which step this is.
 */
async function handleSelectMenu(interaction) {
  const [base, ...parts] = interaction.customId.split(ENCODE_SEP);

  switch (base) {
    case IDS.ADD_USER_SELECT: {
      const discordId = interaction.values[0];
      const displayName = await resolveDisplayName(interaction, discordId);
      await interaction.update(buildAddCategorySelectScreen(discordId, displayName));
      return;
    }

    case IDS.ADD_CATEGORY_SELECT: {
      const [discordId] = parts;
      const category = interaction.values[0];
      const displayName = await resolveDisplayName(interaction, discordId);
      await interaction.update(buildAddImportanceSelectScreen(discordId, displayName, category));
      return;
    }

    case IDS.ADD_IMPORTANCE_SELECT: {
      const [discordId, category] = parts;
      const importance = interaction.values[0];
      await interaction.showModal(buildAddContentModal(discordId, category, importance));
      return;
    }

    case IDS.VIEW_USER_SELECT: {
      const discordId = interaction.values[0];
      const { displayName, results } = await fetchMemberAndMemories(interaction, discordId);

      if (results.length === 0) {
        await interaction.update(buildNoMemoriesScreen(displayName));
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📋 Wren Memory')
        .setColor(0x5865f2)
        .setDescription(`**Memories of ${displayName}:**\n${results.map(formatMemoryRow).join('\n')}`)
        .setFooter({ text: 'Wren Control Panel · Admin Only' });

      await interaction.update({ embeds: [embed], components: [backRow()] });
      return;
    }

    case IDS.EDIT_USER_SELECT: {
      const discordId = interaction.values[0];
      const { displayName, results } = await fetchMemberAndMemories(interaction, discordId);

      if (results.length === 0) {
        await interaction.update(buildNoMemoriesScreen(displayName));
        return;
      }

      await interaction.update(buildEditMemorySelectScreen(discordId, displayName, results));
      return;
    }

    case IDS.EDIT_MEMORY_SELECT: {
      const memoryId = interaction.values[0];
      await interaction.showModal(buildEditModal(memoryId));
      return;
    }

    case IDS.REMOVE_USER_SELECT: {
      const discordId = interaction.values[0];
      const { displayName, results } = await fetchMemberAndMemories(interaction, discordId);

      if (results.length === 0) {
        await interaction.update(buildNoMemoriesScreen(displayName));
        return;
      }

      await interaction.update(buildRemoveMemorySelectScreen(discordId, displayName, results));
      return;
    }

    case IDS.REMOVE_MEMORY_SELECT: {
      const [discordId] = parts;
      const memoryId = interaction.values[0];
      const memory = await memoryManager.getMemoryById(memoryId);
      if (!memory) {
        await interaction.reply(ephemeral({ content: `No memory found with ID #${memoryId} — it may already be gone.` }));
        return;
      }

      const displayName = await resolveDisplayName(interaction, discordId);
      await interaction.update(buildRemoveConfirmScreen(memory, displayName));
      return;
    }

    default:
  }
}

function formatMemoryRow(row) {
  const label = memoryManager.IMPORTANCE_LABELS[row.importance] || row.importance;
  return `**#${row.id}** [${row.category}/${label}] ${row.content}`;
}

const SEARCH_RESULT_LIMIT = 10;

/**
 * One embed field per result — Category/Importance/Memory/About/Created
 * by/Date, matching the requested layout. Presentation only: the rows
 * themselves come straight from the unmodified memoryManager.searchMemories().
 */
function buildSearchResultsEmbed(query, results) {
  const shown = results.slice(0, SEARCH_RESULT_LIMIT);
  const truncatedResultCount = results.length > SEARCH_RESULT_LIMIT;

  const embed = new EmbedBuilder()
    .setTitle('🔎 Memory Search Results')
    .setColor(0x5865f2)
    .setDescription(
      `**Query:** ${query}\n**${results.length === 1 ? '1 result' : `${shown.length}${truncatedResultCount ? '+' : ''} results`} found**` +
        (truncatedResultCount ? `\nShowing the top ${SEARCH_RESULT_LIMIT} — refine your search for more specific results.` : ''),
    )
    .addFields(
      shown.map((row) => ({
        name: `#${row.id}`,
        value: [
          `**Category:** ${capitalize(row.category)}`,
          `**Importance:** ${'⭐'.repeat(row.importance)}`,
          `**Memory:** ${truncate(row.content, 250)}`,
          `**About:** ${subjectLabel(row)}`,
          row.created_by ? `**Created by:** <@${row.created_by}>` : null,
          `**Date:** ${formatTimestamp(row.created_at)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      })),
    )
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  return { embeds: [embed], components: [backRow()] };
}

function buildSearchEmptyStateEmbed(title, description) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865f2)
    .setDescription(description)
    .setFooter({ text: 'Wren Control Panel · Admin Only' });
  return { embeds: [embed], components: [backRow()] };
}

async function handleModalSubmit(interaction) {
  // Add Memory's modal customId carries the member/category/importance
  // chosen in the three select-menu steps before it (see ENCODE_SEP above),
  // so it's matched by prefix rather than the exact-match switch below.
  if (interaction.customId.startsWith(IDS.ADD_MODAL)) {
    const [, discordId, category, importanceRaw] = interaction.customId.split(ENCODE_SEP);
    const content = interaction.fields.getTextInputValue(IDS.CONTENT_INPUT);

    const importance = Number.parseInt(importanceRaw, 10);
    if (!memoryManager.isValidImportance(importance)) {
      // Shouldn't happen — the importance step only offers 1-5 — but this
      // mirrors every other modal handler's defensive validation rather
      // than trusting a customId round-trip blindly.
      await interaction.reply(ephemeral({ content: 'Something went wrong reading the importance value, sugar — try again.' }));
      return;
    }

    const id = await memoryManager.addMemory({
      discordId,
      category: memoryManager.isValidCategory(category) ? category : undefined,
      content,
      importance,
      createdBy: interaction.user.id,
    });

    const displayName = await resolveDisplayName(interaction, discordId);
    await interaction.reply(
      ephemeral({ content: `Memory #${id} saved for **${displayName}** (${capitalize(category)}, ${importance}⭐).` }),
    );
    return;
  }

  // Edit Memory's modal customId carries the memory ID chosen in the
  // member -> memory select steps before it (see ENCODE_SEP above) — no
  // MEMORY_ID_INPUT field to read anymore.
  if (interaction.customId.startsWith(IDS.EDIT_MODAL)) {
    const [, idRaw] = interaction.customId.split(ENCODE_SEP);
    const id = Number.parseInt(idRaw, 10);
    if (!Number.isInteger(id)) {
      // Shouldn't happen — the memory picker only offers real IDs — but
      // matches every other handler's defensive validation.
      await interaction.reply(ephemeral({ content: 'Something went wrong reading which memory this was, sugar — try again.' }));
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

  switch (interaction.customId) {
    case IDS.SEARCH_MODAL: {
      const rawQuery = interaction.fields.getTextInputValue(IDS.QUERY_INPUT);
      const query = rawQuery.trim();

      // Invalid search #1: nothing but whitespace. Caught before hitting the
      // DB at all — memoryManager.searchMemories() is never called for this.
      if (query.length === 0) {
        await interaction.reply(
          ephemeral(buildSearchEmptyStateEmbed('🔎 Memory Search Results', 'Type something to search for, sugar.')),
        );
        return;
      }

      // Invalid search #2: tokenize() is the exact same keyword filter
      // memoryManager.searchMemories() applies internally (shared via
      // searchUtils, not duplicated) — if it drops every word (too short,
      // or common words like "the"/"a"), searchMemories would always
      // return zero rows. Saying so directly is clearer than a generic
      // "no results," and still doesn't touch retrieval logic itself.
      if (tokenize(query).length === 0) {
        await interaction.reply(
          ephemeral(
            buildSearchEmptyStateEmbed(
              '🔎 Memory Search Results',
              `**Query:** ${query}\nThat didn't leave anything to search on — very short or common words get skipped. Try a more specific word.`,
            ),
          ),
        );
        return;
      }

      // Unmodified memoryManager.searchMemories() call — one extra result
      // requested past the display cap purely so buildSearchResultsEmbed
      // can tell "exactly 10 matches" from "more than 10 exist," still
      // presentation-only (the retrieval query/ranking itself is untouched).
      const results = await memoryManager.searchMemories(query, SEARCH_RESULT_LIMIT + 1);

      if (results.length === 0) {
        await interaction.reply(
          ephemeral(buildSearchEmptyStateEmbed('🔎 Memory Search Results', `**Query:** ${query}\nNo memories match this search.`)),
        );
        return;
      }

      await interaction.reply(ephemeral(buildSearchResultsEmbed(query, results)));
      return;
    }

    default:
  }
}

module.exports = { buildMemoryPanel, handleComponent, handleSelectMenu, handleModalSubmit, IDS };
