import { prisma } from "../lib/prisma.js";

type ClientSearchResult = {
  id: string;
  company_id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export const searchClientsPublic = async (
  companyId: string,
  searchQuery: string,
): Promise<ClientSearchResult[]> => {
  const queryStart = Date.now();
  console.log('[CLIENT_SEARCH_SERVICE] 🏗️ Iniciando busca no banco:', {
    companyId,
    searchQuery: searchQuery?.substring(0, 50), // limita log para segurança
    searchQueryLength: searchQuery?.length
  });

  try {
    // Verificar conexão com o banco
    console.log('[CLIENT_SEARCH_SERVICE] 🔗 Verificando conexão com o banco...');
    await prisma.$queryRaw`SELECT 1`;
    console.log('[CLIENT_SEARCH_SERVICE] ✅ Conexão com o banco OK');

    // Verificar se a tabela existe
    console.log('[CLIENT_SEARCH_SERVICE] 📋 Verificando se tabela app_fd14ee28a1_clients existe...');
    const tableCheck = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'app_fd14ee28a1_clients'
      ) as exists;
    `;
    
    if (!tableCheck[0]?.exists) {
      console.error('[CLIENT_SEARCH_SERVICE] ❌ Tabela app_fd14ee28a1_clients não encontrada!');
      throw new Error('Tabela de clientes não encontrada no banco de dados');
    }
    console.log('[CLIENT_SEARCH_SERVICE] ✅ Tabela app_fd14ee28a1_clients existe');

    const trimmed = searchQuery.trim();
    console.log('[CLIENT_SEARCH_SERVICE] ✂️ Query processada:', {
      original: searchQuery,
      trimmed,
      trimmedLength: trimmed.length
    });

    if (trimmed.length < 2) {
      console.log('[CLIENT_SEARCH_SERVICE] ⚠️ Query muito curta, retornando array vazio');
      return [];
    }

    const normalizedPhone = trimmed.replace(/[^0-9]/g, "");
    console.log('[CLIENT_SEARCH_SERVICE] 📱 Telefone normalizado:', {
      original: trimmed,
      normalized: normalizedPhone,
      hasPhoneDigits: normalizedPhone.length > 0
    });

    console.log('[CLIENT_SEARCH_SERVICE] 🔍 Executando query no Prisma...');
    console.log('[CLIENT_SEARCH_SERVICE] 📊 Parâmetros da query:', {
      companyId,
      normalizedPhone,
      namePattern: `%${trimmed}%`
    });

    // Primeiro tentar com REGEXP_REPLACE (PostgreSQL 10+)
    let results: ClientSearchResult[];
    
    try {
      console.log('[CLIENT_SEARCH_SERVICE] 🔧 Tentando query com REGEXP_REPLACE...');
      
      results = await prisma.$queryRaw<ClientSearchResult[]>`
        SELECT 
          c.id,
          c.company_id,
          c.name,
          c.phone,
          c.email,
          c.notes,
          c.created_at,
          c.updated_at
        FROM app_fd14ee28a1_clients c
        WHERE c.company_id::text = ${companyId}
          AND (
            REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') = ${normalizedPhone}
            OR LOWER(c.name) LIKE LOWER(${"%" + trimmed + "%"})
          )
        ORDER BY
          CASE WHEN REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') = ${normalizedPhone} THEN 0 ELSE 1 END,
          c.name
        LIMIT 10;
      `;
      
      console.log('[CLIENT_SEARCH_SERVICE] ✅ Query com REGEXP_REPLACE executada com sucesso');
      
    } catch (regexpError: any) {
      console.warn('[CLIENT_SEARCH_SERVICE] ⚠️ REGEXP_REPLACE falhou, tentando query alternativa:', regexpError.message);
      
      // Fallback: query mais simples sem REGEXP_REPLACE
      results = await prisma.$queryRaw<ClientSearchResult[]>`
        SELECT 
          c.id,
          c.company_id,
          c.name,
          c.phone,
          c.email,
          c.notes,
          c.created_at,
          c.updated_at
        FROM app_fd14ee28a1_clients c
        WHERE c.company_id::text = ${companyId}
          AND (
            c.phone LIKE ${"%" + normalizedPhone + "%"}
            OR LOWER(c.name) LIKE LOWER(${"%" + trimmed + "%"})
          )
        ORDER BY
          CASE WHEN c.phone LIKE ${"%" + normalizedPhone + "%"} THEN 0 ELSE 1 END,
          c.name
        LIMIT 10;
      `;
      
      console.log('[CLIENT_SEARCH_SERVICE] ✅ Query alternativa (sem REGEXP_REPLACE) executada com sucesso');
    }

    const queryDuration = Date.now() - queryStart;
    // Don't log client PII (names/phones). Counts/timing only.
    console.log('[CLIENT_SEARCH_SERVICE] ✅ Query executada com sucesso:', {
      resultCount: results.length,
      duration: `${queryDuration}ms`,
    });

    return results;
  } catch (error: any) {
    const queryDuration = Date.now() - queryStart;
    console.error('[CLIENT_SEARCH_SERVICE] 💥 ERRO NA QUERY:', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      duration: `${queryDuration}ms`,
      companyId,
      searchQuery: searchQuery?.substring(0, 50)
    });
    
    // Re-throw o erro para que o controller possa capturar
    throw error;
  }
};
