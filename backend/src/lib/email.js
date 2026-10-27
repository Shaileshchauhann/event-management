const nodemailer = require('nodemailer');
const { SESClient, SendRawEmailCommand } = require('@aws-sdk/client-ses');

const ses = new SESClient({});
const transporter = nodemailer.createTransport({
  SES: { ses, aws: { SendRawEmailCommand } },
});

/**
 * Send the ticket email after successful registration.
 * Now includes a "Manage / Cancel Ticket" link pointing at the
 * frontend management page so attendees can self-cancel later.
 *
 * @param {object} opts
 * @param {string}  opts.toEmail
 * @param {string}  opts.attendeeName
 * @param {string}  opts.eventName
 * @param {string}  opts.eventDate
 * @param {string}  [opts.venue]
 * @param {Buffer}  opts.qrBuffer       - QR code PNG buffer
 * @param {string}  opts.ticketId       - Used to build the manage link
 * @param {string}  [opts.frontendBaseUrl] - Base URL of the frontend app
 */
async function sendTicketEmail({
  toEmail,
  attendeeName,
  eventName,
  eventDate,
  venue,
  qrBuffer,
  ticketId,
  frontendBaseUrl,
}) {
  const manageUrl =
    ticketId && frontendBaseUrl
      ? `${frontendBaseUrl}/ticket/manage?ticketId=${encodeURIComponent(ticketId)}`
      : null;

  const manageSection = manageUrl
    ? `
      <p style="margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
        <strong>Need to manage or cancel your ticket?</strong><br>
        Use your Ticket ID above or click the link below.
      </p>
      <p>
        <a
          href="${manageUrl}"
          style="
            display:inline-block;
            background:#f47b4a;
            color:#ffffff;
            text-decoration:none;
            padding:12px 20px;
            border-radius:6px;
            font-weight:bold;
          "
        >
          Manage / Cancel Ticket
        </a>
      </p>`
    : '';

  await transporter.sendMail({
    from: process.env.SENDER_EMAIL,
    to: toEmail,
    subject: `Your EventPass ticket \u2014 ${eventName}`,
    html: `
      <p>Here is your ticket for <strong>${eventName}</strong>.</p>

<p>
  <strong>Ticket ID:</strong><br>
  <span style="font-family:monospace;font-size:16px;">${ticketId}</span>
</p>

<p>${eventDate}${venue ? ` &middot; ${venue}` : ''}</p>

<p>
  Show the QR code below at the gate.
  It is single-use, so don&rsquo;t share it.
</p>
      <img src="cid:ticket-qr" alt="Ticket QR code" width="240" height="240" />
      ${manageSection}
    `,
    attachments: [
      {
        filename: 'ticket-qr.png',
        content: qrBuffer,
        cid: 'ticket-qr',
      },
    ],
  });
}

/**
 * Send a 6-digit OTP verification code email.
 * Used for both booking verification and cancellation verification.
 *
 * @param {object} opts
 * @param {string} opts.toEmail
 * @param {string} opts.attendeeName
 * @param {string} opts.code          - The plaintext OTP (only available in memory, never stored)
 * @param {'BOOKING'|'CANCELLATION'} opts.purpose
 * @param {string} [opts.eventName]   - For BOOKING emails
 */
async function sendOtpEmail({ toEmail, attendeeName, code, purpose, eventName }) {
  const isBooking = purpose === 'BOOKING';

  const subject = isBooking
    ? 'Verify your EventPass registration'
    : 'Your EventPass cancellation code';

  const contextLine = isBooking && eventName
    ? `Your verification code for <strong>${eventName}</strong> is:`
    : 'Your cancellation verification code is:';

  const footerNote = isBooking
    ? 'If you did not request a ticket for this event, you can safely ignore this email.'
    : 'If you did not request to cancel your ticket, you can safely ignore this email.';

  await transporter.sendMail({
    from: process.env.SENDER_EMAIL,
    to: toEmail,
    subject,
    html: `
      <p>Hello ${attendeeName},</p>
      <p>${contextLine}</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#333;">${code}</p>
      <p>This code expires in <strong>10 minutes</strong>.</p>
      <p style="color:#888;font-size:13px;">${footerNote}</p>
    `,
  });
}

module.exports = { sendTicketEmail, sendOtpEmail };
