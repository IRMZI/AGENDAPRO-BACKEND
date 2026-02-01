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
  const trimmed = searchQuery.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const normalizedPhone = trimmed.replace(/[^0-9]/g, "");

  const results = await prisma.$queryRaw<ClientSearchResult[]>`
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
    WHERE c.company_id = ${companyId}
      AND (
        REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') = ${normalizedPhone}
        OR LOWER(c.name) LIKE LOWER(${"%" + trimmed + "%"})
      )
    ORDER BY
      CASE WHEN REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') = ${normalizedPhone} THEN 0 ELSE 1 END,
      c.name
    LIMIT 10;
  `;

  return results;
};
