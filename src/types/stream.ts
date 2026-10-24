export type MediaType = 'movie' | 'tv' | 'anime';

export type AudioMode = 'sub' | 'dub';

export interface Server {
  name: string;
  urlTemplate: string;
  isApiProvider?: boolean;
}

export interface HubStream {
  name: string;
  url: string;
  proxyUrl?: string;
  quality: string;
  type: string;
  headers?: Record<string, string>;
  providerName?: string;
  providerId?: string;
  proxyMode?: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  status: 'waiting' | 'pending' | 'success' | 'failure' | 'notfound';
  percentage: number;
  error?: string;
  cacheStatus?: string;
}

export interface MovieServer {
  serverIndex: number;
  type: 'movie' | 'tv';
  season: number;
  episode: number;
}

export interface StreamData {
  movieServerMap: Record<string, MovieServer>;
  version?: number;
}
