import { createServer } from "node:http";
import app from "./app.js";
import { initRealtime } from "./lib/realtime.js";
import { runBookingReminders } from "./services/bookingAutomationService.js";
import { runTrialLifecycle } from "./services/trialLifecycleService.js";

const port = Number(process.env.PORT) || 4000;

const httpServer = createServer(app);
initRealtime(httpServer);

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend rodando na porta ${port} (HTTP + Socket.IO)`);

  // Scheduler de lembretes de agendamento por WhatsApp. Tick periódico; cada
  // empresa controla o opt-in (template booking_reminder ativo) e a janela
  // (company.reminder_hours_before). Idempotente via booking.reminder_sent_at.
  if (process.env.NODE_ENV !== "test") {
    const intervalMs = Number(
      process.env.BOOKING_REMINDER_INTERVAL_MS || 5 * 60_000,
    );
    const tick = async () => {
      try {
        const sent = await runBookingReminders();
        // eslint-disable-next-line no-console
        if (sent > 0) console.log(`[reminder] ${sent} lembrete(s) enviado(s)`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[reminder] tick falhou:", err);
      }
    };
    setInterval(tick, intervalMs);
    setTimeout(tick, 15_000); // primeira passada logo após subir

    // Ciclo de vida do teste grátis: avisa 1 dia antes, expira/bloqueia no
    // vencimento e re-tenta links de acesso que não foram entregues.
    // Idempotente (trial_warning_sent_at + compare-and-set no status). De hora
    // em hora basta: a granularidade do trial é dia, não minuto.
    const trialIntervalMs = Number(
      process.env.TRIAL_LIFECYCLE_INTERVAL_MS || 60 * 60_000,
    );
    const trialTick = async () => {
      try {
        const { warned, expired, resent } = await runTrialLifecycle();
        // eslint-disable-next-line no-console
        if (warned || expired || resent)
          console.log(
            `[trial] ${warned} aviso(s), ${expired} expirado(s), ${resent} link(s) reenviado(s)`,
          );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[trial] tick falhou:", err);
      }
    };
    setInterval(trialTick, trialIntervalMs);
    setTimeout(trialTick, 30_000);
  }
});
