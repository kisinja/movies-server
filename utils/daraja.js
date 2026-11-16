const axios = require("axios");

const isSandbox = process.env.DARAJA_ENV !== "production";
const BASE_URL = isSandbox
  ? "https://sandbox.safaricom.co.ke"
  : "https://api.safaricom.co.ke";

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get OAuth Access Token
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const auth = Buffer.from(
    `${process.env.DARAJA_CONSUMER_KEY}:${process.env.DARAJA_CONSUMER_SECRET}`,
  ).toString("base64");

  const {data} = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${auth}` },
    },
  );

  cachedToken = data.access_token;

  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

  return cachedToken;
}


/**
 * Generate Password for STK Push
 */
function generatePassword() {
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14); // YYYYMMDDHHmmss

  const password = Buffer.from(shortcode + passkey + timestamp).toString(
    "base64"
  );

  return { password, timestamp };
}


/**
 * Initiate STK Push
 */
async function stkPush({ phone, amount, accountReference, description }) {
  const token = await getAccessToken();
  const { password, timestamp } = generatePassword();

  // Normalize phone to 2547XXXXXXXX
  let formattedPhone = phone.toString().replace(/\D/g, "");
  if (formattedPhone.startsWith("0")) formattedPhone = "254" + formattedPhone.slice(1);
  if (formattedPhone.startsWith("7")) formattedPhone = "254" + formattedPhone;
  if (formattedPhone.startsWith("+")) formattedPhone = formattedPhone.slice(1);

  const payload = {
    BusinessShortCode: process.env.DARAJA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.ceil(amount), // must be integer
    PartyA: formattedPhone,
    PartyB: process.env.DARAJA_SHORTCODE,
    PhoneNumber: formattedPhone,
    CallBackURL: process.env.DARAJA_CALLBACK_URL,
    AccountReference: accountReference || "TripleM",
    TransactionDesc: description || "Subscription Payment",
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return data;
}

module.exports = {stkPush, getAccessToken};