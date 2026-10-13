import { SkeletonRows, SkeletonText } from '@/components/ui/states';

/** Đang tải màn hình: khung xương dạng dòng khớp bố cục. */
export default function Loading() {
  return (
    <div className="animate-fade-in">
      <div className="skeleton mb-3 hidden h-6 w-48 md:block" />
      <SkeletonText lines={1} className="mb-10 w-80" />
      <SkeletonRows rows={8} />
    </div>
  );
}
