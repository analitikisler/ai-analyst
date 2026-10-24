import { cn } from "cn"

// Overt skeleton: the surface-2 block with a slow 1.6 s opacity shimmer (no pulse scale), hidden from AT.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-[aia-shimmer_1.6s_ease-in-out_infinite] rounded-md bg-surface-2", className)}
      {...props}
    />
  )
}

export { Skeleton }
