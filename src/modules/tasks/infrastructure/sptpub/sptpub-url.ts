export interface SptPubEndpoint {
  readonly baseUrl: string; // vd https://api-h-c7818b61-608.sptpub.com
  readonly brandId: string;
  readonly lang: string; // 'en'
}

export const sptpubUrl = (e: SptPubEndpoint, path: string): string =>
  `${e.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
