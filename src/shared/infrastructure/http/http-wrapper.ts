import axios from 'axios';
import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

// 1. Định nghĩa interface cho Edge Operations & Side Effects
export interface HttpWrapperPlugins {
  // Edge Operations: Chạy TRƯỚC khi gửi request (có thể biến đổi Config)
  beforeRequest?: (
    config: InternalAxiosRequestConfig,
  ) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;

  // Side Effects: Chạy SAU khi nhận response (không làm gián đoạn flow chính)
  onSuccessEffect?: (response: AxiosResponse) => void | Promise<void>;

  // Side Effects/Edge Recovery: Chạy khi có lỗi (ví dụ: Refresh Token, Fallback Cache)
  onErrorEffect?: (error: any) => Promise<any> | void;
}

// 2. Hàm Factory tạo HttpWrapper
export function createHttpWrapper(
  baseConfig?: AxiosRequestConfig,
  plugins?: HttpWrapperPlugins,
): AxiosInstance {
  // Tạo một Axios Instance tiêu chuẩn
  const instance = axios.create(baseConfig);

  // --- EDGE OPERATIONS (Request Interceptor) ---
  instance.interceptors.request.use(
    async (config) => {
      // Ví dụ Edge Operation 1: Thêm Timestamp / Request ID
      config.headers = config.headers || {};
      config.headers['X-Request-Intent-Time'] = Date.now().toString();

      // Thực thi Custom BeforeRequest Plugin nếu có
      if (plugins?.beforeRequest) {
        config = await plugins.beforeRequest(config);
      }

      return config;
    },
    (error: Error) => Promise.reject(error),
  );

  // --- SIDE EFFECTS & EDGE RECOVERY (Response Interceptor) ---
  instance.interceptors.response.use(
    async (response) => {
      // Ví dụ Side Effect: Trigger Analytics hoặc Background Sync mà không block UI
      if (plugins?.onSuccessEffect) {
        // Chạy side effect asynchronously (hoặc await nếu muốn block)
        await Promise.resolve(plugins.onSuccessEffect(response)).catch((err) =>
          console.error('[SideEffect Error]:', err),
        );
      }

      return response;
    },
    async (error: Error) => {
      // Edge Operation: Xử lý Side Effect khi lỗi (Ví dụ: Log to Sentry / Retry)
      if (plugins?.onErrorEffect) {
        await plugins.onErrorEffect(error);
      }

      return await Promise.reject(error);
    },
  );

  return instance;
}
