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

  // Schedulers de fundo. Um ÚNICO tick acorda o banco, de propósito: o Neon
  // suspende o compute depois de N segundos ocioso, e toda passada que consulta
  // o banco custa no mínimo essa janela inteira de compute ligado. Dois
  // setInterval independentes abririam duas janelas por ciclo, então o ciclo de
  // vida do trial pega carona no tick dos lembretes em vez de ter o seu.
  //
  // O intervalo também não pode ficar abaixo do timeout de suspensão do Neon:
  // nesse caso o tick reseta o relógio do autosuspend antes de ele vencer e o
  // compute nunca dorme (era o caso com o antigo default de 5 min).
  if (process.env.NODE_ENV !== "test") {
    const intervalMs = Number(
      process.env.BOOKING_REMINDER_INTERVAL_MS || 30 * 60_000,
    );

    // Lembretes de agendamento por WhatsApp. Cada empresa controla o opt-in
    // (template booking_reminder ativo) e a janela (reminder_hours_before).
    // Idempotente via booking.reminder_sent_at. Como a janela é medida em
    // horas, atrasar a passada em dezenas de minutos não muda o que o cliente
    // recebe.
    const runReminders = async () => {
      try {
        const sent = await runBookingReminders();
        // eslint-disable-next-line no-console
        if (sent > 0) console.log(`[reminder] ${sent} lembrete(s) enviado(s)`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[reminder] tick falhou:", err);
      }
    };

    // Ciclo de vida do teste grátis: avisa 1 dia antes, expira/bloqueia no
    // vencimento e re-tenta links de acesso que não foram entregues.
    // Idempotente (trial_warning_sent_at + compare-and-set no status). A
    // granularidade do trial é dia, então roda a cada N passadas — N derivado
    // de TRIAL_LIFECYCLE_INTERVAL_MS para a env antiga continuar valendo.
    const trialIntervalMs = Number(
      process.env.TRIAL_LIFECYCLE_INTERVAL_MS || 60 * 60_000,
    );
    const trialEveryTicks = Math.max(
      1,
      Math.round(trialIntervalMs / intervalMs),
    );
    const runTrial = async () => {
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

    let ticks = 0;
    const tick = async () => {
      // Sequencial, não em paralelo: as duas tarefas compartilham a mesma
      // janela de compute e nada aqui é sensível a latência.
      await runReminders();
      if (ticks % trialEveryTicks === 0) await runTrial();
      ticks++;
    };

    setInterval(tick, intervalMs);
    setTimeout(tick, 15_000); // primeira passada logo após subir
  }
});
