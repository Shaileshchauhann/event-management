import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import * as api from "./api/admin";
import "./styles.css";

const formatDate = (value) => (value ? new Date(value).toLocaleString() : "—");
const formatRupees = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Status({ value }) {
  return (
    <span className={`status status-${String(value).toLowerCase()}`}>
      {value}
    </span>
  );
}

function PriceBadge({ isPaid, price }) {
  const isPaidBool =
    isPaid === true ||
    String(isPaid).toLowerCase() === "true" ||
    isPaid === 1;
  const numPrice = Number(price || 0);
  const isPaidEvent = (isPaidBool && numPrice > 0) || numPrice > 0;
  const rupees = numPrice > 0 ? (numPrice / 100).toFixed(2) : "0.00";

  return isPaidEvent ? (
    <span className="price-badge paid">₹{rupees}</span>
  ) : (
    <span className="price-badge free">FREE</span>
  );
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      onLogin(await api.login(form.email, form.password));
    } catch (err) {
      setError(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrapper">
      <div className="login-card">
        <div className="login-brand-header">
          <div className="login-icon-badge">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
          </div>
          <span className="eyebrow">EVENT CONTROL CENTER</span>
          <h1 className="login-title">Admin Portal</h1>
          <p className="login-subtitle">
            Sign in to manage events, ticket capacity, live gate verifications, and financial analytics.
          </p>
        </div>

        <form onSubmit={submit} className="login-form">
          <label className="login-label">
            <span>Email Address</span>
            <div className="input-with-icon">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
              <input
                type="email"
                required
                placeholder="admin@eventhub.com"
                className="login-input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoComplete="email"
              />
            </div>
          </label>

          <label className="login-label">
            <span>Password</span>
            <div className="input-with-icon">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                type={showPassword ? "text" : "password"}
                required
                placeholder="••••••••••••"
                className="login-input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="toggle-password-btn"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? "Hide password" : "Show password"}
                tabIndex="-1"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                    <line x1="2" x2="22" y1="2" y2="22"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </label>

          {error && (
            <div className="login-error-alert" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" x2="12" y1="8" y2="12"/>
                <line x1="12" x2="12.01" y1="16" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <button className="login-submit-btn" disabled={loading}>
            {loading ? (
              <span className="btn-loading-content">
                <span className="spinner-icon"></span>
                Signing in…
              </span>
            ) : (
              "Sign in to Dashboard →"
            )}
          </button>
        </form>

        <div className="login-footer-hint">
          <span>Protected by AWS KMS HMAC & Cognito/IAM Security</span>
        </div>
      </div>
    </main>
  );
}

function Dashboard({ session, logout }) {
  const [activeTab, setActiveTab] = useState("events"); // 'events' | 'analytics' | 'transactions'
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const token = session.token;

  async function load() {
    try {
      const list = await api.listEvents(token);
      setEvents(list);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function selectEvent(event) {
    setSelected(event);
    try {
      const [s, t] = await Promise.all([
        api.getStats(token, event.eventId),
        api.listTickets(token, event.eventId),
      ]);
      setStats(s);
      setTickets(t);
    } catch (e) {
      setError(e.message);
    }
  }

  async function action(fn, id) {
    try {
      await fn(token, id);
      if (selected) await selectEvent(selected);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  const filteredTickets = useMemo(
    () =>
      tickets.filter((t) =>
        `${t.attendeeName} ${t.attendeeEmail} ${t.ticketId} ${t.status} ${t.paymentId || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [tickets, search]
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <p className="eyebrow">EVENT CONTROL</p>
          <h1>Operations Dashboard</h1>
          <nav className="tab-nav">
            <button
              className={`tab-btn ${activeTab === "events" ? "active" : ""}`}
              onClick={() => setActiveTab("events")}
            >
              📅 Events
            </button>
            <button
              className={`tab-btn ${activeTab === "analytics" ? "active" : ""}`}
              onClick={() => setActiveTab("analytics")}
            >
              📊 Analytics
            </button>
            <button
              className={`tab-btn ${activeTab === "transactions" ? "active" : ""}`}
              onClick={() => setActiveTab("transactions")}
            >
              💳 Transactions
            </button>
          </nav>
        </div>
        <div className="top-actions">
          <span className="muted">
            {session.admin?.name || session.admin?.email}
          </span>
          <button className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="content">
        {error && <div className="error">{error}</div>}

        {activeTab === "events" && (
          <section className="events-view">
            <div className="toolbar">
              <div>
                <h2>Your Events</h2>
                <p className="muted">
                  Create, configure pricing, and inspect real-time registrations.
                </p>
              </div>
              <button onClick={() => setShowCreate(true)}>+ Create Event</button>
            </div>

            <section className="event-grid">
              {events.map((event) => (
                <button
                  className={`event-card ${selected?.eventId === event.eventId ? "selected" : ""}`}
                  key={event.eventId}
                  onClick={() => selectEvent(event)}
                >
                  <div className="card-top">
                    <span className="event-date">{formatDate(event.date)}</span>
                    <PriceBadge isPaid={event.isPaid} price={event.price} />
                  </div>
                  <h3>{event.name}</h3>
                  <p>{event.venue || "Venue not specified"}</p>
                  <div className="event-footer">
                    <Status value={event.status} />
                    <span>
                      {event.ticketsIssued} / {event.capacity ?? "∞"} issued
                    </span>
                  </div>
                </button>
              ))}
            </section>

            {selected && (
              <section className="detail">
                <div className="toolbar">
                  <div>
                    <p className="eyebrow">EVENT DETAIL</p>
                    <h2>{selected.name}</h2>
                    <p className="muted">
                      {selected.venue || "Venue TBA"} · {formatDate(selected.date)}
                    </p>
                  </div>
                  <div className="detail-actions">
                    <PriceBadge isPaid={selected.isPaid} price={selected.price} />
                    <Status value={selected.status} />
                    <button
                      className="ghost"
                      onClick={() => setShowEdit(true)}
                    >
                      ✏️ Edit Event
                    </button>
                  </div>
                </div>

                {stats && (
                  <div className="stats">
                    <div className="stat">
                      <span>Active tickets</span>
                      <strong>{stats.activeValidTickets}</strong>
                    </div>
                    <div className="stat">
                      <span>Checked in</span>
                      <strong>{stats.breakdown.checkedIn}</strong>
                    </div>
                    <div className="stat">
                      <span>Cancelled</span>
                      <strong>{stats.breakdown.cancelled}</strong>
                    </div>
                    <div className="stat">
                      <span>Remaining</span>
                      <strong>{stats.remainingCapacity ?? "∞"}</strong>
                    </div>
                  </div>
                )}

                <div className="ticket-toolbar">
                  <h3>Tickets & Bookings</h3>
                  <input
                    placeholder="Search name, email, ticket ID, status..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Attendee</th>
                        <th>Ticket ID</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th>Issued</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTickets.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="empty-cell">
                            No tickets found for this event.
                          </td>
                        </tr>
                      ) : (
                        filteredTickets.map((ticket) => (
                          <tr key={ticket.ticketId}>
                            <td>
                              <strong>{ticket.attendeeName}</strong>
                              <small>{ticket.attendeeEmail}</small>
                            </td>
                            <td className="mono">{ticket.ticketId}</td>
                            <td>
                              <Status value={ticket.status} />
                            </td>
                            <td>
                              {ticket.pricePaid && ticket.pricePaid > 0 ? (
                                <div>
                                  <strong>₹{(ticket.pricePaid / 100).toFixed(2)}</strong>
                                  {ticket.refundStatus === "REFUNDED" ? (
                                    <small className="refund-tag">REFUNDED</small>
                                  ) : (
                                    <small className="mono">{ticket.paymentId || "PAID"}</small>
                                  )}
                                </div>
                              ) : (
                                <span className="free-tag">Free</span>
                              )}
                            </td>
                            <td>{formatDate(ticket.issuedAt || ticket.createdAt)}</td>
                            <td>
                              <button
                                className="small"
                                disabled={
                                  ticket.status === "CANCELLED" ||
                                  ticket.status === "CHECKED_IN"
                                }
                                onClick={() => action(api.cancelTicket, ticket.ticketId)}
                              >
                                Cancel
                              </button>
                              <button
                                className="small ghost"
                                disabled={ticket.status === "CANCELLED"}
                                onClick={() => action(api.resendTicket, ticket.ticketId)}
                              >
                                Resend
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </section>
        )}

        {activeTab === "analytics" && (
          <AnalyticsView token={token} events={events} onSelectEvent={(e) => {
            setSelected(e);
            setActiveTab("events");
            selectEvent(e);
          }} />
        )}

        {activeTab === "transactions" && (
          <TransactionsView token={token} events={events} />
        )}
      </main>

      {showCreate && (
        <CreateModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {showEdit && selected && (
        <EditModal
          token={token}
          event={selected}
          onClose={() => setShowEdit(false)}
          onUpdated={(updated) => {
            setShowEdit(false);
            setSelected(updated);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function CreateModal({ token, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    venue: "",
    date: "",
    capacity: "",
    isPaid: false,
    price: "",
    currency: "INR",
    salesStart: "",
    salesEnd: "",
    maxTicketsPerUser: "1",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (form.isPaid && (!form.price || Number(form.price) <= 0)) {
        throw new Error("Please enter a valid ticket price greater than 0 for paid events.");
      }

      await api.createEvent(token, {
        name: form.name,
        venue: form.venue || undefined,
        date: form.date,
        capacity: form.capacity || undefined,
        isPaid: form.isPaid,
        price: form.isPaid ? Number(form.price) : 0,
        currency: form.currency,
        salesStart: form.salesStart || undefined,
        salesEnd: form.salesEnd || undefined,
        maxTicketsPerUser: form.maxTicketsPerUser ? parseInt(form.maxTicketsPerUser, 10) : 1,
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <div className="toolbar">
          <h2>Create New Event</h2>
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <label>
          Event Name *
          <input
            required
            type="text"
            placeholder="e.g. Annual Tech Conference 2026"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>

        <label>
          Venue
          <input
            type="text"
            placeholder="e.g. Grand Ballroom, Silicon Hub"
            value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
          />
        </label>

        <label>
          Date and Time *
          <input
            required
            type="datetime-local"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>

        <label>
          Total Capacity (Spots)
          <input
            type="number"
            min="1"
            placeholder="e.g. 150 (Leave blank for open capacity)"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          />
        </label>

        <div className="pricing-box">
          <div className="pricing-header">
            <strong>Event Ticketing & Pricing</strong>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={form.isPaid}
                onChange={(e) => setForm({ ...form, isPaid: e.target.checked })}
              />
              <span>Paid Event (Razorpay)</span>
            </label>
          </div>

          {form.isPaid ? (
            <div className="paid-fields">
              <label>
                Ticket Price (₹ INR) *
                <input
                  required
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="e.g. 499.00"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </label>

              <div className="grid-2">
                <label>
                  Sales Start (Optional)
                  <input
                    type="datetime-local"
                    value={form.salesStart}
                    onChange={(e) => setForm({ ...form, salesStart: e.target.value })}
                  />
                </label>
                <label>
                  Sales End (Optional)
                  <input
                    type="datetime-local"
                    value={form.salesEnd}
                    onChange={(e) => setForm({ ...form, salesEnd: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ) : (
            <p className="free-info">
              ✓ Free event: Attendees will receive their tickets instantly upon email OTP verification.
            </p>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button disabled={loading}>
            {loading ? "Creating…" : "Create Event"}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditModal({ token, event, onClose, onUpdated }) {
  const [form, setForm] = useState({
    name: event.name || "",
    venue: event.venue || "",
    date: event.date ? event.date.slice(0, 16) : "",
    capacity: event.capacity ?? "",
    isPaid: Boolean(
      event.isPaid === true ||
      String(event.isPaid).toLowerCase() === "true" ||
      Number(event.price) > 0
    ),
    price: event.price && Number(event.price) > 0 ? (Number(event.price) / 100).toString() : "",
    status: event.status || "ACTIVE",
    salesStart: event.salesStart ? event.salesStart.slice(0, 16) : "",
    salesEnd: event.salesEnd ? event.salesEnd.slice(0, 16) : "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (form.isPaid && (!form.price || Number(form.price) <= 0)) {
        throw new Error("Ticket price must be greater than 0 for paid events.");
      }

      const updated = await api.updateEvent(token, event.eventId, {
        name: form.name,
        venue: form.venue || undefined,
        date: form.date,
        capacity: form.capacity === "" ? null : Number(form.capacity),
        isPaid: form.isPaid,
        price: form.isPaid ? Number(form.price) : 0,
        status: form.status,
        salesStart: form.salesStart || undefined,
        salesEnd: form.salesEnd || undefined,
      });
      onUpdated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <div className="toolbar">
          <h2>Edit Event Details</h2>
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <label>
          Event Name *
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>

        <label>
          Venue
          <input
            value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
          />
        </label>

        <label>
          Date and Time *
          <input
            required
            type="datetime-local"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>

        <div className="grid-2">
          <label>
            Capacity (Spots)
            <input
              type="number"
              min="1"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </label>
          <label>
            Event Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAUSED">PAUSED</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </label>
        </div>

        <div className="pricing-box">
          <div className="pricing-header">
            <strong>Event Ticketing & Pricing</strong>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={form.isPaid}
                onChange={(e) => setForm({ ...form, isPaid: e.target.checked })}
              />
              <span>Paid Event</span>
            </label>
          </div>

          {form.isPaid && (
            <div className="paid-fields">
              <label>
                Ticket Price (₹ INR) *
                <input
                  required
                  type="number"
                  step="0.01"
                  min="1"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </label>
              <small className="muted">
                Note: Updating the event price will only apply to future ticket purchases. Existing issued tickets preserve their recorded purchase price.
              </small>
            </div>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button disabled={loading}>
            {loading ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AnalyticsView({ token, events, onSelectEvent }) {
  const [range, setRange] = useState("30d");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAnalytics(token, {
        range,
        eventId: selectedEventId || undefined,
      });
      setAnalytics(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [range, selectedEventId]);

  const kpis = analytics?.kpis || {};
  const timeline = analytics?.timeline || [];
  const eventPerf = analytics?.eventPerformance || [];

  const maxRevenueInTimeline = Math.max(...timeline.map((t) => t.revenue || 0), 1);

  return (
    <div className="analytics-section">
      <div className="toolbar analytics-toolbar">
        <div>
          <h2>Sales & Registration Analytics</h2>
          <p className="muted">
            Derived directly from verified server-side transactions & tickets.
          </p>
        </div>

        <div className="filter-controls">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            <option value="">All Events</option>
            {events.map((ev) => (
              <option key={ev.eventId} value={ev.eventId}>
                {ev.name}
              </option>
            ))}
          </select>

          <div className="range-pills">
            {["today", "7d", "30d", "90d", "all"].map((r) => (
              <button
                key={r}
                className={`range-pill ${range === r ? "active" : ""}`}
                onClick={() => setRange(r)}
              >
                {r === "all" ? "All Time" : r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading analytics data…</div>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <section className="kpi-grid">
            <div className="kpi-card highlight">
              <span className="kpi-label">Gross Sales</span>
              <strong className="kpi-value">{formatRupees(kpis.grossSales)}</strong>
              <small className="muted">Total value of completed purchases</small>
            </div>

            <div className="kpi-card danger">
              <span className="kpi-label">Total Refunds</span>
              <strong className="kpi-value">{formatRupees(kpis.totalRefunds)}</strong>
              <small className="muted">Confirmed refunds returned</small>
            </div>

            <div className="kpi-card success">
              <span className="kpi-label">Net Ticket Revenue</span>
              <strong className="kpi-value">{formatRupees(kpis.netRevenue)}</strong>
              <small className="muted">Gross sales minus confirmed refunds</small>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Tickets Sold</span>
              <strong className="kpi-value">{kpis.totalTicketsSold || 0}</strong>
              <small className="muted">Active valid attendee passes</small>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Average Order Value</span>
              <strong className="kpi-value">{formatRupees(kpis.averageOrderValue)}</strong>
              <small className="muted">Per successful paid order</small>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Total Registrations</span>
              <strong className="kpi-value">{kpis.totalRegistrations || 0}</strong>
              <small className="muted">Active + cancelled cohorts</small>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Cancellation Rate</span>
              <strong className="kpi-value">{kpis.cancellationRate || 0}%</strong>
              <small className="muted">{kpis.cancelledRegistrations || 0} cancelled total</small>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Refund Rate</span>
              <strong className="kpi-value">{kpis.refundRate || 0}%</strong>
              <small className="muted">Refunds vs Gross Sales</small>
            </div>
          </section>

          {/* Interactive Timeline Chart */}
          <section className="chart-card">
            <div className="chart-header">
              <div>
                <h3>Revenue & Ticket Sales Trend</h3>
                <p className="muted">Daily revenue and ticket generation volume</p>
              </div>
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-color rev" /> Revenue (₹)</span>
                <span className="legend-item"><span className="legend-color tkt" /> Tickets Sold</span>
              </div>
            </div>

            <div className="chart-body">
              {timeline.length === 0 ? (
                <div className="empty-chart">No transaction records in this period.</div>
              ) : (
                <div className="bar-chart-container">
                  {timeline.map((item) => {
                    const heightPercent = Math.min(100, Math.round((item.revenue / maxRevenueInTimeline) * 100));
                    return (
                      <div className="chart-bar-col" key={item.date} title={`${item.date}: ₹${item.revenue} (${item.tickets} tickets)`}>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{ height: `${Math.max(6, heightPercent)}%` }}
                          />
                        </div>
                        <span className="bar-label">{item.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Event-Wise Performance Table */}
          <section className="table-card">
            <div className="chart-header">
              <div>
                <h3>Event-Wise Financial & Registration Performance</h3>
                <p className="muted">Click any event to drill down into its operations view</p>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Type</th>
                    <th>Price</th>
                    <th>Tickets Sold</th>
                    <th>Capacity Util.</th>
                    <th>Gross Sales</th>
                    <th>Refunds</th>
                    <th>Net Revenue</th>
                    <th>Cancel %</th>
                  </tr>
                </thead>
                <tbody>
                  {eventPerf.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="empty-cell">
                        No event data available.
                      </td>
                    </tr>
                  ) : (
                    eventPerf.map((ev) => (
                      <tr
                        key={ev.eventId}
                        className="clickable-row"
                        onClick={() => onSelectEvent(ev)}
                      >
                        <td>
                          <strong>{ev.name}</strong>
                          <small>{formatDate(ev.date)} · {ev.venue}</small>
                        </td>
                        <td>
                          <PriceBadge isPaid={ev.isPaid} price={ev.priceRupees * 100} />
                        </td>
                        <td>₹{ev.priceRupees.toFixed(2)}</td>
                        <td>
                          <strong>{ev.ticketsSold}</strong>
                          <small>{ev.totalRegistrations} total</small>
                        </td>
                        <td>
                          {ev.capacityUtilization !== null
                            ? `${ev.capacityUtilization}%`
                            : "Open"}
                        </td>
                        <td>₹{ev.grossSales.toFixed(2)}</td>
                        <td className={ev.refunds > 0 ? "text-danger" : ""}>
                          ₹{ev.refunds.toFixed(2)}
                        </td>
                        <td className="text-success">
                          <strong>₹{ev.netRevenue.toFixed(2)}</strong>
                        </td>
                        <td>{ev.cancellationRate}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TransactionsView({ token, events }) {
  const [payments, setPayments] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refundTarget, setRefundTarget] = useState(null);

  async function loadPayments() {
    setLoading(true);
    setError("");
    try {
      const res = await api.listPayments(token, {
        search,
        status: statusFilter,
      });
      setPayments(res.payments || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
  }, [search, statusFilter]);

  function exportCSV() {
    if (!payments.length) return;
    const headers = [
      "Order ID",
      "Payment ID",
      "Event Name",
      "Attendee Name",
      "Attendee Email",
      "Amount (INR)",
      "Method",
      "Status",
      "Refund Status",
      "Created At",
    ];

    const rows = payments.map((p) => [
      `"${p.orderId}"`,
      `"${p.paymentId || ""}"`,
      `"${p.eventName || ""}"`,
      `"${p.attendeeName || ""}"`,
      `"${p.attendeeEmail || ""}"`,
      p.amountRupees,
      `"${p.paymentMethod || "online"}"`,
      `"${p.status}"`,
      `"${p.refundStatus || "NONE"}"`,
      `"${p.createdAt}"`,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `razorpay_transactions_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="transactions-view">
      <div className="toolbar">
        <div>
          <h2>Payment Transactions</h2>
          <p className="muted">
            Real-time Razorpay order history, status reconciliation and refunds.
          </p>
        </div>
        <button className="ghost" onClick={exportCSV} disabled={!payments.length}>
          ⬇ Export to CSV
        </button>
      </div>

      <div className="filters-bar">
        <input
          placeholder="Search attendee, email, Order ID, Payment ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="PAID">PAID</option>
          <option value="REFUNDED">REFUNDED</option>
          <option value="FAILED">FAILED</option>
          <option value="CREATED">PENDING (CREATED)</option>
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order & Payment ID</th>
              <th>Attendee</th>
              <th>Event</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className="empty-cell">
                  Loading transactions…
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-cell">
                  No payment transactions found.
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.orderId}>
                  <td>
                    <div className="mono font-bold">{p.orderId}</div>
                    <small className="mono text-muted">{p.paymentId || "—"}</small>
                  </td>
                  <td>
                    <strong>{p.attendeeName}</strong>
                    <small>{p.attendeeEmail}</small>
                  </td>
                  <td>{p.eventName}</td>
                  <td>
                    <strong>₹{p.amountRupees.toFixed(2)}</strong>
                    <small>{p.paymentMethod || "online"}</small>
                  </td>
                  <td>
                    <Status value={p.status} />
                    {p.refundStatus === "REFUNDED" && (
                      <span className="refund-tag ml-1">REFUNDED</span>
                    )}
                  </td>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>
                    {p.status === "PAID" && p.refundStatus !== "REFUNDED" ? (
                      <button
                        className="small ghost text-danger"
                        onClick={() => setRefundTarget(p)}
                      >
                        Refund
                      </button>
                    ) : (
                      <span className="muted text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {refundTarget && (
        <RefundModal
          token={token}
          payment={refundTarget}
          onClose={() => setRefundTarget(null)}
          onRefunded={() => {
            setRefundTarget(null);
            loadPayments();
          }}
        />
      )}
    </div>
  );
}

function RefundModal({ token, payment, onClose, onRefunded }) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(payment.amountRupees.toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.refundPayment(token, payment.paymentId, {
        amount: Number(amount),
        reason: reason || "Admin initiated refund",
      });
      onRefunded();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <div className="toolbar">
          <h2>Process Razorpay Refund</h2>
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="muted">
          You are issuing a refund for payment <code>{payment.paymentId}</code> (
          {payment.attendeeName}).
        </p>

        <label>
          Refund Amount (₹ INR) *
          <input
            required
            type="number"
            step="0.01"
            max={payment.amountRupees}
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label>
          Reason for Refund
          <input
            placeholder="e.g. Customer cancellation request"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button disabled={loading} className="danger-btn">
            {loading ? "Processing…" : `Confirm Refund (₹${amount})`}
          </button>
        </div>
      </form>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() =>
    JSON.parse(localStorage.getItem("adminSession") || "null")
  );

  function login(value) {
    localStorage.setItem("adminSession", JSON.stringify(value));
    setSession(value);
  }

  function logout() {
    localStorage.removeItem("adminSession");
    setSession(null);
  }

  return session?.token ? (
    <Dashboard session={session} logout={logout} />
  ) : (
    <Login onLogin={login} />
  );
}

createRoot(document.getElementById("root")).render(<App />);
