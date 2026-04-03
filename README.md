<div align="center">

# 🎫 TicketBari — Server

**REST API backend for the TicketBari ticket booking platform**

[![Client Repo](https://img.shields.io/badge/Client_Repo-TicketBari--Client-6c47ff?style=flat-square)](https://github.com/farial-robama/TicketBari-Client)
[![Live API](https://img.shields.io/badge/API-Vercel-000000?style=flat-square&logo=vercel)](https://ticket-bari-online-ticket-booking-p.vercel.app)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)

</div>

---

## Overview

This is the Express.js + MongoDB backend for [TicketBari](https://github.com/farial-robama/TicketBari-Client). It handles authentication, ticket management, bookings, payments, and user roles.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js + Express.js | Server and REST API |
| MongoDB + Mongoose | Database |
| Firebase Admin SDK | JWT token verification |
| Stripe API | Payment processing |
| JWT | Auth tokens |
| CORS | Cross-origin handling |

---

## Project Structure
```
TicketBari-Server/
├── index.js              # Entry point — all routes and middleware
├── vercel.json           # Vercel deployment config
├── serviceKeyConverter.js # Firebase key format utility
├── .env                  # Local environment variables (not committed)
├── .env.example          # Environment variable template ✅
├── .gitignore
└── package.json
```

---

## Getting Started

### Prerequisites
- Node.js v18+
- MongoDB Atlas account
- Stripe account
- Firebase project (Admin SDK)

### Setup
```bash
git clone https://github.com/farial-robama/TicketBari-Server.git
cd TicketBari-Server
npm install
cp .env.example .env
# Fill in your values in .env
npm start
```

Server runs at `http://localhost:5000`

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

| Variable | Description |
|---|---|
| `PORT` | Server port (default: `5000`) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `CLIENT_DOMAIN` | Frontend URL for CORS |
| `FB_SERVICE_KEY` | Firebase service account JSON encoded as base64 |
| `STRIPE_SECRET_KEY` | Stripe secret key |

---

## API Reference

Base URL: `https://ticket-bari-online-ticket-booking-p.vercel.app`

For full API documentation, see the [Client Repository README](https://github.com/farial-robama/TicketBari-Client#-api-reference).

<!-- ---

## License

[MIT](LICENSE) -->

---

<div align="center">

Made with ❤️ in Bangladesh · [Client Repo](https://github.com/farial-robama/TicketBari-Client)

</div>