export interface CredentialProvider {
  getClientCredentials(userId?: string): Promise<{ clientId: string; clientSecret: string }>;
}

export class EnvCredentialProvider implements CredentialProvider {
  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  async getClientCredentials(): Promise<{ clientId: string; clientSecret: string }> {
    return { clientId: this.clientId, clientSecret: this.clientSecret };
  }
}
