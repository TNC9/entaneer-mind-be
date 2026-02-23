import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";

// --- Import Controllers ---
import { cmuCallback } from "./controllers/authController";

// --- Import Routes ---
import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import caseRoutes from "./routes/caseRoutes";
import bookingRoutes from "./routes/bookingRoutes";
import clientProfileRoutes from "./routes/clientProfileRoutes";
import counselorRoutes from './routes/counselorRoutes';
import problemTagRoutes from "./routes/problemTagRoutes";
import sessionRoutes from "./routes/sessionRoutes";
import sessionPortalRoutes from "./routes/sessionPortalRoutes";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// ✅ CORS: allow your frontend origin (3001) and common dev origins
const allowedOrigins = [
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // allow requests without origin (Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-cmu-account"],
};

// ✅ IMPORTANT: CORS must be before routes
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());

// ==========================================
//                 API Routes
// ==========================================
// 1. ฝั่งผู้ใช้งานทั่วไป & Auth
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/client", clientProfileRoutes);

// 2. ฝั่ง Booking / Room / Session
app.use("/api/bookings", bookingRoutes);
app.use("/api/session-portal", sessionPortalRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/problem-tags", problemTagRoutes);

// 3. ฝั่ง Counselor & Reports
app.use(counselorRoutes);

// ==========================================
//         Special Routes / Callbacks
// ==========================================
app.get("/cmuEntraIDCallback", cmuCallback);

// --- Health Check ---
app.get("/", (_req: Request, res: Response) => {
  res.send("Entaneer Mind Backend is Running! 🚀");
});

// ✅ Generic error handler (last)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});