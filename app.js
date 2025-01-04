const express = require("express");
const swaggerUi = require("swagger-ui-express");
const fs = require("fs");
const path = require("path");
const emailService = require("./service/email_service");
const smsService = require("./service/sms_service");
const pushService = require("./service/push_service");
const amqplib = require("amqplib");
require("dotenv").config();

const app = express();
app.use(express.json());

console.log(process.env.RABBITMQ_URL);

const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, "swagger.json"), "utf-8")
);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

let channel;

async function connectToRabbitMQ() {
  try {
    const connection = await amqplib.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertQueue("email_notifications", { durable: true });
    await channel.assertQueue("push_notifications", { durable: true });
    await channel.assertQueue("sms_notifications", { durable: true });

    consumeMessages();
  } catch (error) {
    console.error("Error connecting to RabbitMQ:", error);
  }
}

connectToRabbitMQ();

app.post("/email", async (req, res) => {
  try {
    const { recipient, message } = req.body;
    const notification = { type: "email", recipient, message };

    const notificationId = await emailService.saveNotificationToDB(
      notification,
      "pending"
    );

    channel.sendToQueue(
      "email_notifications",
      Buffer.from(JSON.stringify(notification)),
      { persistent: true }
    );

    await emailService.updateNotificationStatus(notificationId, "sent");
    res.status(200).send("Email notification queued successfully");
  } catch (error) {
    res
      .status(500)
      .send(`Failed to queue email notification: ${error.message}`);
  }
});

app.post("/push", async (req, res) => {
  try {
    const { recipient, message, media } = req.body;
    const notification = { type: "push", recipient, message, media };

    const notificationId = await pushService.saveNotificationToDB(
      notification,
      "pending"
    );

    channel.sendToQueue(
      "push_notifications",
      Buffer.from(JSON.stringify(notification)),
      { persistent: true }
    );

    await pushService.updateNotificationStatus(notificationId, "sent");
    res.status(200).send("Push notification queued successfully");
  } catch (error) {
    res.status(500).send(`Failed to queue push notification: ${error.message}`);
  }
});

app.post("/sms", async (req, res) => {
  try {
    const { recipient, message } = req.body;
    const notification = { type: "sms", recipient, message };

    const notificationId = await smsService.saveNotificationToDB(
      notification,
      "pending"
    );

    channel.sendToQueue(
      "sms_notifications",
      Buffer.from(JSON.stringify(notification)),
      { persistent: true }
    );

    await smsService.updateNotificationStatus(notificationId, "sent");
    res.status(200).send("SMS notification queued successfully");
  } catch (error) {
    res.status(500).send(`Failed to queue SMS notification: ${error.message}`);
  }
});

async function consumeMessages() {
  try {
    channel.consume("email_notifications", async (msg) => {
      console.log("Received Email message:", msg.content.toString());
      try {
        const notification = JSON.parse(msg.content.toString());
        await emailService.sendEmail(notification);
        channel.ack(msg);
      } catch (error) {
        console.error("Failed to process Email:", error.message);
      }
    });

    channel.consume("sms_notifications", async (msg) => {
      console.log("Received SMS message:", msg.content.toString());
      try {
        const notification = JSON.parse(msg.content.toString());
        await smsService.sendSMS(notification);
        channel.ack(msg);
      } catch (error) {
        console.error("Failed to process SMS:", error.message);
      }
    });

    channel.consume("push_notifications", async (msg) => {
      console.log("Received Push message:", msg.content.toString());
      const notification = JSON.parse(msg.content.toString());
      try {
        await pushService.sendPushNotification(notification);
        console.log("Processed Push:", notification);
        channel.ack(msg);
      } catch (error) {
        console.error("Failed to process Push:", error.message);
      }
    });

    console.log("Consumers are running and listening to queues...");
  } catch (error) {
    console.error("Error consuming messages:", error);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Unified service running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
});
