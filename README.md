# InvoSync Backend

InvoSync is a high-performance, real-time backend API designed for comprehensive invoicing, inventory management, customer tracking, and financial ledgers. Built with Node.js, Express, TypeScript, and MongoDB, it guarantees robust and reliable operations with lightning-fast response times.

## 🚀 Performance Highlight
**All API endpoints are optimized to return within 300ms.** 
The architecture heavily utilizes asynchronous processing, background workers (BullMQ + Redis), and optimized database queries to ensure a snappy user experience even under load.

### `createBill` Enhancement (Showcase Feature)
The `createBill` API is a prime example of our performance-first architecture, separating concerns into strictly synchronous and asynchronous flows:

- **Synchronous Logic (Critical Path):** 
  Executes in a single, atomic MongoDB ACID Transaction. It handles finding previous IDs, validating current stock accurately, generating the new Bill, processing the Payment Transaction, and updating the Customer's outstanding balance. This guarantees data integrity without holding up the response.
- **Asynchronous Logic (Non-Blocking):** 
  Once the DB transaction commits, the API immediately returns a success response. Any non-critical tasks are offloaded to background queues using **BullMQ** and event emitters. This includes:
  - Real-time `BILL_CREATED` broadcasting to clients via **Socket.io** + Redis Adapter.
  - Adding detailed records to the `journeyQueue` (for Customer History and global Audit Logs).
  - Triggers for category-specific notifications.

This separation drastically reduces user wait times, achieving near-instant UI feedback while ensuring all background tasks are reliably processed by separate workers.

---

## 📦 Core Modules & Features

### 1. 🧾 Invoicing & Billing (`/bill`, `/returnBill`)
- **Bill Creation:** Fast, idempotent generation of invoices.
- **Return Bills:** Process product returns, adjust customer balances, and revert stock seamlessly.
- **Bill Summaries & Reports:** Generate aggregated views for daily reports, profit calculations, and identifying peak volume hours.
- **Date Range & Product Filters:** Advanced filtering to look up bills via specific date ranges, product barcodes, and min/max amount caps.

### 2. 👥 Customer Management (`/customer`)
- **Customer Profiles:** Store essential client data (name, phone, routing data).
- **Outstanding Ledgers:** Automatically track and update customer balances based on purchases, payments, and returns.

### 3. 🛍️ Inventory & Products (`/product`, `/category`)
- **Product Catalog:** Manage products with precise pricing, stock counts, and hierarchical categories.
- **Barcode Integration:** Lookup and bill items rapidly using their barcode strings.
- **Stock Deductions:** Automated synchronization with billing to prevent negative stock.

### 4. 📈 Stock Management (`/stock`)
- **Stock Entries:** Document new stock arrivals efficiently.
- **Batch Processing:** Ability to process and update large volumes of product quantities natively.

### 5. 💳 Financial Ledgers (`/transaction`)
- **Transactions Management:** Track Payment In and Payment Out flows.
- **Automated Ledgering:** Tightly coupled with the billing system to record a cash inflow immediately upon a paid bill, or an outflow during returns.
- **Financial Status:** Provides a source-of-truth log for auditing cash movements.

### 6. 🔐 Auth, Users & ACL (`/user`, `/admin`)
- **Authentication:** Standardized JWT-based auth flow (`bcrypt` passwords).
- **Access Control Lists (ACL):** Robust role-based authorization to gate endpoints (e.g., locking down deletion APIs to Admins only).

### 7. ⏱️ Journeys & Audit Logging (`/journey`)
- **Customer Journey Logs:** A chronological history of every interaction a customer has with the store (Bills, Payments, Returns).
- **Global Audit Trail:** Offloaded safely to workers to log "who did what and when" without lagging main transaction flows.

### 8. 🔔 Real-time Notifications Setup (`/notification`)
- **Rule-based Alerts:** Configurable rules (e.g., notify if a bill includes items from a specific category).
- **Socket.io Streaming:** Instantly pushes dashboard alerts via WebSockets.

## 🛠️ Tech Stack
- **Framework:** Node.js (TypeScript), Express.js
- **Database:** MongoDB & Mongoose (Transactions, Aggregation Pipelines)
- **Caching & Brokers:** Redis, BullMQ (Job Queues), ioredis
- **Real-time:** Socket.io
- **Utilities:** Moment-tz (Timezones), Morgan (HTTP Logging), Helmet, Cors

---
**Maintained with ❤️ for rapid retail operations and robust financial accountability.**
