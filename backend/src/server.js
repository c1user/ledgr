import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "ledgr" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(process.env.PORT, () => {
  console.log(`Ledgr API running on port ${process.env.PORT}`);
});
