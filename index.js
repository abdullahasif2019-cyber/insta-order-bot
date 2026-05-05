require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require('discord.js');

const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.TOKEN;

const CONFIRM_CHANNEL_ID = '1487185157118103643';
const ORDER_CHANNEL_ID = '1501309625620889621';

let sessions = {};

// -------- ORDER ID --------
function peekOrderId() {
  let data = JSON.parse(fs.readFileSync('order_id.json', 'utf-8'));
  return `IG${20100 + data.current}`;
}

function confirmOrderId() {
  let data = JSON.parse(fs.readFileSync('order_id.json', 'utf-8'));
  const id = `IG${20100 + data.current}`;
  data.current += 1;
  fs.writeFileSync('order_id.json', JSON.stringify(data));
  return id;
}

// -------- TODAY COUNT --------
async function updateTodayCount() {
  let data = JSON.parse(fs.readFileSync('orders_today.json', 'utf-8'));
  let totalData = JSON.parse(fs.readFileSync('order_id.json', 'utf-8'));

  let today = new Date().toDateString();

  if (data.date !== today) {
    data.date = today;
    data.count = 0;
  }

  data.count += 1;
  fs.writeFileSync('orders_today.json', JSON.stringify(data));

  try {
    const panelData = JSON.parse(fs.readFileSync('panel.json', 'utf-8'));
    const channel = await client.channels.fetch(ORDER_CHANNEL_ID);
    const message = await channel.messages.fetch(panelData.statsMessageId);

    await message.edit({
      content: `📊 **Orders Today:** ${data.count} | 📦 **Total Orders:** ${totalData.current}\n━━━━━━━━━━━━━━━━━━\n🛒 **Create your order below:**`
    });
  } catch {}

  return data.count;
}

// -------- READY --------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(ORDER_CHANNEL_ID);

  const button = new ButtonBuilder()
    .setCustomId('create_order')
    .setLabel('🛒 Create Order')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  let panelData = JSON.parse(fs.readFileSync('panel.json', 'utf-8'));

  if (panelData.statsMessageId) {
    try {
      const oldMsg = await channel.messages.fetch(panelData.statsMessageId);
      await oldMsg.delete();
    } catch {}
  }

  let data = JSON.parse(fs.readFileSync('orders_today.json', 'utf-8'));
  let totalData = JSON.parse(fs.readFileSync('order_id.json', 'utf-8'));

  const msg = await channel.send({
    content: `📊 **Orders Today:** ${data.count} | 📦 **Total Orders:** ${totalData.current}\n━━━━━━━━━━━━━━━━━━\n🛒 **Create your order below:**`,
    components: [row]
  });

  panelData.statsMessageId = msg.id;
  fs.writeFileSync('panel.json', JSON.stringify(panelData));
});

// -------- BUTTON CLICK --------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'create_order') {

    const orderId = peekOrderId();

    await interaction.reply({
      content: `⏳ Creating your order...`,
      ephemeral: true
    });

    const thread = await interaction.channel.threads.create({
      name: `order-${orderId}`,
      type: ChannelType.PrivateThread,
      invitable: false
    });

    await thread.members.add(interaction.user.id);

    // ✅ FIX: store by thread.id
    sessions[thread.id] = {
      userId: interaction.user.id,
      step: 0,
      answers: [],
      thread: thread,
      orderId: orderId,
      lastActivity: Date.now()
    };

    await thread.send(`🆔 Order ${orderId}`);
    await thread.send("Enter Customer Name:");

    await interaction.editReply({
      content: `✅ Order ${orderId} created\n👉 Open here: ${thread.url}`
    });

    setTimeout(async () => {
      try { await interaction.deleteReply(); } catch {}
    }, 30000);

    // ✅ FIXED CLEANUP LOOP
    const interval = setInterval(async () => {
      const session = sessions[thread.id];

      if (!session) {
        clearInterval(interval);
        return;
      }

      const inactive = Date.now() - session.lastActivity;

      if (inactive >= 120000) {
        try {
          await session.thread.send("❌ Order cancelled (no response)");

          await session.thread.setArchived(true);
          await session.thread.setLocked(true);

          setTimeout(async () => {
            try { await session.thread.delete(); } catch {}
          }, 3000);

        } catch {}

        delete sessions[thread.id];
        clearInterval(interval);
      }

    }, 15000); // check every 15 sec
  }
});

// -------- MESSAGE FLOW --------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ✅ FIX: find session by thread
  const session = sessions[message.channel.id];
  if (!session) return;

  session.lastActivity = Date.now();

  session.answers.push(message.content);
  session.step++;

  const questions = [
    "Phone Number:",
    "Address:",
    "Product:",
    "Size:",
    "Total:",
    "Payment Type:",
    "Note:"
  ];

  if (session.step <= questions.length) {
    await message.channel.send(questions[session.step - 1]);
  } else {

    const finalOrderId = confirmOrderId();
    session.orderId = finalOrderId;

    const confirmChannel = await client.channels.fetch(CONFIRM_CHANNEL_ID);

    const msg = `
Order ID: ${session.orderId}

Name: ${session.answers[0]}
Phone: ${session.answers[1]}
Address: ${session.answers[2]}

Product: ${session.answers[3]}
Size: ${session.answers[4]}
Total: ${session.answers[5]} PKR

Payment Type: ${session.answers[6]}
Note: ${session.answers[7]}
`;

    const sentMsg = await confirmChannel.send(msg);
    try { await sentMsg.react('🟡'); } catch {}

    await message.channel.send("✅ Order submitted");

    await updateTodayCount();

    // DELETE AFTER SUCCESS
    setTimeout(async () => {
      try {
        await session.thread.setArchived(true);
        await session.thread.setLocked(true);

        setTimeout(async () => {
          try { await session.thread.delete(); } catch {}
        }, 3000);

      } catch {}
    }, 5000);

    delete sessions[message.channel.id];
  }
});

client.login(TOKEN);