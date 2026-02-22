// =============================================================================
// Authentication Middleware
// Validates ONSTAQ JWT tokens by calling /auth/me
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { OnstaqClient } from '../../onstaq/client';
import { logger } from '../../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  onstaqToken?: string;
}

/**
 * Creates auth middleware that validates tokens against ONSTAQ.
 */
export function createAuthMiddleware(onstaqClient: OnstaqClient) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' }
      });
    }

    const token = authHeader.slice(7);

    try {
      // Validate token by calling ONSTAQ's /auth/me with it
      onstaqClient.setToken(token);
      const user = await onstaqClient.getMe();

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      };
      req.onstaqToken = token;

      next();
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 401) {
        return res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' }
        });
      }

      logger.error(`Auth middleware error: ${err.message}`);
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Authentication service unavailable' }
      });
    }
  };
}
