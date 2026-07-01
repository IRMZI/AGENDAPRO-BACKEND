-- Torna waha_session_id único globalmente. O webhook resolve a sessão só pelo
-- waha_session_id (sem company_id), então essa unicidade evita que um evento
-- seja atribuído à empresa errada. Já verificado: sem duplicatas em produção.
-- Aplicado direto no banco (o DATABASE_URL usa o pooler do Neon, que não suporta
-- `prisma migrate deploy`). IF NOT EXISTS torna a aplicação idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS "app_fd14ee28a1_whatsapp_sessions_waha_session_id_key"
  ON "app_fd14ee28a1_whatsapp_sessions"("waha_session_id");
