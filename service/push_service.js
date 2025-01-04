const amqp = require("amqplib");
const winston = require("winston");
const admin = require("firebase-admin");
const { Pool } = require("pg");
require("dotenv").config();
let firebaseApp = null;

class PushService {
  constructor() {
    // Инициализация логгера
    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.json(),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "logs/push_service.log" }),
      ],
    });

    this.RABBITMQ_URL = process.env.RABBITMQ_URL;
    this.QUEUE_NAME = "push_notifications";
    this.DB_CONFIG = {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASS,
      port: process.env.DB_PORT,
    };

    if (!firebaseApp) {
      const serviceAccount = require("../serviceAccountKey.json");
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.logger.info("Firebase app initialized");
    }

    this.pool = new Pool(this.DB_CONFIG);
  }

  async initializeDatabase() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          type VARCHAR(50) NOT NULL,
          recipient VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (err) {
      this.logger.error("Error initializing database:", err);
      throw err;
    } finally {
      client.release();
    }
  }

  async saveNotificationToDB(notification, status) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "INSERT INTO notifications (type, recipient, message, status) VALUES ($1, $2, $3, $4) RETURNING id",
        [
          notification.type,
          notification.recipient,
          notification.message,
          status,
        ]
      );
      this.logger.info(
        `Notification saved to DB with ID: ${result.rows[0].id}`
      );
      return result.rows[0].id;
    } catch (err) {
      this.logger.error("Error saving notification to DB:", err);
      throw err;
    } finally {
      client.release();
    }
  }

  async updateNotificationStatus(notificationId, status) {
    const client = await this.pool.connect();
    try {
      await client.query(
        "UPDATE notifications SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [status, notificationId]
      );
    } catch (err) {
      this.logger.error("Error updating notification status:", err);
      throw err;
    } finally {
      client.release();
    }
  }

  async sendPushNotification({ recipient, message, media }) {
    const payload = {
      notification: {
        title: "New Notification",
        body: message,
        image: media || null,
      },
      token: recipient,
    };

    try {
      const response = await admin.messaging().send(payload);
      this.logger.info(`Push notification sent: ${response}`);
    } catch (err) {
      this.logger.error(`Failed to send push notification: ${err.message}`);
      throw err;
    }
  }

  async initializeRabbitMQ() {
    try {
      const connection = await amqp.connect(this.RABBITMQ_URL);
      const channel = await connection.createChannel();
      await channel.assertQueue(this.QUEUE_NAME, { durable: true });

      channel.consume(this.QUEUE_NAME, async (msg) => {
        if (msg) {
          const notification = JSON.parse(msg.content.toString());
          this.logger.info(
            `Received push notification: ${msg.content.toString()}`
          );

          try {
            await this.sendPushNotification(notification);
            await this.updateNotificationStatus(notification.id, "sent");
            channel.ack(msg);
          } catch (error) {
            this.logger.error(
              `Error processing push notification: ${error.message}`
            );
          }
        }
      });

      this.logger.info(
        "RabbitMQ consumer is running and listening for push notifications..."
      );
    } catch (err) {
      this.logger.error(`Error initializing RabbitMQ: ${err.message}`);
      throw err;
    }
  }

  async initialize() {
    await this.initializeDatabase();
    await this.initializeRabbitMQ();
    this.logger.info("Push Service is running");
  }
}

(async () => {
  const pushService = new PushService();
  await pushService.initialize();
})();

module.exports = new PushService();
