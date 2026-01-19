# TicketBari Server 🚌🚢

The backend engine for **TicketBari**, a comprehensive MERN-stack online ticket booking platform. This server handles authentication, role-based access control (RBAC), secure payments, and real-time seat management.

## 🚀 Key Features
- **RESTful API Architecture:** Clean and structured endpoints for tickets, bookings, and users.
- **Secure Authentication:** Integrated with Firebase Admin SDK and JWT for session management.
- **Role-Based Access Control:** Separate permissions for Admins, Vendors, and Customers.
- **Payment Integration:** Secure transaction processing via Stripe API.
- **Data Integrity:** MongoDB unique indexing to prevent double-booking of seats.

## 🛠️ Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB
- **Auth:** Firebase Admin / JWT
- **Payments:** Stripe

## 📦 Installation
1. Clone the repo: `git clone https://github.com/farial-robama/TicketBari-Server.git`
2. Install dependencies: `npm install`
3. Create a `.env` file (see `.env.example`)
4. Start the server: `npm start`