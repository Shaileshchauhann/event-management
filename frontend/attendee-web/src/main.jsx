import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QRCodeSVG } from "qrcode.react";
import { listEvents } from "./api/events";
import {
  requestBookingCode,
  verifyAndBook,
  createPaymentOrder,
  verifyPayment,
  getTicket,
  requestCancellationCode,
  verifyCancellationCode,
} from "./api/tickets";
import "./styles.css";

const apiDate = (value) =>
  value ? new Date(value).toLocaleString() : "Date to be announced";

const formatRupees = (paise) =>
  `₹${(Number(paise || 0) / 100).toFixed(2)}`;

const isPaidEventCheck = (event) => {
  if (!event) return false;
  const isPaid =
    event.isPaid === true ||
    String(event.isPaid).toLowerCase() === "true" ||
    event.isPaid === 1;
  const price = Number(event.price || 0);
  return (isPaid && price > 0) || price > 0;
};

const Status = ({ value }) => (
  <span className={`status status-${String(value || "").toLowerCase()}`}>
    {value || "UNKNOWN"}
  </span>
);

const PriceBadge = ({ isPaid, price }) => {
  const isPaidBool =
    isPaid === true ||
    String(isPaid).toLowerCase() === "true" ||
    isPaid === 1;
  const numPrice = Number(price || 0);
  const isPaidEvent = (isPaidBool && numPrice > 0) || numPrice > 0;

  return (
    <span className={`price-badge ${isPaidEvent ? "paid" : "free"}`}>
      {isPaidEvent ? formatRupees(numPrice) : "FREE"}
    </span>
  );
};

const Notice = ({ children, success = false, error = false }) =>
  children ? (
    <div
      className={`notice ${success ? "success" : ""} ${error ? "error-notice" : ""}`}
    >
      {children}
    </div>
  ) : null;

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function App() {
  const query = new URLSearchParams(window.location.search);

  return window.location.pathname === "/ticket/manage" ? (
    <ManageTicket initialId={query.get("ticketId") || ""} />
  ) : (
    <Home />
  );
}

function Home() {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listEvents()
      .then(setEvents)
      .catch((error) => setError(error.message));
  }, []);

  return (
    <div className="site">
      <header className="hero">
        <nav>
          <strong>EventPass</strong>
          <a href="#events">Events</a>
          <a href="/ticket/manage">Manage ticket</a>
        </nav>

        <div className="hero-copy">
          <p className="eyebrow">EVENT TICKETING & PAYMENTS</p>
          <h1>Make your next event memorable.</h1>
          <p>
            Browse free & paid events, pay securely with Razorpay, and keep your
            verified digital ticket ready for instant entry.
          </p>
        </div>
      </header>

      <main className="container" id="events">
        <div className="heading">
          <div>
            <p className="eyebrow">UPCOMING EVENTS</p>
            <h2>Choose an event</h2>
          </div>

          <span>
            {events.length} active event{events.length === 1 ? "" : "s"}
          </span>
        </div>

        <Notice error={Boolean(error)}>{error}</Notice>

        {!error && !events.length && (
          <div className="empty">No active events are available right now.</div>
        )}

        <div className="event-grid">
          {events.map((event) => (
            <button
              className="event-card"
              key={event.eventId}
              onClick={() => setSelected(event)}
            >
              <div className="card-top">
                <span>{apiDate(event.date)}</span>
                <PriceBadge isPaid={event.isPaid} price={event.price} />
              </div>

              <h3>{event.name}</h3>
              <p>{event.venue || "Venue TBA"}</p>

              <div className="card-bottom">
                <small>
                  {event.capacity
                    ? `${Math.max(
                        0,
                        event.capacity - (event.ticketsIssued || 0)
                      )} spots remaining`
                    : "Open capacity"}
                </small>

                <b>
                  {isPaidEventCheck(event)
                    ? `Book · ${formatRupees(event.price)} →`
                    : "Book free ticket →"}
                </b>
              </div>
            </button>
          ))}
        </div>
      </main>

      <footer>
        Need to cancel a reservation or check your ticket?{" "}
        <a href="/ticket/manage">Manage your ticket</a>
      </footer>

      {selected && (
        <Booking event={selected} close={() => setSelected(null)} />
      )}
    </div>
  );
}

function Booking({ event, close }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    code: "",
  });

  const [challengeId, setChallengeId] = useState("");
  const [ticket, setTicket] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentStep, setPaymentStep] = useState("");

  const isPaidEvent = isPaidEventCheck(event);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      if (!challengeId) {
        // Step 1: Request email OTP verification
        const response = await requestBookingCode({
          eventId: event.eventId,
          attendeeName: form.name,
          attendeeEmail: form.email,
        });

        setChallengeId(response.challengeId);
        setMessage("Verification code sent to your email address.");
      } else if (!isPaidEvent) {
        // Step 2A: Free event -> complete registration directly
        const result = await verifyAndBook({
          challengeId,
          code: form.code,
        });

        setTicket(result);
        setMessage("Registration confirmed! Your ticket is ready.");
      } else {
        // Step 2B: Paid event -> initialize Razorpay Checkout
        setPaymentStep("checkout");
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
          throw new Error("Unable to load Razorpay payment gateway. Please check your network connection.");
        }

        // Create Razorpay Order on server
        const orderData = await createPaymentOrder({
          challengeId,
          code: form.code,
          eventId: event.eventId,
          attendeeName: form.name,
          attendeeEmail: form.email,
        });

        // Launch Razorpay Standard Checkout modal
        const options = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency || "INR",
          name: "EventPass",
          description: `Ticket: ${event.name}`,
          order_id: orderData.orderId,
          prefill: {
            name: form.name,
            email: form.email,
          },
          theme: {
            color: "#ef8354",
          },
          handler: async function (response) {
            setPaymentStep("verifying");
            try {
              const verifiedResult = await verifyPayment({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              });

              setTicket(verifiedResult);
              setMessage("Payment verified! Your ticket has been confirmed.");
            } catch (verifyErr) {
              setMessage(verifyErr.message || "Payment verification failed.");
            } finally {
              setBusy(false);
              setPaymentStep("");
            }
          },
          modal: {
            ondismiss: function () {
              setBusy(false);
              setPaymentStep("");
              setMessage("Payment modal closed. You can retry completing your ticket purchase.");
            },
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function (failResponse) {
          setBusy(false);
          setPaymentStep("");
          const errDesc = failResponse.error?.description || "Payment failed.";
          setMessage(`Payment failed: ${errDesc}. You can try another payment method.`);
        });
        rzp.open();
        return; // Modal handles completion
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      if (!isPaidEvent || !challengeId) {
        setBusy(false);
      }
    }
  }

  return (
    <div className="backdrop">
      <section className="modal">
        <div className="heading">
          <div>
            <p className="eyebrow">
              {isPaidEvent ? `PAID TICKET · ${formatRupees(event.price)}` : "FREE EVENT"}
            </p>
            <h2>{event.name}</h2>
            <p className="muted">
              {event.venue || "Venue TBA"} · {apiDate(event.date)}
            </p>
          </div>

          <button className="close" onClick={close}>
            ×
          </button>
        </div>

        {ticket ? (
          <TicketCard ticket={ticket} event={event} />
        ) : (
          <form onSubmit={submit}>
            {isPaidEvent && (
              <div className="order-summary">
                <div className="summary-row">
                  <span>Ticket Price:</span>
                  <strong>{formatRupees(event.price)}</strong>
                </div>
                <div className="summary-row">
                  <span>Quantity:</span>
                  <span>1 Ticket</span>
                </div>
                <div className="summary-row total">
                  <span>Total Payable:</span>
                  <strong className="text-primary">{formatRupees(event.price)}</strong>
                </div>
              </div>
            )}

            <label>
              Full Name *
              <input
                required
                disabled={Boolean(challengeId)}
                placeholder="e.g. Priya Sharma"
                value={form.name}
                onChange={(e) =>
                  setForm({
                    ...form,
                    name: e.target.value,
                  })
                }
              />
            </label>

            <label>
              Email Address *
              <input
                required
                type="email"
                disabled={Boolean(challengeId)}
                placeholder="e.g. priya@example.com"
                value={form.email}
                onChange={(e) =>
                  setForm({
                    ...form,
                    email: e.target.value,
                  })
                }
              />
            </label>

            {challengeId && (
              <label>
                Email Verification Code (6 Digits) *
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength="6"
                  placeholder="Enter 6-digit OTP from your email"
                  value={form.code}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      code: e.target.value,
                    })
                  }
                />
              </label>
            )}

            <Notice success={message.includes("confirmed") || message.includes("ready")}>
              {message}
            </Notice>

            <button disabled={busy} className="submit-btn">
              {busy
                ? paymentStep === "verifying"
                  ? "Verifying Razorpay payment…"
                  : paymentStep === "checkout"
                  ? "Opening Razorpay checkout…"
                  : "Please wait…"
                : challengeId
                ? isPaidEvent
                  ? `Proceed to Pay ${formatRupees(event.price)}`
                  : "Complete Free Booking"
                : "Verify Email & Proceed"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function TicketCard({ ticket, event }) {
  const isPaid = ticket.pricePaid && Number(ticket.pricePaid) > 0;

  return (
    <article className="ticket">
      <div className="success">
        ✓ Ticket Confirmed ·{" "}
        {ticket.emailSent ? "QR ticket emailed to you" : "Save this ticket reference"}
      </div>

      <div className="ticket-grid">
        <div>
          <p className="eyebrow">YOUR DIGITAL PASS</p>
          <h2>{event.name}</h2>

          <dl>
            <dt>Attendee</dt>
            <dd>{ticket.attendeeName}</dd>

            <dt>Venue</dt>
            <dd>{event.venue || "Venue TBA"}</dd>

            <dt>Date</dt>
            <dd>{apiDate(event.date)}</dd>

            <dt>Ticket ID</dt>
            <dd className="mono font-bold">{ticket.ticketId}</dd>

            {isPaid && (
              <>
                <dt>Price Paid</dt>
                <dd className="font-bold">{formatRupees(ticket.pricePaid)}</dd>

                {ticket.paymentId && (
                  <>
                    <dt>Payment ID</dt>
                    <dd className="mono">{ticket.paymentId}</dd>
                  </>
                )}
              </>
            )}

            <dt>Status</dt>
            <dd>
              <Status value={ticket.status} />
            </dd>
          </dl>
        </div>

        <div className="display-qr">
          <QRCodeSVG value={ticket.ticketId} size={150} />
          <small>Show this QR code at the event gate for check-in entry.</small>
        </div>
      </div>
    </article>
  );
}

function ManageTicket({ initialId }) {
  const [id, setId] = useState(initialId);
  const [ticket, setTicket] = useState(null);
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const result = await getTicket(id);
      setTicket(result);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestCode() {
    setBusy(true);
    setMessage("");

    try {
      await requestCancellationCode(id);
      setRequested(true);
      setMessage("A 6-digit cancellation code has been sent to your registered email address.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const result = await verifyCancellationCode(id, code);

      setTicket((current) => ({
        ...current,
        ...result,
        status: "CANCELLED",
      }));

      setMessage(result.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const cancellable =
    ticket && !["CANCELLED", "CHECKED_IN"].includes(ticket.status);

  return (
    <div className="site">
      <header className="simple-header">
        <a href="/">← EventPass</a>
      </header>

      <main className="container manage">
        <p className="eyebrow">TICKET MANAGEMENT</p>
        <h1>Manage your ticket</h1>
        <p className="muted">
          Enter your Ticket ID to check booking status, entry QR, or initiate cancellation and refund.
        </p>

        <form className="lookup" onSubmit={load}>
          <input
            required
            placeholder="Enter Ticket ID (UUID)"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <button disabled={busy}>View ticket</button>
        </form>

        <Notice success={message.includes("successfully") || message.includes("confirmed")}>
          {message}
        </Notice>

        {ticket && (
          <article className="ticket">
            <div className="heading">
              <div>
                <p className="eyebrow">BOOKING DETAILS</p>
                <h2>{ticket.eventName || "Event"}</h2>
              </div>
              <Status value={ticket.status} />
            </div>

            <dl>
              <dt>Attendee</dt>
              <dd>{ticket.attendeeName}</dd>

              <dt>Venue</dt>
              <dd>{ticket.venue || "Venue TBA"}</dd>

              <dt>Date</dt>
              <dd>{apiDate(ticket.eventDate)}</dd>

              <dt>Ticket ID</dt>
              <dd className="mono font-bold">{ticket.ticketId}</dd>

              {ticket.pricePaid && Number(ticket.pricePaid) > 0 ? (
                <>
                  <dt>Amount Paid</dt>
                  <dd className="font-bold">{formatRupees(ticket.pricePaid)}</dd>

                  {ticket.paymentId && (
                    <>
                      <dt>Payment ID</dt>
                      <dd className="mono">{ticket.paymentId}</dd>
                    </>
                  )}

                  {ticket.refundStatus && ticket.refundStatus !== "NONE" && (
                    <>
                      <dt>Refund Status</dt>
                      <dd>
                        <span className="refund-tag">{ticket.refundStatus}</span>
                        {ticket.refundAmount ? ` (${formatRupees(ticket.refundAmount)})` : ""}
                      </dd>
                    </>
                  )}
                </>
              ) : (
                <>
                  <dt>Price</dt>
                  <dd>Free Registration</dd>
                </>
              )}
            </dl>

            {cancellable && (
              <div className="cancel">
                <h3>Cancel this reservation</h3>
                <p className="muted">
                  {ticket.pricePaid && Number(ticket.pricePaid) > 0
                    ? "Paid ticket cancellations will automatically initiate a full refund to your original payment method via Razorpay."
                    : "Cancelling releases your spot for other attendees."}
                </p>

                {requested ? (
                  <form onSubmit={cancel}>
                    <label>
                      Cancellation OTP (6 digits)
                      <input
                        required
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength="6"
                        placeholder="Enter 6-digit OTP from email"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </label>

                    <button disabled={busy} className="danger-btn">
                      Confirm Cancellation & Refund
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={requestCode}
                    disabled={busy}
                    className="ghost text-danger"
                  >
                    Request Cancellation Code
                  </button>
                )}
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);