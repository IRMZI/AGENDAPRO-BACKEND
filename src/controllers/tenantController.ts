import type { Request, Response } from "express";
import {
  getAllTenants,
  getTenantBySlug,
  getTenantById,
  getTenantByDomain,
  createTenant,
  updateTenant,
  deleteTenant,
  seedDefaultTenants,
} from "../services/tenantService.js";

// GET /api/tenants - Lista todos os tenants ativos
export const getAllTenantsHandler = async (_req: Request, res: Response) => {
  try {
    const tenants = await getAllTenants();
    return res.status(200).json({ data: tenants });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/tenants/slug/:slug - Obter tenant por slug
export const getTenantBySlugHandler = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const tenant = await getTenantBySlug(slug);
    
    if (!tenant) {
      return res.status(404).json({ error: "Tenant não encontrado" });
    }
    
    return res.status(200).json({ data: tenant });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/tenants/domain/:domain - Obter tenant por domínio
export const getTenantByDomainHandler = async (req: Request, res: Response) => {
  try {
    const { domain } = req.params;
    const tenant = await getTenantByDomain(domain);
    
    if (!tenant) {
      return res.status(404).json({ error: "Tenant não encontrado para este domínio" });
    }
    
    return res.status(200).json({ data: tenant });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/tenants/:id - Obter tenant por ID
export const getTenantByIdHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenant = await getTenantById(id);
    
    if (!tenant) {
      return res.status(404).json({ error: "Tenant não encontrado" });
    }
    
    return res.status(200).json({ data: tenant });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// POST /api/tenants - Criar novo tenant
export const createTenantHandler = async (req: Request, res: Response) => {
  try {
    const tenant = await createTenant(req.body);
    return res.status(201).json({ data: tenant });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Slug já existe" });
    }
    return res.status(400).json({ error: error.message });
  }
};

// PUT /api/tenants/:id - Atualizar tenant
export const updateTenantHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tenant = await updateTenant(id, req.body);
    return res.status(200).json({ data: tenant });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

// DELETE /api/tenants/:id - Deletar tenant
export const deleteTenantHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteTenant(id);
    return res.status(200).json({ message: "Tenant deletado com sucesso" });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

// POST /api/tenants/seed - Seed dos tenants padrão
export const seedTenantsHandler = async (_req: Request, res: Response) => {
  try {
    const results = await seedDefaultTenants();
    return res.status(200).json({ data: results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
