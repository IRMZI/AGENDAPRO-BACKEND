import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import { requestLogger, errorHandler } from "./middleware/logging.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Log customizado para debug
app.use(requestLogger);

// Morgan para log padrão
app.use(morgan("dev"));

app.use("/api", routes);

// Error handler deve ser o último middleware
app.use(errorHandler);

export default app;
