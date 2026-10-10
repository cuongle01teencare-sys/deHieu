import type { AxiosInstance } from 'axios';
import { createHttpWrapper } from './http-wrapper.js';
import type {
  HttpClient,
  HttpRequestConfig,
  HttpResponse,
} from '../../application/http-client.js';

export class AxiosHttpAdapter implements HttpClient {
  private instance: AxiosInstance;

  constructor() {
    // Khởi tạo HttpWrapper với Edge Operations & Side Effects
    this.instance = createHttpWrapper(
      { baseURL: process.env.API_BASE_URL },
      {
        beforeRequest: async (config) => {
          // Edge operation: Thêm Auth token / Context Metadata
          return await Promise.resolve(config);
        },
        onSuccessEffect: (_) => {
          // Side effect: Event Bus, Application Audit Logs, Sync State
        },
      },
    );
  }

  async get<T>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const res = await this.instance.get<T>(url, config);
    return { data: res.data, status: res.status, headers: res.headers };
  }

  async post<T>(
    url: string,
    data?: any,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const res = await this.instance.post<T>(url, data, config);
    return { data: res.data, status: res.status, headers: res.headers };
  }

  async put<T>(
    url: string,
    data?: any,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const res = await this.instance.put<T>(url, data, config);
    return { data: res.data, status: res.status, headers: res.headers };
  }

  async delete<T>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const res = await this.instance.delete<T>(url, config);
    return { data: res.data, status: res.status, headers: res.headers };
  }
}
