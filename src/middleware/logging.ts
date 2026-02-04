import { Request, Response, NextFunction } from 'express';

// Middleware para log detalhado de requisições
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);
  
  // Adicionar ID da requisição ao request para rastreamento
  req.requestId = requestId;
  
  console.log(`[REQ_${requestId}] 🚀 ${req.method} ${req.path}`, {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    bodySize: JSON.stringify(req.body).length,
    queryParams: req.query,
    hasBody: Object.keys(req.body || {}).length > 0
  });

  // Interceptar a resposta para log
  const originalSend = res.send;
  res.send = function(body: any) {
    const duration = Date.now() - startTime;
    const statusColor = res.statusCode >= 400 ? '🔴' : res.statusCode >= 300 ? '🟡' : '🟢';
    
    console.log(`[REQ_${requestId}] ${statusColor} ${res.statusCode} - ${duration}ms`, {
      timestamp: new Date().toISOString(),
      responseSize: body?.length || 0,
      headers: {
        'content-type': res.get('Content-Type')
      }
    });

    // Se for erro 500, log mais detalhado
    if (res.statusCode >= 500) {
      console.error(`[REQ_${requestId}] 💥 ERRO 500 DETECTADO:`, {
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query,
        headers: {
          'content-type': req.get('Content-Type'),
          'user-agent': req.get('User-Agent')?.substring(0, 100),
          'origin': req.get('Origin')
        },
        duration: `${duration}ms`,
        responseBody: body?.substring(0, 500) // primeiros 500 chars da resposta
      });
    }

    return originalSend.call(this, body);
  };

  next();
};

// Middleware para capturar erros não tratados
export const errorHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
  const requestId = req.requestId || 'unknown';
  
  console.error(`[REQ_${requestId}] 💥 ERRO NÃO TRATADO:`, {
    timestamp: new Date().toISOString(),
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    },
    request: {
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query,
      ip: req.ip
    }
  });

  // Se já foi enviada uma resposta, não podemos enviar outra
  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'Internal Server Error',
    requestId,
    timestamp: new Date().toISOString(),
    details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
};

// Middleware para capturar promises rejeitadas
export const asyncErrorHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Extend Request interface para incluir requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}