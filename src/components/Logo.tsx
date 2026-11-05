import { FileCode2 } from "lucide-react";

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <FileCode2 size={Math.round(size * 0.58)} strokeWidth={2.2} />
    </span>
  );
}
