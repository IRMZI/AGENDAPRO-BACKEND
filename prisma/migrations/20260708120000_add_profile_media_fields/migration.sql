-- Perfil público: avatar + botões sociais da atendente e miniatura por serviço.
-- Colunas aditivas e nullable (sem perda de dados).
ALTER TABLE "app_fd14ee28a1_attendants"
  ADD COLUMN "photo_url" TEXT,
  ADD COLUMN "whatsapp" TEXT,
  ADD COLUMN "instagram" TEXT,
  ADD COLUMN "maps_url" TEXT;

ALTER TABLE "app_fd14ee28a1_services"
  ADD COLUMN "image_url" TEXT;
