import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import { cmuCallback } from "./controllers/authController";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 2. ใช้งาน Route ที่เราเพิ่งสร้าง
app.use("/api/auth", authRoutes);

app.get("/cmuEntraIDCallback", cmuCallback);

app.get("/", (req: Request, res: Response) => {
  res.send("Entaneer Mind Backend is Running! 🚀");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
