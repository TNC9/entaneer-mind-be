import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import userRoutes from './routes/userRoutes';
import bookingRoutes from './routes/bookingRoutes';
import studentProfileRoutes from './routes/studentProfileRoutes';
import { cmuCallback } from "./controllers/authController";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', bookingRoutes);
app.use('/api/student', studentProfileRoutes);

app.get("/cmuEntraIDCallback", cmuCallback);

app.get("/", (req: Request, res: Response) => {
  res.send("Entaneer Mind Backend is Running! 🚀");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
