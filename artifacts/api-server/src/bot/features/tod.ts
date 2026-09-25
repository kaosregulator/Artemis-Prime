/**
 * Truth or Dare — slash commands + button/modal handlers.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type User,
} from "discord.js";
import { getClan, isAdmin, isOfficer, getMember } from "../services/config";
import {
  getTodSettings,
  checkTodCooldown,
  ensureTodPlayer,
  selectPrompt,
  createChallenge,
  bindChallengeMessage,
  getActiveChallenge,
  completeChallenge,
  passChallenge,
  listTodLeaderboard,
  submitAnonymous,
  guessAnonymous,
  spinWheel,
  DIFFICULTY_EMOJI,
  TOD_TITLES,
  type TodContentItem,
} from "../services/todGame";
import {
  NS,
  parseId,
  todPick,
  todComplete,
  todPass,
  todReroll,
  todChallengePick,
  TOD_ANON_MODAL,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";
import { logger } from "../../lib/logger";

function mention(userId: string) {
  return `<@${userId}>`;
}

async function avatarUrl(guildId: string, user: User): Promise<string | undefined> {
  const member = await getMember(guildId, user.id);
  return (
    member?.robloxAvatarUrl ||
    user.displayAvatarURL({ size: 256, extension: "png" }) ||
    undefined
  );
}

function challengeComponents(challengeId: number, withReroll = true) {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(todComplete(challengeId))
      .setLabel("Complete")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(todPass(challengeId))
      .setLabel("Pass")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
  if (withReroll) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(todReroll(challengeId))
        .setLabel("New Challenge")
        .setEmoji("🎲")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return [row];
}

function pickTypeRow(prefix: "solo" | "chal", challengerId?: string, targetId?: string) {
  const idFor = (t: string) =>
    prefix === "solo"
      ? todPick(t)
      : todChallengePick(challengerId ?? "0", targetId ?? "0", t);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(idFor("truth"))
      .setLabel("Truth")
      .setEmoji("🧠")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(idFor("dare"))
      .setLabel("Dare")
      .setEmoji("🔥")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(idFor("random"))
      .setLabel("Random")
      .setEmoji("🎲")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function postChallengeCard(opts: {
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction;
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>;
  target: User;
  content: TodContentItem;
  kind: string;
  challengerId?: string | null;
  highStakes?: boolean;
}) {
  const channelId = opts.interaction.channelId;
  if (!channelId) throw new Error("No channel");
  const challenge = await createChallenge({
    clan: opts.clan,
    channelId,
    kind: opts.kind,
    targetId: opts.target.id,
    targetUsername: opts.target.username,
    challengerId: opts.challengerId,
    content: opts.content,
    highStakes: opts.highStakes,
  });

  const av = await avatarUrl(opts.clan.guildId, opts.target);
  const embed = new EmbedBuilder()
    .setColor(opts.content.type === "truth" ? 0x3498db : 0xe74c3c)
    .setAuthor({
      name: opts.target.displayName || opts.target.username,
      iconURL: av,
    })
    .setTitle(
      opts.content.type === "truth" ? "🧠 TRUTH" : "🔥 DARE"
    )
    .setDescription(
      [
        mention(opts.target.id),
        "",
        `**${opts.content.text}**`,
        "",
        `Category: **${opts.content.category}** · ${DIFFICULTY_EMOJI[opts.content.difficulty]} **${opts.content.difficulty}**`,
        opts.content.requiresProof ? "📸 **PROOF REQUIRED** — upload in this channel." : null,
        opts.highStakes ? "💰 **HIGH STAKES** — pass costs points." : null,
        `Reward: 💰 **+${challenge.rewardPoints.toLocaleString("en-US")}** clan points`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setFooter({ text: `Challenge #${challenge.id} · expires in channel timeout` })
    .setTimestamp();

  const payload = {
    content: mention(opts.target.id),
    embeds: [embed],
    components: challengeComponents(challenge.id),
    allowedMentions: { users: [opts.target.id] },
  };

  if (opts.interaction.deferred || opts.interaction.replied) {
    const msg = await opts.interaction.editReply(payload);
    await bindChallengeMessage(challenge.id, msg.id);
  } else {
    const msg = await opts.interaction.reply({ ...payload, fetchReply: true });
    await bindChallengeMessage(challenge.id, msg.id);
  }
}

export async function handleTodCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "Guild only.", flags: 64 });
    return;
  }
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  const settings = getTodSettings(clan);
  if (!settings.enabled) {
    await interaction.reply({ content: "Truth or Dare is disabled on this server.", flags: 64 });
    return;
  }

  const name = interaction.commandName;
  let sub = "";
  try {
    sub = interaction.options.getSubcommand(false) ?? "";
  } catch {
    sub = "";
  }

  // Top-level aliases
  if (name === "truth") return void (await startTyped(interaction, clan, "truth"));
  if (name === "dare") return void (await startTyped(interaction, clan, "dare"));
  if (name === "spin") return void (await runSpin(interaction, clan));
  if (name === "challenge") return void (await runChallengeInvite(interaction, clan));
  if (name === "truthordare") return void (await startTyped(interaction, clan, "random"));

  if (name !== "tod") {
    await interaction.reply({ content: "Unknown command.", flags: 64 });
    return;
  }

  if (sub === "truth") return void (await startTyped(interaction, clan, "truth"));
  if (sub === "dare") return void (await startTyped(interaction, clan, "dare"));
  if (sub === "random" || sub === "play") return void (await startTyped(interaction, clan, "random"));
  if (sub === "spin") return void (await runSpin(interaction, clan));
  if (sub === "challenge") return void (await runChallengeInvite(interaction, clan));
  if (sub === "profile") return void (await runProfile(interaction, clan));
  if (sub === "leaderboard") return void (await runLeaderboard(interaction, clan));
  if (sub === "anonymous") return void (await openAnonymousModal(interaction, clan));
  if (sub === "guess") return void (await runGuess(interaction, clan));
  if (sub === "stats") return void (await runStats(interaction, clan));
  if (sub === "settings") return void (await runSettings(interaction, clan));

  // Default: show pick menu
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🎭 TRUTH OR DARE")
        .setDescription(
          `${mention(interaction.user.id)} has been selected!\n\nChoose your challenge:`
        ),
    ],
    components: [pickTypeRow("solo")],
  });
}

async function startTyped(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>,
  type: "truth" | "dare" | "random"
) {
  const settings = getTodSettings(clan);
  const cd = checkTodCooldown(clan.guildId, interaction.user.id, settings.cooldownSeconds);
  if (!cd.ok) {
    await interaction.reply({
      content: `⏱️ Slow down — try again in **${cd.retryIn}s**.`,
      flags: 64,
    });
    return;
  }
  await interaction.deferReply();
  const content = await selectPrompt({
    guildId: clan.guildId,
    type: type === "random" ? undefined : type,
    allowIrl: settings.irlMode,
  });
  if (!content) {
    await interaction.editReply({ content: "No prompts available." });
    return;
  }
  await postChallengeCard({
    interaction,
    clan,
    target: interaction.user,
    content,
    kind: type === "random" ? "random" : type,
  });
}

async function runSpin(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  const settings = getTodSettings(clan);
  const cd = checkTodCooldown(clan.guildId, interaction.user.id, settings.cooldownSeconds);
  if (!cd.ok) {
    await interaction.reply({
      content: `⏱️ Try again in **${cd.retryIn}s**.`,
      flags: 64,
    });
    return;
  }
  await interaction.deferReply();
  const outcome = spinWheel();
  let type: "truth" | "dare" | undefined;
  let difficulty: TodContentItem["difficulty"] | undefined;
  let highStakes = false;
  if (outcome.key === "truth") type = "truth";
  else if (outcome.key === "dare" || outcome.key === "double_dare") type = "dare";
  else if (outcome.key === "extreme") {
    type = "dare";
    difficulty = "extreme";
  } else if (outcome.key === "jackpot") {
    type = Math.random() < 0.5 ? "truth" : "dare";
    highStakes = settings.highStakes;
  } else if (outcome.key === "mystery") {
    type = undefined;
  } else if (outcome.key === "pick_someone") {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`${outcome.emoji} SPIN · Pick Someone`)
          .setDescription(
            `${mention(interaction.user.id)} — tag someone with \`/challenge @user\`!`
          ),
      ],
    });
    return;
  }

  const content = await selectPrompt({
    guildId: clan.guildId,
    type,
    difficulty,
    allowIrl: settings.irlMode,
  });
  if (!content) {
    await interaction.editReply({
      content: `${outcome.emoji} **${outcome.label}** — but no prompt found.`,
    });
    return;
  }
  // Fold spin banner into the challenge card via kind metadata
  await postChallengeCard({
    interaction,
    clan,
    target: interaction.user,
    content,
    kind: `spin:${outcome.key}`,
    highStakes,
  });
}

async function runChallengeInvite(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  const target = interaction.options.getUser("user", true);
  if (target.bot) {
    await interaction.reply({ content: "You can't challenge a bot.", flags: 64 });
    return;
  }
  if (target.id === interaction.user.id) {
    await interaction.reply({ content: "Challenge someone else!", flags: 64 });
    return;
  }
  await ensureTodPlayer({
    guildId: clan.guildId,
    userId: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.user.displayName,
  });

  const passRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(todChallengePick(interaction.user.id, target.id, "truth"))
      .setLabel("Truth")
      .setEmoji("🧠")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(todChallengePick(interaction.user.id, target.id, "dare"))
      .setLabel("Dare")
      .setEmoji("🔥")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(todChallengePick(interaction.user.id, target.id, "random"))
      .setLabel("Random")
      .setEmoji("🎲")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(todChallengePick(interaction.user.id, target.id, "pass"))
      .setLabel("Pass")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: mention(target.id),
    embeds: [
      new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle("⚔️ CHALLENGE!")
        .setDescription(
          `${mention(interaction.user.id)} has challenged ${mention(target.id)}.\n\n` +
            `${mention(target.id)} must choose:`
        ),
    ],
    components: [passRow],
    allowedMentions: { users: [target.id, interaction.user.id] },
  });
}

async function runProfile(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  const user = interaction.options.getUser("user") ?? interaction.user;
  await interaction.deferReply();
  const member = interaction.guild
    ? await interaction.guild.members.fetch(user.id).catch(() => null)
    : null;
  const player = await ensureTodPlayer({
    guildId: clan.guildId,
    userId: user.id,
    username: user.username,
    displayName: member?.displayName ?? user.displayName,
  });
  const title = player.titleKey
    ? TOD_TITLES[player.titleKey]?.label ?? player.titleKey
    : "Newcomer";
  const av = await avatarUrl(clan.guildId, user);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x9b59b6)
        .setAuthor({ name: player.displayName, iconURL: av })
        .setTitle("🎭 TRUTH OR DARE PROFILE")
        .setDescription(
          [
            `🎖️ Title: **${title}**`,
            "",
            `🔥 Current streak: **${player.currentStreak}**`,
            `🏆 Best streak: **${player.bestStreak}**`,
            `📅 Daily streak: **${player.dailyStreak}**`,
            "",
            `🧠 Truths: **${player.truthsCompleted}**`,
            `🔥 Dares: **${player.daresCompleted}**`,
            "",
            `⚔️ Challenges: **${player.wins}** wins · **${player.losses}** losses`,
            `❌ Passed: **${player.challengesPassed}**`,
            "",
            `💰 Earned: **${player.todPoints.toLocaleString("en-US")}** (also clan points when rewards on)`,
          ].join("\n")
        ),
    ],
  });
}

async function runLeaderboard(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  await interaction.deferReply();
  const sort =
    (interaction.options.getString("sort") as
      | "completed"
      | "dares"
      | "truths"
      | "streak"
      | "points"
      | "wins"
      | null) ?? "completed";
  const rows = await listTodLeaderboard(clan.guildId, sort, 10);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.length
    ? rows.map((r, i) => {
        const medal = medals[i] ?? `\`#${i + 1}\``;
        const score =
          sort === "dares"
            ? r.daresCompleted
            : sort === "truths"
              ? r.truthsCompleted
              : sort === "streak"
                ? r.bestStreak
                : sort === "points"
                  ? r.todPoints
                  : sort === "wins"
                    ? r.wins
                    : r.challengesCompleted;
        return `${medal} <@${r.userId}> — **${score}**`;
      })
    : ["_No players yet — start with `/tod`!_"];

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("🏆 TRUTH OR DARE LEADERBOARD")
        .setDescription(lines.join("\n"))
        .setFooter({ text: `Sorted by ${sort}` }),
    ],
  });
}

async function openAnonymousModal(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  const settings = getTodSettings(clan);
  if (!settings.anonymous) {
    await interaction.reply({ content: "Anonymous truths are disabled.", flags: 64 });
    return;
  }
  const modal = new ModalBuilder().setCustomId(TOD_ANON_MODAL).setTitle("Anonymous Truth");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("body")
        .setLabel("Your anonymous truth")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(400)
        .setPlaceholder("Keep it fun — no private/sensitive info.")
    )
  );
  await interaction.showModal(modal);
}

async function runGuess(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  const id = interaction.options.getInteger("id", true);
  const user = interaction.options.getUser("user", true);
  await interaction.deferReply({ flags: 64 });
  const res = await guessAnonymous({
    guildId: clan.guildId,
    anonymousId: id,
    guessUserId: user.id,
  });
  if ("error" in res) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }
  await interaction.editReply({
    content: res.correct ? "✅ Correct guess!" : "❌ Not that person.",
  });
}

async function runStats(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  await interaction.deferReply();
  const rows = await listTodLeaderboard(clan.guildId, "completed", 100);
  const truths = rows.reduce((s, r) => s + r.truthsCompleted, 0);
  const dares = rows.reduce((s, r) => s + r.daresCompleted, 0);
  const passes = rows.reduce((s, r) => s + r.challengesPassed, 0);
  const points = rows.reduce((s, r) => s + r.todPoints, 0);
  const total = truths + dares;
  const rate = total + passes > 0 ? Math.round((total / (total + passes)) * 100) : 0;

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("📊 TRUTH OR DARE STATS")
        .setDescription(
          [
            `Players: **${rows.length}**`,
            `Truths completed: **${truths}**`,
            `Dares completed: **${dares}**`,
            `Passes: **${passes}**`,
            `Completion rate: **${rate}%**`,
            `Clan points awarded via ToD: **${points.toLocaleString("en-US")}**`,
          ].join("\n")
        ),
    ],
  });
}

async function runSettings(
  interaction: ChatInputCommandInteraction,
  clan: NonNullable<Awaited<ReturnType<typeof getClan>>>
) {
  if (!interaction.inCachedGuild() || !isAdmin(interaction.member, clan)) {
    await interaction.reply({ content: "Admins only.", flags: 64 });
    return;
  }
  const s = getTodSettings(clan);
  await interaction.reply({
    flags: 64,
    embeds: [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle("⚙️ Truth or Dare Settings")
        .setDescription(
          [
            `Enabled: **${s.enabled ? "yes" : "no"}** (clan.todEnabled)`,
            `Economy rewards → clan points: **${s.economyRewards ? "on" : "off"}**`,
            `High stakes: **${s.highStakes ? "on" : "off"}** (default off)`,
            `IRL mode: **${s.irlMode ? "on" : "off"}**`,
            `Anonymous: **${s.anonymous ? "on" : "off"}**`,
            `Cooldown: **${s.cooldownSeconds}s**`,
            `Challenge timeout: **${s.challengeTimeoutMinutes}m**`,
            "",
            "_Override via clans.tod_settings_json — no second currency; uses clan points._",
          ].join("\n")
        ),
    ],
  });
}

export async function handleTodButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { ns, action, arg } = parseId(interaction.customId);
  if (ns !== NS.tod) return;

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  const settings = getTodSettings(clan);
  if (!settings.enabled) {
    await interaction.reply({ content: "Truth or Dare is disabled.", flags: 64 });
    return;
  }

  if (action === "pick") {
    const type = (arg ?? "random") as "truth" | "dare" | "random";
    await interaction.deferUpdate();
    const content = await selectPrompt({
      guildId: clan.guildId,
      type: type === "random" ? undefined : type,
      allowIrl: settings.irlMode,
    });
    if (!content) {
      await interaction.followUp({ content: "No prompts available.", flags: 64 });
      return;
    }
    await postChallengeCard({
      interaction,
      clan,
      target: interaction.user,
      content,
      kind: type,
    });
    return;
  }

  if (action === "chalPick") {
    // arg = challengerId_targetId_choice
    const parts = String(arg ?? "").split("_");
    const choice = parts.pop() ?? "random";
    const targetId = parts.pop() ?? "";
    const challengerId = parts.join("_");

    if (interaction.user.id !== targetId) {
      await interaction.reply({
        content: "Only the challenged player can choose.",
        flags: 64,
      });
      return;
    }
    if (choice === "pass") {
      await interaction.update({
        content: `${mention(targetId)} passed on the challenge from ${mention(challengerId)}.`,
        embeds: [],
        components: [],
      });
      return;
    }
    await interaction.deferUpdate();
    const content = await selectPrompt({
      guildId: clan.guildId,
      type: choice === "random" ? undefined : (choice as "truth" | "dare"),
      allowIrl: settings.irlMode,
    });
    if (!content) {
      await interaction.followUp({ content: "No prompts available.", flags: 64 });
      return;
    }
    await postChallengeCard({
      interaction,
      clan,
      target: interaction.user,
      content,
      kind: "challenge",
      challengerId,
    });
    return;
  }

  if (action === "complete" || action === "pass" || action === "reroll") {
    const challengeId = Number(arg);
    if (!challengeId) {
      await interaction.reply({ content: "Invalid challenge.", flags: 64 });
      return;
    }
    const challenge = await getActiveChallenge(clan.guildId, challengeId);
    if (!challenge || challenge.status !== "active") {
      await interaction.reply({ content: "This challenge is no longer active.", flags: 64 });
      return;
    }
    if (challenge.targetId !== interaction.user.id && !isOfficer(interaction.member, clan)) {
      await interaction.reply({ content: "Only the challenged player can do that.", flags: 64 });
      return;
    }

    if (action === "complete") {
      await interaction.deferUpdate();
      const res = await completeChallenge({ clan, challenge, actorId: interaction.user.id });
      const milestoneBit = res.milestone
        ? `\n🔥 **${res.milestone}-challenge streak!**`
        : "";
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ Challenge complete!")
            .setDescription(
              `${mention(challenge.targetId)} finished:\n> ${challenge.promptText}\n\n` +
                `💰 **+${res.awarded.toLocaleString("en-US")}** clan points` +
                milestoneBit
            ),
        ],
        components: [],
        content: mention(challenge.targetId),
      });
      return;
    }

    if (action === "pass") {
      await interaction.deferUpdate();
      await passChallenge({ clan, challenge });
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x95a5a6)
            .setTitle("Challenge passed")
            .setDescription(`${mention(challenge.targetId)} passed. Streak reset.`),
        ],
        components: [],
      });
      return;
    }

    if (action === "reroll") {
      await interaction.deferUpdate();
      await passChallenge({ clan, challenge });
      const content = await selectPrompt({
        guildId: clan.guildId,
        type: (challenge.contentType as "truth" | "dare") || undefined,
        allowIrl: settings.irlMode,
      });
      if (!content) {
        await interaction.followUp({ content: "No replacement prompt.", flags: 64 });
        return;
      }
      const user = await interaction.client.users.fetch(challenge.targetId);
      await postChallengeCard({
        interaction,
        clan,
        target: user,
        content,
        kind: "reroll",
        challengerId: challenge.challengerId,
      });
      return;
    }
  }

  await interaction.reply({ content: "Unknown ToD action.", flags: 64 });
}

export async function handleTodModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (interaction.customId !== TOD_ANON_MODAL) return;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({
      ...notConfiguredMessage(isOfficer(interaction.member, null)),
      flags: 64,
    });
    return;
  }
  const settings = getTodSettings(clan);
  if (!settings.anonymous) {
    await interaction.reply({ content: "Anonymous truths are disabled.", flags: 64 });
    return;
  }
  const body = interaction.fields.getTextInputValue("body").trim();
  await interaction.deferReply({ flags: 64 });
  const { id } = await submitAnonymous({
    guildId: clan.guildId,
    authorId: interaction.user.id,
    body,
    channelId: interaction.channelId,
  });

  try {
    if (interaction.channel && interaction.channel.isSendable()) {
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2c3e50)
            .setTitle("🤫 ANONYMOUS TRUTH")
            .setDescription(`"${body}"`)
            .setFooter({ text: `Guess with /tod guess id:${id} @user · id ${id}` }),
        ],
      });
    }
  } catch (err) {
    logger.warn({ err }, "anonymous post failed");
  }

  await interaction.editReply({
    content: `✅ Posted anonymously (id **${id}**). Your name was not revealed.`,
  });
}
