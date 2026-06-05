import { PrismaClient } from "@prisma/client";

const isDev = process.env.NODE_ENV !== "production";

export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" },
  ],
});

prisma.$on("error", (e) => {
  // eslint-disable-next-line no-console
  console.error("[PRISMA error]", {
    message: e.message,
    target: e.target,
    timestamp: e.timestamp,
  });
});

if (isDev) {
  prisma.$on("warn", (e) => {
    // eslint-disable-next-line no-console
    console.warn("[PRISMA warn]", {
      message: e.message,
      target: e.target,
    });
  });
}
