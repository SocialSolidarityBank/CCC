import postgres from 'postgres';
import { PlanFailure } from './plan.mjs';

/** Only called after dual-signature and Management API owner/region checks. */
export async function withInstallerConnection(authorization, run) {
  const connectionString = process.env.CCC_INSTALL_DATABASE_URL;
  if (typeof connectionString !== 'string' || connectionString.trim() === '') throw new PlanFailure('CREDENTIAL_MISSING');
  try {
    const url = new URL(connectionString);
    const username = decodeURIComponent(url.username);
    const direct = url.hostname === `db.${authorization.projectRef}.supabase.co`;
    const pooler = /^[a-z0-9-]+-ap-northeast-2\.pooler\.supabase\.com$/.test(url.hostname)
      && username.endsWith(`.${authorization.projectRef}`);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler)
      || url.pathname !== '/postgres'
      || (url.port !== '' && url.port !== '5432') || url.search !== '' || url.hash !== ''
      || username === 'ccc_api' || username.startsWith('ccc_api.')) {
      throw new PlanFailure('CREDENTIAL_INSUFFICIENT');
    }
  } catch {
    throw new PlanFailure('CREDENTIAL_INSUFFICIENT');
  }
  const sql = postgres(connectionString, { ssl: 'verify-full', max: 1, connect_timeout: 10, onnotice: () => {}, debug: false });
  try {
    const [identity] = await sql`SELECT current_user AS role, current_database() AS database`;
    if (typeof identity?.role !== 'string' || identity.database !== 'postgres'
      || ['ccc_api', 'anon', 'authenticated'].includes(identity.role)) {
      throw new PlanFailure('CREDENTIAL_INSUFFICIENT');
    }
    return await run(sql);
  } catch (error) {
    throw new PlanFailure(error?.code ?? 'PROVIDER_UNREADABLE');
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
