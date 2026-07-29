import Image from "next/image";

import { cn } from "@/lib/utils";

export function BrandLogo({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/brand/whatsapp-manager-logo.png"
      width={size}
      height={size}
      alt=""
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
