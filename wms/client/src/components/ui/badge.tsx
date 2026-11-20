import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-wide",
  {
    variants: {
      variant: {
        default:
          "bg-primary-soft text-primary border border-primary/25",
        secondary:
          "bg-muted text-muted-foreground border border-border",
        destructive:
          "bg-destructive-soft text-destructive border border-destructive/25",
        success:
          "bg-success-soft text-success border border-success/30",
        warning:
          "bg-accent-soft text-accent border border-accent/30",
        outline:
          "bg-transparent text-foreground border border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }
