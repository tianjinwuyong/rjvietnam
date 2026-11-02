import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, onFocus, ...props }: React.ComponentProps<"input">) {
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (onFocus) onFocus(e);
    // 点击输入框时自动全选文本，方便扫码枪覆盖输入
    if (!e.defaultPrevented) {
      e.target.select();
    }
  };
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full rounded-[10px] border border-transparent bg-input-bg px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:bg-destructive-soft/30",
        className
      )}
      onFocus={handleFocus}
      {...props}
    />
  )
}

export { Input }
