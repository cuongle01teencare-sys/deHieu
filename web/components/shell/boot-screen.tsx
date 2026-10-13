import { LogoMark } from './wordmark';

/** Màn khởi động có thương hiệu (cold start từ thông báo / PWA) — tối giản. */
export function BootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <div className="flex flex-col items-center gap-5 animate-fade-in">
        <LogoMark className="size-10" />
        <div className="h-0.5 w-24 overflow-hidden rounded-full bg-line">
          <div className="skeleton h-full w-full" />
        </div>
      </div>
    </div>
  );
}
