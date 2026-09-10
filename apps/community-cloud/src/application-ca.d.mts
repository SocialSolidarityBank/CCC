export interface ApplicationCaEnvironment {
  CCC_DATABASE_CA_FILE?: string | undefined;
  NODE_EXTRA_CA_CERTS?: string | undefined;
  DENO_CERT?: string | undefined;
}

export function assertApplicationCaBinding(env?: ApplicationCaEnvironment): void;
