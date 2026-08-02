const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const statusManager = require('../managers/statusManager');
const settingsManager = require('./settingsManager');
const personalityManager = require('../personality/personalityManager');
const moodManager = require('../mood/moodManager');
const memoryManager = require('../memory/memoryManager');
const loreManager = require('../lore/loreManager');
const playerManager = require('../memory/playerManager');
const { ephemeral } = require('../utils/discordReply');

const IDS = {
  ENABLE: 'wren_control_enable',
  DISABLE: 'wren_control_disable',
  PERSONALITY: 'wren_control_personality',
  SETTINGS: 'wren_control_settings',
  CLOSE: 'wren_control_close',
  BACK: 'wren_control_back',
  SETTINGS_MODAL: 'wren_control_settings_modal',
  COOLDOWN_INPUT: 'wren_control_cooldown_input',
  PREFIX_INPUT: 'wren_control_prefix_input',
  PERSONALITY_SET_PREFIX: 'wren_control_personality_set_',
  MOOD_SELECT: 'wren_control_mood_select',
};

async function buildControlPanel() {
  const enabled = statusManager.isEnabled();
  const settings = settingsManager.getSettings();
  const personality = personalityManager.getCurrent();
  const mood = moodManager.getCurrent();
  const [memoryCount, loreCount, linkedCount] = await Promise.all([
    memoryManager.getMemoryCount(),
    loreManager.getLoreCount(),
    playerManager.getLinkedPlayerCount(),
  ]);

  const embed = new EmbedBuilder()
    .setTitle(`${personality.emoji} Wren Control Center`)
    .setColor(enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Status', value: enabled ? '🟢 Online' : '🔴 Disabled', inline: true },
      { name: 'Personality', value: personality.name, inline: true },
      { name: 'Mood', value: `${mood.emoji} ${mood.label}`, inline: true },
      { name: 'AI Model', value: settings.model, inline: true },
      { name: 'Interaction Mode', value: statusManager.getInteractionMode(), inline: true },
      { name: 'Prefix', value: `\`${settings.prefix}\``, inline: true },
      { name: 'Cooldown', value: `${settings.cooldownSeconds}s`, inline: true },
      { name: 'Memories', value: String(memoryCount), inline: true },
      { name: 'Lore Entries', value: String(loreCount), inline: true },
      { name: 'Linked Players', value: String(linkedCount), inline: true },
    )
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.ENABLE)
      .setLabel('Enable Wren')
      .setStyle(ButtonStyle.Success)
      .setDisabled(enabled),
    new ButtonBuilder()
      .setCustomId(IDS.DISABLE)
      .setLabel('Disable Wren')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!enabled),
    new ButtonBuilder().setCustomId(IDS.PERSONALITY).setLabel('Personality').setEmoji('🎭').setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.SETTINGS).setLabel('Settings').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(IDS.CLOSE).setLabel('Close').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildPersonalityPanel() {
  const current = personalityManager.getCurrent();
  const mood = moodManager.getCurrent();

  const embed = new EmbedBuilder()
    .setTitle('🎭 Wren Personality')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Current', value: `${current.emoji} ${current.name}`, inline: true },
      { name: 'Current Mood', value: `${mood.emoji} ${mood.label}`, inline: true },
    )
    .setFooter({ text: 'Wren Control Panel · Admin Only' });

  const profileButtons = personalityManager.list().map((profile) =>
    new ButtonBuilder()
      .setCustomId(`${IDS.PERSONALITY_SET_PREFIX}${profile.key}`)
      .setLabel(profile.name.replace(/ Wren$/, ''))
      .setEmoji(profile.emoji)
      .setStyle(profile.key === current.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(profile.key === current.key),
  );

  const moodSelect = new StringSelectMenuBuilder()
    .setCustomId(IDS.MOOD_SELECT)
    .setPlaceholder('Change mood...')
    .addOptions(
      moodManager.list().map((m) => ({
        label: m.label,
        value: m.key,
        emoji: m.emoji,
        default: m.key === mood.key,
      })),
    );

  const backButton = new ButtonBuilder().setCustomId(IDS.BACK).setLabel('◀ Back').setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(...profileButtons),
      new ActionRowBuilder().addComponents(moodSelect),
      new ActionRowBuilder().addComponents(backButton),
    ],
  };
}

function buildSettingsModal() {
  const settings = settingsManager.getSettings();
  const modal = new ModalBuilder().setCustomId(IDS.SETTINGS_MODAL).setTitle('Wren Settings');

  const cooldownInput = new TextInputBuilder()
    .setCustomId(IDS.COOLDOWN_INPUT)
    .setLabel('Cooldown (seconds)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(settings.cooldownSeconds))
    .setRequired(true);

  const prefixInput = new TextInputBuilder()
    .setCustomId(IDS.PREFIX_INPUT)
    .setLabel('Prefix command')
    .setStyle(TextInputStyle.Short)
    .setValue(settings.prefix)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(cooldownInput),
    new ActionRowBuilder().addComponents(prefixInput),
  );

  return modal;
}

async function handleComponent(interaction) {
  const { customId } = interaction;

  if (customId.startsWith(IDS.PERSONALITY_SET_PREFIX)) {
    const key = customId.slice(IDS.PERSONALITY_SET_PREFIX.length);
    try {
      personalityManager.setActive(key, interaction.user.id);
    } catch (err) {
      await interaction.reply(ephemeral({ content: err.message }));
      return;
    }
    await interaction.update(buildPersonalityPanel());
    return;
  }

  switch (customId) {
    case IDS.ENABLE:
      statusManager.enable(interaction.user.id);
      await interaction.update(await buildControlPanel());
      return;
    case IDS.DISABLE:
      statusManager.disable(interaction.user.id);
      await interaction.update(await buildControlPanel());
      return;
    case IDS.PERSONALITY:
      await interaction.update(buildPersonalityPanel());
      return;
    case IDS.BACK:
      await interaction.update(await buildControlPanel());
      return;
    case IDS.SETTINGS:
      await interaction.showModal(buildSettingsModal());
      return;
    case IDS.CLOSE:
      await interaction.update({ content: 'Control panel closed.', embeds: [], components: [] });
      return;
    default:
  }
}

async function handleSelectMenu(interaction) {
  if (interaction.customId !== IDS.MOOD_SELECT) return;

  const [selected] = interaction.values;
  try {
    moodManager.setMood(selected, interaction.user.id);
  } catch (err) {
    await interaction.reply(ephemeral({ content: err.message }));
    return;
  }

  await interaction.update(buildPersonalityPanel());
}

async function handleModalSubmit(interaction) {
  if (interaction.customId !== IDS.SETTINGS_MODAL) return;

  const cooldownRaw = interaction.fields.getTextInputValue(IDS.COOLDOWN_INPUT);
  const prefixRaw = interaction.fields.getTextInputValue(IDS.PREFIX_INPUT);

  const result = settingsManager.updateSettings(
    {
      cooldownSeconds: Number.parseInt(cooldownRaw, 10),
      prefix: prefixRaw,
    },
    interaction.user.id,
  );

  if (!result.ok) {
    await interaction.reply(ephemeral({ content: result.errors.join(' ') }));
    return;
  }

  if (interaction.isFromMessage()) {
    await interaction.update(await buildControlPanel());
  } else {
    await interaction.reply(ephemeral(await buildControlPanel()));
  }
}

module.exports = {
  buildControlPanel,
  buildPersonalityPanel,
  buildSettingsModal,
  handleComponent,
  handleSelectMenu,
  handleModalSubmit,
  IDS,
};
