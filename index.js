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


// =======================================
// ORDER ID
// =======================================

function peekOrderId() {
  let data = JSON.parse(
    fs.readFileSync('order_id.json', 'utf-8')
  );

  return `IG${20100 + data.current}`;
}

function confirmOrderId() {
  let data = JSON.parse(
    fs.readFileSync('order_id.json', 'utf-8')
  );

  const id = `IG${20100 + data.current}`;

  data.current += 1;

  fs.writeFileSync(
    'order_id.json',
    JSON.stringify(data)
  );

  return id;
}


// =======================================
// TODAY COUNT
// =======================================

function getTodayData() {

  let data = JSON.parse(
    fs.readFileSync('orders_today.json', 'utf-8')
  );

  const today = new Date().toDateString();

  // RESET IF NEW DAY
  if (data.date !== today) {

    data.date = today;
    data.count = 0;

    fs.writeFileSync(
      'orders_today.json',
      JSON.stringify(data)
    );
  }

  return data;
}

async function updateTodayCount() {

  let data = getTodayData();

  let totalData = JSON.parse(
    fs.readFileSync('order_id.json', 'utf-8')
  );

  // ADD NEW ORDER
  data.count += 1;

  fs.writeFileSync(
    'orders_today.json',
    JSON.stringify(data)
  );

  try {

    const panelData = JSON.parse(
      fs.readFileSync('panel.json', 'utf-8')
    );

    const channel = await client.channels.fetch(
      ORDER_CHANNEL_ID
    );

    const message = await channel.messages.fetch(
      panelData.statsMessageId
    );

    await message.edit({
      content:
`📊 **Orders Today:** ${data.count} | 📦 **Total Orders:** ${totalData.current}
━━━━━━━━━━━━━━━━━━
🛒 **Create your order below:**`
    });

  } catch (err) {
    console.log('Panel update failed');
  }

  return data.count;
}


// =======================================
// READY
// =======================================

client.once('ready', async () => {

  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(
    ORDER_CHANNEL_ID
  );

  const button = new ButtonBuilder()
    .setCustomId('create_order')
    .setLabel('🛒 Create Order')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder()
    .addComponents(button);

  let panelData = JSON.parse(
    fs.readFileSync('panel.json', 'utf-8')
  );

  // DELETE OLD PANEL
  if (panelData.statsMessageId) {

    try {

      const oldMsg = await channel.messages.fetch(
        panelData.statsMessageId
      );

      await oldMsg.delete();

    } catch {}
  }

  // GET UPDATED TODAY DATA
  let data = getTodayData();

  let totalData = JSON.parse(
    fs.readFileSync('order_id.json', 'utf-8')
  );

  // CREATE NEW PANEL
  const msg = await channel.send({
    content:
`📊 **Orders Today:** ${data.count} | 📦 **Total Orders:** ${totalData.current}
━━━━━━━━━━━━━━━━━━
🛒 **Create your order below:**`,
    components: [row]
  });

  panelData.statsMessageId = msg.id;

  fs.writeFileSync(
    'panel.json',
    JSON.stringify(panelData)
  );
});


// =======================================
// BUTTON CLICK
// =======================================

client.on('interactionCreate', async (interaction) => {

  if (!interaction.isButton()) return;

  if (interaction.customId === 'create_order') {

    const orderId = peekOrderId();

    await interaction.reply({
      content: `⏳ Creating your order...`,
      ephemeral: true
    });

    // CREATE PRIVATE THREAD
    const thread = await interaction.channel.threads.create({
      name: `order-${orderId}`,
      type: ChannelType.PrivateThread,
      invitable: false
    });

    await thread.members.add(interaction.user.id);

    // SAVE SESSION
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
      content:
`✅ Order ${orderId} created
👉 Open here: ${thread.url}`
    });

    // DELETE EPHEMERAL REPLY
    setTimeout(async () => {
      try {
        await interaction.deleteReply();
      } catch {}
    }, 30000);

    // AUTO CLEANUP
    const interval = setInterval(async () => {

      const session = sessions[thread.id];

      if (!session) {
        clearInterval(interval);
        return;
      }

      const inactive =
        Date.now() - session.lastActivity;

      // 2 MINUTES INACTIVE
      if (inactive >= 120000) {

        try {

          await session.thread.send(
            "❌ Order cancelled (no response)"
          );

          await session.thread.setArchived(true);

          await session.thread.setLocked(true);

          setTimeout(async () => {

            try {
              await session.thread.delete();
            } catch {}

          }, 3000);

        } catch {}

        delete sessions[thread.id];

        clearInterval(interval);
      }

    }, 15000);
  }
});


// =======================================
// MESSAGE FLOW
// =======================================

client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

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

  // ASK NEXT QUESTION
  if (session.step <= questions.length) {

    await message.channel.send(
      questions[session.step - 1]
    );

  } else {

    // CONFIRM ORDER ID
    const finalOrderId = confirmOrderId();

    session.orderId = finalOrderId;

    const confirmChannel =
      await client.channels.fetch(
        CONFIRM_CHANNEL_ID
      );

    // FINAL ORDER MESSAGE
    const msg =
`Order ID: ${session.orderId}

Name: ${session.answers[0]}
Phone: ${session.answers[1]}
Address: ${session.answers[2]}

Product: ${session.answers[3]}
Size: ${session.answers[4]}
Total: ${session.answers[5]} PKR

Payment Type: ${session.answers[6]}
Note: ${session.answers[7]}`;

    const sentMsg =
      await confirmChannel.send(msg);

    try {
      await sentMsg.react('🟡');
    } catch {}

    await message.channel.send(
      "✅ Order submitted"
    );

    // UPDATE TODAY COUNT
    await updateTodayCount();

    // DELETE THREAD AFTER SUCCESS
    setTimeout(async () => {

      try {

        await session.thread.setArchived(true);

        await session.thread.setLocked(true);

        setTimeout(async () => {

          try {
            await session.thread.delete();
          } catch {}

        }, 3000);

      } catch {}

    }, 5000);

    delete sessions[message.channel.id];
  }
});


// =======================================
// LOGIN
// =======================================

client.login(TOKEN);
