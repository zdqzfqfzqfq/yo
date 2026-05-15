require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ── Env ───────────────────────────────────────
const TOKEN            = process.env.TOKEN;
const PANEL_CHANNEL_ID = process.env.PANEL_CHANNEL_ID;
const SUPPORT_USER_ID  = process.env.SUPPORT_USER_ID;
const ORDER_CHANNEL_ID = process.env.ORDER_CHANNEL_ID;
const AUTO_ROLE_ID     = process.env.AUTO_ROLE_ID;

// ── Per-ticket product context ────────────────
// channelId → last selected product label
const ticketProduct = new Map();

// ── Custom emoji helpers ──────────────────────
const E_PAYPAL = "<:paypal:1504837281490538637>";
const E_CRYPTO = "<:Bitcoin:1504837314948628611>";
const E_ROBUX  = "<:Robux:1504837584243659008>";
const E_UE     = "<:unnamed:1504837639990415440>";
const E_VOLT   = "<:Volt:1504839980202201178>";

// ── Reusable close button ─────────────────────
function closeBtn() {
  return new ButtonBuilder()
    .setCustomId("close_ticket")
    .setLabel("🔒 Close")
    .setStyle(ButtonStyle.Danger);
}

// ── Send a fresh message (not an edit) ────────
async function send(channel, embed, row, ping = null) {
  const opts = { embeds: [embed], components: [row] };
  if (ping) opts.content = ping;
  await channel.send(opts);
}

// ─────────────────────────────────────────────
// Ready → panel
// ─────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
  if (!channel) return console.error("❌ Panel channel not found.");

  const embed = new EmbedBuilder()
    .setTitle("🎫  Support & Purchases")
    .setDescription(
      "Need something? Hit the button below and we'll open a private ticket just for you.\n\n> Fast · Private · No hassle"
    )
    .setColor(0x5865f2)
    .setFooter({ text: "One click — we handle the rest." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_ticket")
      .setLabel("Open a Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
  console.log("✅ Panel sent.");
});

// ─────────────────────────────────────────────
// Auto-role on join
// ─────────────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  if (!AUTO_ROLE_ID) return;
  const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
  if (!role) return console.error(`❌ Auto-role ${AUTO_ROLE_ID} not found.`);
  await member.roles.add(role).catch(console.error);
});

// ─────────────────────────────────────────────
// Interactions
// ─────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user, guild, channel } = interaction;

  // ── Open ticket ───────────────────────────────
  if (customId === "open_ticket") {
    await interaction.deferReply({ ephemeral: true });

    const existing = guild.channels.cache.find(
      (c) => c.name === `ticket-${user.username.toLowerCase()}`
    );
    if (existing) {
      return interaction.editReply({ content: `You've already got one open → ${existing}` });
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id,        deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      ],
    });

    const embed = new EmbedBuilder()
      .setTitle("👋  Welcome to your ticket")
      .setDescription(`Hey ${user}! What are you looking to grab today?`)
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("product_ue_config").setLabel("Config").setEmoji(E_UE).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("product_ue_lua").setLabel("Lua").setEmoji(E_UE).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("product_volt").setLabel("Volt").setEmoji(E_VOLT).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("product_ue_key").setLabel("Key").setEmoji(E_UE).setStyle(ButtonStyle.Secondary),
      closeBtn()
    );

    await ticketChannel.send({ content: `${user}`, embeds: [embed], components: [row] });
    await interaction.editReply({ content: `✅ Ticket created → ${ticketChannel}` });
    return;
  }

  // ── Close ticket ──────────────────────────────
  if (customId === "close_ticket") {
    await interaction.reply({ content: "🔒 Closing in 5s…" });
    setTimeout(() => channel.delete().catch(console.error), 5000);
    return;
  }

  // Defer update for all product/payment flows
  await interaction.deferUpdate();

  // ── Helper: disable all buttons on the triggering message ────────
  async function lockButtons(selectedId) {
    const disabledRows = interaction.message.components.map((row) => {
      const newRow = new ActionRowBuilder();
      newRow.addComponents(
        row.components.map((btn) => {
          if (btn.customId === "close_ticket") return ButtonBuilder.from(btn);
          return ButtonBuilder.from(btn).setDisabled(true).setStyle(
            btn.customId === selectedId ? ButtonStyle.Success : ButtonStyle.Secondary
          );
        })
      );
      return newRow;
    });
    await interaction.message.edit({ components: disabledRows }).catch(() => {});
  }

  // ── UE Config ────────────────────────────────
  if (customId === "product_ue_config") {
    await lockButtons("product_ue_config");

    const embed = new EmbedBuilder()
      .setTitle(`${E_UE}  UE Config — Pick your mode`)
      .setDescription("Rage or legit? Choose below.")
      .setColor(0xffa500);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ueconfig_rage").setLabel("Rage").setEmoji("🔥").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ueconfig_legit").setLabel("Legit").setEmoji("✅").setStyle(ButtonStyle.Success)
    );

    await send(channel, embed, row);
    return;
  }

  // ── UE Lua ────────────────────────────────────
  if (customId === "product_ue_lua") {
    ticketProduct.set(channel.id, "UE Lua");
    await lockButtons("product_ue_lua");

    const embed = new EmbedBuilder()
      .setTitle(`${E_UE}  UE Lua — Choose payment`)
      .setDescription(
        `${E_PAYPAL} **PayPal** — $2
${E_CRYPTO} **Crypto** — $2
${E_ROBUX} **Robux** — 400 R$`
      )
      .setColor(0xffa500);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pay_paypal_2").setLabel("PayPal").setEmoji(E_PAYPAL).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pay_crypto_2").setLabel("Crypto").setEmoji(E_CRYPTO).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pay_robux_400").setLabel("Robux (400 R$)").setEmoji(E_ROBUX).setStyle(ButtonStyle.Secondary)
    );

    await send(channel, embed, row);
    return;
  }

  // ── UE Key ───────────────────────────────────
  if (customId === "product_ue_key") {
    ticketProduct.set(channel.id, "UE Key");
    await lockButtons("product_ue_key");

    const embed = new EmbedBuilder()
      .setTitle(`${E_UE}  UE Key — Choose payment`)
      .setDescription(
        `${E_PAYPAL} **PayPal** — $10
${E_CRYPTO} **Crypto** — $10
${E_ROBUX} **Robux** — 1200 R$`
      )
      .setColor(0xffa500);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pay_paypal_10").setLabel("PayPal").setEmoji(E_PAYPAL).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pay_crypto_10").setLabel("Crypto").setEmoji(E_CRYPTO).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pay_robux_1200").setLabel("Robux (1200 R$)").setEmoji(E_ROBUX).setStyle(ButtonStyle.Secondary)
    );

    await send(channel, embed, row);
    return;
  }

  // ── Volt ─────────────────────────────────────
  if (customId === "product_volt") {
    await lockButtons("product_volt");

    const embed = new EmbedBuilder()
      .setTitle(`${E_VOLT}  Volt — Pick a duration`)
      .setColor(0xffff00)
      .addFields(
        { name: "7 Days",  value: `$4  ·  600 ${E_ROBUX}`,  inline: true },
        { name: "30 Days", value: `$16  ·  1500 ${E_ROBUX}`, inline: true }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("volt_7days").setLabel("7 Days").setEmoji("🗓️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("volt_30days").setLabel("30 Days").setEmoji("📅").setStyle(ButtonStyle.Primary)
    );

    await send(channel, embed, row);
    return;
  }

  // ── UE Config — Rage / Legit ─────────────────
  const ueConfigIds = ["ueconfig_rage", "ueconfig_legit"];

  if (ueConfigIds.includes(customId)) {
    const mode      = customId === "ueconfig_rage" ? "Rage" : "Legit";
    const modeEmoji = mode === "Rage" ? "🔥" : "✅";
    ticketProduct.set(channel.id, `UE Config (${mode})`);
    await lockButtons(customId);

    const embed = new EmbedBuilder()
      .setTitle(`${modeEmoji}  UE Config (${mode}) — Choose payment`)
      .setDescription(
        `${E_PAYPAL} **PayPal** — $2
${E_CRYPTO} **Crypto** — $2
${E_ROBUX} **Robux** — 400 R$`
      )
      .setColor(mode === "Rage" ? 0xff4444 : 0x44ff44);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pay_paypal_2").setLabel("PayPal").setEmoji(E_PAYPAL).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pay_crypto_2").setLabel("Crypto").setEmoji(E_CRYPTO).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pay_robux_400").setLabel("Robux (400 R$)").setEmoji(E_ROBUX).setStyle(ButtonStyle.Secondary)
    );

    await send(channel, embed, row);
    return;
  }

  // ── Volt 7 days ───────────────────────────────
  if (customId === "volt_7days") {
    ticketProduct.set(channel.id, "Volt 7-Day Key");
    await lockButtons("volt_7days");

    const embed = new EmbedBuilder()
      .setTitle(`${E_VOLT}  Volt 7-Day Key — Choose payment`)
      .setDescription(
        `${E_PAYPAL} **PayPal** — $4
${E_CRYPTO} **Crypto** — $4
${E_ROBUX} **Robux** — 600 R$`
      )
      .setColor(0xffff00);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pay_paypal_4").setLabel("PayPal").setEmoji(E_PAYPAL).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pay_crypto_4").setLabel("Crypto").setEmoji(E_CRYPTO).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pay_robux_600").setLabel("Robux (600 R$)").setEmoji(E_ROBUX).setStyle(ButtonStyle.Secondary)
    );

    await send(channel, embed, row);
    return;
  }

  // ── Volt 30 days ──────────────────────────────
  if (customId === "volt_30days") {
    ticketProduct.set(channel.id, "Volt 30-Day Key");
    await lockButtons("volt_30days");

    const embed = new EmbedBuilder()
      .setTitle(`${E_VOLT}  Volt 30-Day Key — Choose payment`)
      .setDescription(
        `${E_PAYPAL} **PayPal** — $16
${E_CRYPTO} **Crypto** — $16
${E_ROBUX} **Robux** — 1500 R$`
      )
      .setColor(0xffff00);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pay_paypal_16").setLabel("PayPal").setEmoji(E_PAYPAL).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pay_crypto_16").setLabel("Crypto").setEmoji(E_CRYPTO).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pay_robux_1500").setLabel("Robux (1500 R$)").setEmoji(E_ROBUX).setStyle(ButtonStyle.Secondary)
    );

    await send(channel, embed, row);
    return;
  }

  // ── Payment handlers ──────────────────────────
  if (customId.startsWith("pay_")) {
    const parts  = customId.split("_");  // pay_paypal_2 → ["pay","paypal","2"]
    const method = parts[1];
    const amount = parts[2];

    let methodLabel, priceText, emoji;
    if (method === "paypal") {
      methodLabel = "PayPal";  priceText = `$${amount}`;  emoji = E_PAYPAL;
    } else if (method === "crypto") {
      methodLabel = "Crypto";  priceText = `$${amount}`;  emoji = E_CRYPTO;
    } else {
      methodLabel = "Robux";   priceText = `${amount} R$`; emoji = E_ROBUX;
    }

    await lockButtons(customId);

    const embed = new EmbedBuilder()
      .setTitle(`${emoji}  Payment confirmed — ${methodLabel}`)
      .setDescription(
        `You owe **${priceText}** via **${methodLabel}**.
Have it ready — support will be with you shortly. 🙏`
      )
      .setColor(0x00bfff)
      .setFooter({ text: "Don't leave — support is on the way!" });

    await channel.send({ embeds: [embed] });

    const product = ticketProduct.get(channel.id) || "Unknown Product";
    const orderChannel = await client.channels.fetch(ORDER_CHANNEL_ID).catch(() => null);
    if (orderChannel) {
      await orderChannel.send(
        `🛒 New order in ${channel} — **${product}** · ${emoji} **${methodLabel}** · **${priceText}** · ${user}`
      );
    }
    return;
  }
});

client.login(TOKEN);
