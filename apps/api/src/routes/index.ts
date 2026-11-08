/** The complete API route table (packages/shared/src/api.ts). */
import { Router } from '../http/router.js';
import { registerAccountRoutes } from './accounts.js';
import { registerBoardRoutes } from './board.js';
import { registerBranchRoutes } from './branches.js';
import { registerCandidateRoutes } from './candidates.js';
import { registerMailboxRoutes } from './mailboxes.js';
import { registerMeRoutes } from './me.js';
import { registerOrderRoutes } from './orders.js';
import { registerSystemRoutes } from './system.js';
import { registerTaskRoutes } from './tasks.js';
import { registerUserRoutes } from './users.js';
import { registerWallRoutes } from './wall.js';
import { registerWhiteboardRoutes } from './whiteboards.js';

export function createRouter(): Router {
  const router = new Router();
  registerSystemRoutes(router);
  registerMeRoutes(router);
  registerBranchRoutes(router);
  registerUserRoutes(router);
  registerBoardRoutes(router);
  registerOrderRoutes(router);
  registerAccountRoutes(router);
  registerCandidateRoutes(router);
  registerTaskRoutes(router);
  registerMailboxRoutes(router);
  registerWallRoutes(router);
  registerWhiteboardRoutes(router);
  return router;
}
