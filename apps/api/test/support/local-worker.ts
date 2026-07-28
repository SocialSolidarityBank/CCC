import type { Actor, Role } from '../../../../db/gateway';
import { handleRequest, type ActorResolver } from '../../src/request-handler';
import { ActorAuthenticationError, type ApiEnv } from '../../src/identity';

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name)?.trim();
  if (value === undefined || value.length === 0) throw new ActorAuthenticationError(`${name} is required in route tests`);
  return value;
}

function roleHeader(request: Request): Role {
  const value = request.headers.get('X-CCC-Role');
  if (value === 'admin' || value === 'counselor' || value === 'service') return value;
  throw new ActorAuthenticationError('X-CCC-Role is invalid in route tests');
}

const localActorFromHeaders: ActorResolver = async (request): Promise<Actor> => ({
  userId: requiredHeader(request, 'X-CCC-User-Id'),
  orgId: requiredHeader(request, 'X-CCC-Org-Id'),
  role: roleHeader(request),
});

const localWorker = {
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    return handleRequest(request, env, localActorFromHeaders);
  },
};

export default localWorker;
