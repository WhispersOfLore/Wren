const config = require('../config/configManager');
const permissionManager = require('../control/permissionManager');
const { ephemeral } = require('./discordReply');

/**
 * Shared admin-ops gate for project-awareness/handoff commands (Phase 17,
 * Part G — CRITICAL). These commands expose internal project state,
 * handoff drafting, repository information, and persistence-plan
 * previews, none of which are appropriate for an ordinary community
 * member in the new Whisper About It / Unfiltered Talk Radio guild.
 *
 * Before Phase 17, these commands were gated only by an optional channel
 * restriction (`config.discord.channelId`), which any member of that one
 * channel could use — not an identity-based authorization boundary. This
 * closes that gap: admin permission (`permissionManager.isAdmin`) is now
 * required, with the channel restriction (if configured) applied as an
 * ADDITIONAL, not alternative, layer.
 *
 * This does NOT weaken handoff-approve/handoff-reject/handoff-plan's own
 * internal requester-or-admin authorization (see handoffApproval.js) —
 * that logic is untouched. Gating draft *creation* to admins only means
 * every legitimate requester is already an admin by construction, so the
 * existing internal logic and this command-level gate are consistent,
 * not contradictory.
 *
 * @returns {Promise<boolean>} true if denied (and already replied to) —
 *   callers should `if (await denyUnlessAdminOps(interaction)) return;`
 */
async function denyUnlessAdminOps(interaction) {
  if (!permissionManager.isAdmin(interaction.member)) {
    await interaction.reply(ephemeral({ content: "This isn't for you, sugar. Admins only." }));
    return true;
  }
  if (config.discord.channelId && interaction.channelId !== config.discord.channelId) {
    await interaction.reply(ephemeral({ content: `I only hold court in <#${config.discord.channelId}>, sugar.` }));
    return true;
  }
  return false;
}

module.exports = { denyUnlessAdminOps };
