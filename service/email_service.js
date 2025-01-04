const amqp = require("amqplib");
const nodemailer = require("nodemailer");
const winston = require("winston");
const { Pool } = require("pg");
require("dotenv").config();

class EmailService {
  constructor() {
    this.RABBITMQ_URL = process.env.RABBITMQ_URL;
    this.QUEUE_NAME = "email_notifications";
    this.EMAIL_SERVICE_CONFIG = {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    };

    this.DB_CONFIG = {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASS,
      port: process.env.DB_PORT,
    };

    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.json(),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "logs/email_service.log" }),
      ],
    });

    this.pool = new Pool(this.DB_CONFIG);
    this.transporter = nodemailer.createTransport(this.EMAIL_SERVICE_CONFIG);
  }

  async initializeDatabase() {
    const client = await this.pool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          type VARCHAR(50) NOT NULL,
          recipient VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`
      );
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

  async sendEmail({ recipient, message }) {
    const mailOptions = {
      from: this.EMAIL_SERVICE_CONFIG.auth.user,
      to: recipient,
      subject: "Notification",
      text: message,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.info(`Email sent: ${info.messageId}`);
    } catch (err) {
      this.logger.error(`Error sending email: ${err.message}`);
      throw err;
    }
  }

  async initializeRabbitMQ() {
    try {
      const connection = await amqp.connect(this.RABBITMQ_URL);
      this.channel = await connection.createChannel();
      await this.channel.assertQueue(this.QUEUE_NAME, { durable: true });

      this.channel.consume(this.QUEUE_NAME, async (msg) => {
        if (msg) {
          const notification = JSON.parse(msg.content.toString());
          this.logger.info(`Received message: ${msg.content.toString()}`);
          try {
            await this.sendEmail(notification);
            await this.updateNotificationStatus(notification.id, "sent");
            this.channel.ack(msg);
          } catch (error) {
            this.logger.error("Failed to process email notification:", error);
          }
        }
      });

      this.logger.info(
        "RabbitMQ consumer is running and listening for Email notifications..."
      );
    } catch (err) {
      this.logger.error("Error initializing RabbitMQ:", err);
      throw err;
    }
  }

  async initialize() {
    await this.initializeDatabase();
    await this.initializeRabbitMQ();
    this.logger.info("Email Service is running");
  }
}

(async () => {
  const emailService = new EmailService();
  await emailService.initialize();
})();

module.exports = new EmailService();
