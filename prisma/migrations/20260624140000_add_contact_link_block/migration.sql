-- Flag para desvincular de verdade: quando o usuário remove o vínculo de um
-- contato, marcamos para o match automático por telefone não re-vincular.
ALTER TABLE "app_fd14ee28a1_wa_contacts"
  ADD COLUMN "client_link_blocked" BOOLEAN NOT NULL DEFAULT false;
