const request = require("supertest");
const express = require("express");

// Мокируем функции сервисов
jest.mock("../service/email_service", () => ({
  sendEmail: jest.fn(),
}));

jest.mock("../service/push_service", () => ({
  sendPushNotification: jest.fn(),
}));

jest.mock("../service/sms_service", () => ({
  sendSMS: jest.fn(),
}));

const { sendEmail } = require("../service/email_service");
const { sendPushNotification } = require("../service/push_service");
const { sendSMS } = require("../service/sms_service");

const app = express();
app.use(express.json());

app.post("/email", async (req, res) => {
  const { recipient, message, attachments } = req.body;
  try {
    await sendEmail({ recipient, message, attachments });
    res.status(200).send("Email sent successfully");
  } catch (error) {
    res.status(500).send(`Failed to send email: ${error.message}`);
  }
});

app.post("/push", async (req, res) => {
  const { recipient, message, media } = req.body;
  try {
    await sendPushNotification({ recipient, message, media });
    res.status(200).send("Push notification sent successfully");
  } catch (error) {
    res.status(500).send(`Failed to send push notification: ${error.message}`);
  }
});

app.post("/sms", async (req, res) => {
  const { recipient, message } = req.body;
  try {
    await sendSMS({ recipient, message });
    res.status(200).send("SMS sent successfully");
  } catch (error) {
    res.status(500).send(`Failed to send SMS: ${error.message}`);
  }
});

// Тесты
describe("Notification API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("POST /email should call sendEmail and return 200", async () => {
    sendEmail.mockResolvedValueOnce();

    const response = await request(app).post("/email").send({
      recipient: "user@example.com",
      message: "Hello, Email!",
      attachments: [],
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).toBe("Email sent successfully");
    expect(sendEmail).toHaveBeenCalledWith({
      recipient: "user@example.com",
      message: "Hello, Email!",
      attachments: [],
    });
  });

  test("POST /push should call sendPushNotification and return 200", async () => {
    sendPushNotification.mockResolvedValueOnce();

    const response = await request(app).post("/push").send({
      recipient: "firebase_token",
      message: "Hello, Push!",
      media: "https://example.com/image.png",
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).toBe("Push notification sent successfully");
    expect(sendPushNotification).toHaveBeenCalledWith({
      recipient: "firebase_token",
      message: "Hello, Push!",
      media: "https://example.com/image.png",
    });
  });

  test("POST /sms should call sendSMS and return 200", async () => {
    sendSMS.mockResolvedValueOnce();

    const response = await request(app).post("/sms").send({
      recipient: "+1234567890",
      message: "Hello, SMS!",
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).toBe("SMS sent successfully");
    expect(sendSMS).toHaveBeenCalledWith({
      recipient: "+1234567890",
      message: "Hello, SMS!",
    });
  });

  test("POST /email should return 500 on error", async () => {
    sendEmail.mockRejectedValueOnce(new Error("Test email error"));

    const response = await request(app).post("/email").send({
      recipient: "user@example.com",
      message: "Hello, Email!",
      attachments: [],
    });

    expect(response.statusCode).toBe(500);
    expect(response.text).toBe("Failed to send email: Test email error");
  });

  test("POST /push should return 500 on error", async () => {
    sendPushNotification.mockRejectedValueOnce(new Error("Test push error"));

    const response = await request(app).post("/push").send({
      recipient: "firebase_token",
      message: "Hello, Push!",
      media: "https://example.com/image.png",
    });

    expect(response.statusCode).toBe(500);
    expect(response.text).toBe(
      "Failed to send push notification: Test push error"
    );
  });

  test("POST /sms should return 500 on error", async () => {
    sendSMS.mockRejectedValueOnce(new Error("Test SMS error"));

    const response = await request(app).post("/sms").send({
      recipient: "+1234567890",
      message: "Hello, SMS!",
    });

    expect(response.statusCode).toBe(500);
    expect(response.text).toBe("Failed to send SMS: Test SMS error");
  });
});
