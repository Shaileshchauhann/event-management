# Event Ticket Verification & QR Code Validation Backend

Serverless backend built on AWS SAM: **API Gateway -> Lambda -> DynamoDB -> SES + Secrets Manager**.

Tickets are signed JWTs rendered as high-density QR codes and sent to attendees via AWS SES. Gate staff scan the QR code and submit the token to `/verify`, which performs an atomic conditional update in DynamoDB — guaranteeing single-use check-in even under high-concurrency race conditions.

---

## Key Features & Architecture

1. **Role-Based Separation**:
   - **Admin**: Authenticated with JWT session, creates/manages owned events, views attendee lists, inspects check-in metrics, cancels/resends tickets.
   - **Attendee**: Anonymous registration; browses active events, registers with name & email, receives email with attached single-use QR ticket.
   - **Gate Staff**: Submits scanned JWT & `gateId` to `/verify` for atomic check-in.
2. **Server-Side Ownership Enforcement**:
   - Every admin operation resolves `ticket → event → adminId` and strictly compares against the authenticated `adminId`.
   - Admin A cannot view, mutate, cancel, or resend tickets for Admin B's events.
3. **Atomic Capacity & Overbooking Protection**:
   - Uses DynamoDB conditional write (`ticketsIssued < capacity`) to reserve capacity atomically before ticket generation.
   - Returns HTTP 409 `Event is full` once capacity is reached.
4. **Secure Password & Token Handling**:
   - Admin passwords hashed using bcrypt (10 rounds).
   - JWT signing secrets retrieved securely from AWS Secrets Manager (cached in-memory per Lambda container).
   - Ticket JWTs are never exposed in public API responses.
5. **CORS Enabled**: Configured on API Gateway and Lambda for seamless frontend integration.

---

## Endpoints

### 1. Authentication (Admin)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/admin/register` | Bootstrap / Secret / Admin Bearer | Register an administrator account |
| POST | `/auth/admin/login` | None | Authenticate admin, returns JWT token |

### 2. Public (Attendee)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/events` or `/public/events` | None | Browse public active events |
| GET | `/events/{eventId}` or `/public/events/{eventId}` | None | View details of a specific event |
| POST | `/events/{eventId}/tickets` or `/public/events/{eventId}/tickets` | None | Register attendee & issue ticket |
| GET | `/tickets/{ticketId}` | None | Check ticket status (JWT stripped) |

### 3. Admin Operations (Requires `Authorization: Bearer <AdminToken>`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/events` or `/admin/events` | Admin Bearer | Create a new event |
| GET | `/admin/events` | Admin Bearer | List events owned by authenticated admin |
| GET | `/admin/events/{eventId}` | Admin Bearer | Get details of owned event |
| GET | `/admin/events/{eventId}/tickets` | Admin Bearer | List attendee tickets for owned event |
| GET | `/admin/events/{eventId}/stats` | Admin Bearer | View real-time check-in stats & gate breakdown |
| POST | `/tickets/{ticketId}/cancel` or `/admin/tickets/{ticketId}/cancel` | Admin Bearer | Cancel ticket (releases capacity) |
| POST | `/tickets/{ticketId}/resend` or `/admin/tickets/{ticketId}/resend` | Admin Bearer | Resend ticket QR email |

### 4. Gate Operations
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/verify` | Gate Key / Open | Verify scanned QR JWT and perform atomic check-in |

---

## Build & Deploy

```bash
# Install dependencies
npm install --prefix src

# Build SAM artifacts
sam build

# Deploy to AWS
sam deploy
```

---

## Local Automated Tests

```bash
node tests/test_backend.js
node tests/test_handlers_e2e.js
```

