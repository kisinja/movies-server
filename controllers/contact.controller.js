const { AppError } = require("../middleware/error-handler");
const { sendContactMessageEmail } = require("../utils/email");
const prisma = require("../lib/prisma");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOPICS = ["support", "billing", "info"];
const str = (v) => (typeof v === "string" ? v.trim() : "");

async function sendContactMessage(req, res) {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Please provide a valid JSON object.");
  }

  // Honeypot: bots fill every field. Pretend it worked and drop it.
  if (str(body.website)) {
    return res.json({ success: true, message: "Thanks! We'll be in touch." });
  }

  const name = str(body.name);
  const email = str(body.email);
  const topic = str(body.topic) || "support";
  const subject = str(body.subject);
  const message = str(body.message);

  if (!name || name.length > 100)
    throw new AppError(
      400,
      "Please enter your name (100 characters or fewer).",
    );
  if (!EMAIL_PATTERN.test(email) || email.length > 254)
    throw new AppError(400, "Please provide a valid email address.");
  if (!TOPICS.includes(topic))
    throw new AppError(400, "Please choose a valid topic.");
  if (subject.length > 120)
    throw new AppError(400, "Subject must be 120 characters or fewer.");
  if (message.length < 10 || message.length > 3000)
    throw new AppError(400, "Message must be between 10 and 3000 characters.");

  await prisma.contactMessage.create({
    data: {
      name,
      email: email.toLowerCase(),
      topic,
      subject: subject || null,
      message,
    },
    select: { id: true },
  });

  try {
    await sendContactMessageEmail({ name, email, topic, subject, message });
  } catch (err) {
    console.error("Failed to deliver contact message:", err);
  }

  res.json({ success: true, message: "Thanks! We'll be in touch." });
}

module.exports = { sendContactMessage };
