const config = require('../config/configManager');
const permissionManager = require('../control/permissionManager');
const { sharedStore: approvalStore } = require('../services/handoffApproval');
const { buildPersistencePlan, formatPersistencePlanForDisplay } = require('../services/handoffPersistencePlan');
const { sendChunkedReply } = require('../utils/chunkedReply');
const { ephemeral } = require('../utils/discordReply');

/**
 * Human approval/rejection/dry-run planning of a handoff draft (Phase 13
 * approve/reject; Phase 14 handoff-plan). None of this ever writes a
 * file, calls create-handoff.py, edits index.json, or touches git --
 * approving only flips an in-memory status, and the plan command only
 * builds and displays an object. Natural-language phrases like "looks
 * good" or "approved" typed in chat are never routed here; only these
 * explicit slash subcommands can change a draft's status.
 */

function denialMessage(reason, session) {
  switch (reason) {
    case 'unknown_draft':
      return "I don't see a draft with that ID, sugar. It may be mistyped, or it's already been cleaned up.";
    case 'not_authorized':
      return "That's not your draft, sugar. Only the person who asked for it (or a Wren admin) can act on it.";
    case 'status_approved':
      return `Draft ${session.draftId} was already approved${session.approvedBy ? ` by <@${session.approvedBy}>` : ''}.`;
    case 'status_rejected':
      return `Draft ${session.draftId} was already rejected. Ask me to draft it again if you want another pass.`;
    case 'status_expired':
      return `Draft ${session.draftId} has expired. Ask me to draft it again, sugar.`;
    case 'status_superseded':
      return `Draft ${session.draftId} was replaced by a newer draft for that project. Act on the newer one instead.`;
    case 'status_stale':
    case 'stale':
      return `Draft ${session.draftId} is stale -- the project's repository state changed since it was last checked. Ask me to draft it again, sugar.`;
    case 'status_pending':
      return `Draft ${session.draftId} hasn't been approved yet, sugar -- approve it first with /wren handoff-approve.`;
    default:
      return "I couldn't act on that draft, sugar.";
  }
}

async function handleHandoffApprove(interaction) {
  if (interaction.channelId !== config.discord.channelId) {
    await interaction.reply(ephemeral({ content: `I only hold court in <#${config.discord.channelId}>, sugar.` }));
    return;
  }

  const draftId = interaction.options.getString('draft-id', true).trim();
  const result = approvalStore.approve({
    draftId,
    actorUserId: interaction.user.id,
    isAdmin: permissionManager.isAdmin(interaction.member),
  });

  if (!result.ok) {
    await interaction.reply(ephemeral({ content: denialMessage(result.reason, result.session) }));
    return;
  }

  await interaction.reply(
    ephemeral({
      content:
        `Draft ${result.session.draftId} approved for future persistence.\n` +
        'Approval does not persist this handoff -- nothing was written to any file, handoff, or index.',
    }),
  );
}

async function handleHandoffReject(interaction) {
  if (interaction.channelId !== config.discord.channelId) {
    await interaction.reply(ephemeral({ content: `I only hold court in <#${config.discord.channelId}>, sugar.` }));
    return;
  }

  const draftId = interaction.options.getString('draft-id', true).trim();
  const result = approvalStore.reject({
    draftId,
    actorUserId: interaction.user.id,
    isAdmin: permissionManager.isAdmin(interaction.member),
  });

  if (!result.ok) {
    await interaction.reply(ephemeral({ content: denialMessage(result.reason, result.session) }));
    return;
  }

  await interaction.reply(
    ephemeral({
      content: `Draft ${result.session.draftId} rejected. This is final for that draft -- ask me to draft it again if you want a new one.`,
    }),
  );
}

async function handleHandoffPlan(interaction) {
  if (interaction.channelId !== config.discord.channelId) {
    await interaction.reply(ephemeral({ content: `I only hold court in <#${config.discord.channelId}>, sugar.` }));
    return;
  }

  await interaction.deferReply();

  const draftId = interaction.options.getString('draft-id', true).trim();
  const result = approvalStore.beginPersistencePlan({
    draftId,
    actorUserId: interaction.user.id,
    isAdmin: permissionManager.isAdmin(interaction.member),
  });

  if (!result.ok) {
    await sendChunkedReply(interaction, denialMessage(result.reason, result.session));
    return;
  }

  const plan = buildPersistencePlan(result.session);
  await sendChunkedReply(interaction, formatPersistencePlanForDisplay(plan));
}

module.exports = { handleHandoffApprove, handleHandoffReject, handleHandoffPlan };
