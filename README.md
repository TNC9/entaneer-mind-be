# 🧠 Entaneer Mind - Backend API

Backend service for **Entaneer Mind**, a consultation booking system for CMU Engineering students. This system handles CMU OAuth authentication, slot management for counselors, and booking logic for students.

## 🛠 Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** PostgreSQL (Hosted on Neon.tech)
- **ORM:** Prisma
- **Authentication:** CMU OAuth & JWT

---

## 🚀 Getting Started (วิธีเริ่มใช้งาน)

### 1. Clone & Install
```bash
git clone [https://github.com/TNC9/entaneer-mind-be.git](https://github.com/TNC9/entaneer-mind-be.git)
cd entaneer-mind-be
npm install

```

### 2. Environment Setup (.env)

Create a `.env` file in the root directory and ask **Benz** for the secrets.
Your `.env` file should look like this:

```env
PORT=3000
DATABASE_URL="postgresql://..."
JWT_SECRET="secret..."
CMU_CLIENT_ID="..."
CMU_CLIENT_SECRET="..."
CMU_REDIRECT_URL="http://localhost:3000/..."

```

### 3. Database Setup (Prisma)

⚠️ **Important:** Run this command every time you pull new code or clone the repo.

```bash
npx prisma generate

```

*This command updates the Prisma Client to match our Database Schema.*

### 4. Run the Server

```bash
npm run dev

```

The server will start at `http://localhost:3000`

---

## 🗄️ Database Commands (Cheat Sheet)

| Command | Description |
| --- | --- |
| `npx prisma generate` | **Must Run!** Updates your node_modules to match the schema. |
| `npx prisma studio` | Opens a web GUI to view/edit database records (Mock data here). |
| `npx prisma db push` | **Caution!** Pushes changes from `schema.prisma` to the real DB. |

---

## 🌳 Branching Strategy (Sprint 1)

We are working on separate branches to avoid conflicts. Please checkout your branch:

* **Auth & Core System:**
  * Branch: `feature/auth-core`
  * Focus: CMU Login, Middleware, User Profile.


* **Admin & Counselor:**
  * Branch: `feature/admin-counselor`
  * Focus: Create Availability Slots, Promote Counselor, View Schedule.


* **Student Booking:**
  * Branch: `feature/student-booking`
  * Focus: Search Slots, Booking Action (Instant), Booking History.



---

## ⚙️ Key Features & Logic (Sprint 1)

1. **Instant Booking:**
   * Counselors create slots -> `Status: Available`.
   * Students book a slot -> `Status: Booked` (Immediate confirmation, no approval needed).


2. **Role-Based Access Control (RBAC):**
   * **Student:** Can book and view their own history.
   * **Counselor:** Can create slots and view their schedule.
   * **Admin:** Can promote users to counselors.


3. **Cancellation Policy:**
   * Bookings can be cancelled only if the time remaining is **> 24 hours**.



---

## 👥 Contributors

* **Thananchai Chaimanee:** System Architect & Authentication
* **Thadthon Prechamanasart:** Admin & Counselor Operations
* **Sirapob Yongmarnwong:** Student Booking Service

```
