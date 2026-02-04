-- Script para otimização da performance da busca de clientes
-- Execute se a busca estiver lenta

-- Verificar se existe índice no company_id
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef 
FROM pg_indexes 
WHERE tablename = 'app_fd14ee28a1_clients' 
  AND indexdef LIKE '%company_id%';

-- Criar índice composto para otimizar busca por company_id + nome
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_company_name 
ON app_fd14ee28a1_clients (company_id, LOWER(name));

-- Criar índice para busca por telefone normalizado
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_company_phone 
ON app_fd14ee28a1_clients (company_id, REGEXP_REPLACE(phone, '[^0-9]', '', 'g'));

-- Verificar estatísticas da tabela
SELECT 
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_live_tup as live_rows,
    n_dead_tup as dead_rows,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables 
WHERE relname = 'app_fd14ee28a1_clients';

-- Analisar distribuição de dados por company_id
SELECT 
    company_id,
    COUNT(*) as total_clients
FROM app_fd14ee28a1_clients 
GROUP BY company_id 
ORDER BY total_clients DESC 
LIMIT 10;