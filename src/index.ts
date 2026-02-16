import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

// --- Import Controllers ---
import { cmuCallback } from "./controllers/authController";

// --- Import Routes ---
import authRoutes from "./routes/authRoutes";
import userRoutes from './routes/userRoutes';
import caseRoutes from './routes/caseRoutes';
import bookingRoutes from './routes/bookingRoutes';
import clientProfileRoutes from './routes/clientProfileRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---
app.use("/api/auth", authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api', bookingRoutes);
app.use('/api/client', clientProfileRoutes);

// --- Special Routes / Callbacks ---
app.get("/cmuEntraIDCallback", cmuCallback);

app.get("/", (req: Request, res: Response) => {
  res.send("Entaneer Mind Backend is Running! 🚀");
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
